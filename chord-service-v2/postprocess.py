"""
Post-processing utilities for chord recognition output.

Handles: beat alignment, chord merging, key detection, time signature
detection, and chord label simplification.
"""

import numpy as np
from collections import Counter

# ---------------------------------------------------------------------------
# Chord label simplification
# ---------------------------------------------------------------------------

# BTC large vocab qualities: min, maj, dim, aug, min6, maj6, min7, minmaj7,
# maj7, 7, dim7, hdim7, sus2, sus4
# We simplify to a practical set for guitar/keyboard players.

QUALITY_MAP = {
    "maj": "",          # C:maj → C
    "min": "m",         # C:min → Cm
    "dim": "dim",       # C:dim → Cdim
    "aug": "aug",       # C:aug → Caug
    "min6": "m",        # C:min6 → Cm (simplify)
    "maj6": "",         # C:maj6 → C (simplify)
    "min7": "m7",       # C:min7 → Cm7
    "minmaj7": "m7",    # C:minmaj7 → Cm7 (simplify)
    "maj7": "maj7",     # C:maj7 → Cmaj7
    "7": "7",           # C:7 → C7
    "dim7": "dim",      # C:dim7 → Cdim (simplify)
    "hdim7": "m7b5",    # C:hdim7 → Cm7b5
    "sus2": "sus2",     # C:sus2 → Csus2
    "sus4": "sus4",     # C:sus4 → Csus4
}

# Enharmonic mapping: sharp to flat for common flat keys
ENHARMONIC = {
    "C#": "Db",
    "D#": "Eb",
    "F#": "Gb",
    "G#": "Ab",
    "A#": "Bb",
}

# Keys that should use flats instead of sharps
FLAT_KEYS = {"F", "Bb", "Eb", "Ab", "Db", "Gb",
             "Dm", "Gm", "Cm", "Fm", "Bbm", "Ebm"}


def simplify_chord_label(label: str) -> str:
    """
    Convert BTC chord label (e.g., 'C:maj', 'G#:min7', 'N') to simplified
    guitar-friendly format (e.g., 'C', 'G#m7', 'N').
    """
    if label in ("N", "X", ""):
        return "N"

    # BTC format: "Root:Quality" or "Root:Quality/Bass"
    parts = label.split(":")
    if len(parts) < 2:
        return label  # Already simplified or unknown format

    root = parts[0]
    quality_with_bass = parts[1]

    # Handle bass note (inversions): "min/5" → just use quality "min"
    quality = quality_with_bass.split("/")[0]

    suffix = QUALITY_MAP.get(quality, quality)

    return f"{root}{suffix}"


def apply_enharmonic(chord: str, use_flats: bool) -> str:
    """Convert sharp chord names to flat equivalents if needed."""
    if not use_flats or not chord:
        return chord

    # Extract root (1 or 2 chars)
    if len(chord) >= 2 and chord[1] == "#":
        root = chord[:2]
        suffix = chord[2:]
        flat_root = ENHARMONIC.get(root, root)
        return f"{flat_root}{suffix}"

    return chord


# ---------------------------------------------------------------------------
# Beat alignment
# ---------------------------------------------------------------------------

def beat_align_chords(
    raw_chords: list[tuple[float, str]],
    beat_times: np.ndarray,
    song_length: float,
) -> list[tuple[float, float, str]]:
    """
    Snap frame-level chord predictions to beat boundaries.

    Args:
        raw_chords: list of (time_sec, chord_label) from BTC
        beat_times: array of beat positions in seconds
        song_length: total audio duration in seconds

    Returns:
        list of (start_time, duration, chord_label)
    """
    if len(beat_times) < 2:
        # Not enough beats — fall back to frame-level grouping
        return _group_frames_to_events(raw_chords, song_length)

    # For each beat interval, find the most common chord prediction
    events = []
    all_beats = np.concatenate([[0.0], beat_times, [song_length]])

    for i in range(len(all_beats) - 1):
        start = all_beats[i]
        end = all_beats[i + 1]
        duration = end - start

        if duration <= 0:
            continue

        # Collect all chord predictions within this beat interval
        chords_in_beat = [
            label for t, label in raw_chords
            if start <= t < end and label != "N"
        ]

        if not chords_in_beat:
            # No non-N chords — keep N
            chords_in_beat = [
                label for t, label in raw_chords if start <= t < end
            ]

        if chords_in_beat:
            # Majority vote
            chord = Counter(chords_in_beat).most_common(1)[0][0]
        else:
            chord = "N"

        events.append((start, duration, chord))

    return events


def _group_frames_to_events(
    raw_chords: list[tuple[float, str]], song_length: float
) -> list[tuple[float, float, str]]:
    """Fallback: group consecutive same-label frames into events."""
    if not raw_chords:
        return []

    events = []
    current_chord = raw_chords[0][1]
    current_start = raw_chords[0][0]

    for i in range(1, len(raw_chords)):
        t, label = raw_chords[i]
        if label != current_chord:
            events.append((current_start, t - current_start, current_chord))
            current_chord = label
            current_start = t

    # Last event
    events.append((current_start, song_length - current_start, current_chord))
    return events


# ---------------------------------------------------------------------------
# Merge consecutive identical chords
# ---------------------------------------------------------------------------

def merge_consecutive_chords(
    events: list[tuple[float, float, str]],
) -> list[tuple[float, float, str]]:
    """Merge adjacent chord events with the same label."""
    if not events:
        return []

    merged = [events[0]]

    for start, dur, chord in events[1:]:
        prev_start, prev_dur, prev_chord = merged[-1]
        if chord == prev_chord:
            # Extend previous event
            merged[-1] = (prev_start, prev_dur + dur, prev_chord)
        else:
            merged.append((start, dur, chord))

    return merged


# ---------------------------------------------------------------------------
# Key detection (Krumhansl-Schmuckler)
# ---------------------------------------------------------------------------

# Pitch class mapping
PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Krumhansl-Kessler major & minor profiles
MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]


def _chord_root_to_pitch_class(chord: str) -> int:
    """Extract root pitch class index from a chord label (e.g., 'Cm7' → 0)."""
    if not chord or chord == "N":
        return -1

    # Extract root (handle sharps and flats)
    if len(chord) >= 2 and chord[1] in ("#", "b"):
        root = chord[:2]
    else:
        root = chord[0]

    # Convert flats to sharps for lookup
    flat_to_sharp = {
        "Db": "C#", "Eb": "D#", "Fb": "E", "Gb": "F#",
        "Ab": "G#", "Bb": "A#", "Cb": "B",
    }
    root = flat_to_sharp.get(root, root)

    try:
        return PITCH_CLASSES.index(root)
    except ValueError:
        return -1


def _is_minor_chord(chord: str) -> bool:
    """Check if a chord label implies minor quality."""
    root_len = 2 if (len(chord) >= 2 and chord[1] in ("#", "b")) else 1
    suffix = chord[root_len:]
    return suffix.startswith("m") and not suffix.startswith("maj")


def detect_key(events: list[tuple[float, float, str]]) -> str:
    """
    Detect key from chord distribution using Krumhansl-Schmuckler algorithm.
    Returns key string like 'C', 'Am', 'Eb', 'Cm'.
    """
    if not events:
        return "C"

    # Build pitch class duration histogram weighted by chord duration
    histogram = np.zeros(12)
    for _, dur, chord in events:
        pc = _chord_root_to_pitch_class(chord)
        if pc >= 0:
            histogram[pc] += dur

    if histogram.sum() == 0:
        return "C"

    # Correlate with all 24 key profiles (12 major + 12 minor)
    best_key = "C"
    best_score = -999

    for shift in range(12):
        rotated = np.roll(histogram, -shift)

        # Major key candidate
        corr_maj = np.corrcoef(rotated, MAJOR_PROFILE)[0, 1]
        if corr_maj > best_score:
            best_score = corr_maj
            best_key = PITCH_CLASSES[shift]

        # Minor key candidate
        corr_min = np.corrcoef(rotated, MINOR_PROFILE)[0, 1]
        if corr_min > best_score:
            best_score = corr_min
            best_key = f"{PITCH_CLASSES[shift]}m"

    # --- Minor key refinement ---
    # If the most frequent chord by duration is a minor chord, and its root
    # matches the detected key's tonic (major or minor), prefer the minor key.
    # Example: key=C but most frequent chord is Cm → switch to Cm.
    chord_durations = {}
    for _, dur, c in events:
        chord_durations[c] = chord_durations.get(c, 0) + dur
    most_common_chord = max(chord_durations, key=chord_durations.get)

    total_dur = sum(dur for _, dur, _ in events)
    minor_chord_dur = sum(dur for _, dur, c in events if _is_minor_chord(c))
    minor_ratio = minor_chord_dur / total_dur if total_dur > 0 else 0

    # If detected as major but the single most common chord is the tonic minor
    if not best_key.endswith("m"):
        tonic_minor = f"{best_key}m"
        if _is_minor_chord(most_common_chord):
            mc_root = _chord_root_to_pitch_class(most_common_chord)
            key_root = PITCH_CLASSES.index(best_key) if best_key in PITCH_CLASSES else -1
            # Most common chord's root matches tonic → flip to minor
            if mc_root == key_root:
                best_key = tonic_minor
            # Or if >40% of chord duration is minor (lower threshold than before)
            elif minor_ratio > 0.4:
                major_pc = PITCH_CLASSES.index(best_key) if best_key in PITCH_CLASSES else 0
                minor_pc = (major_pc + 9) % 12  # relative minor
                best_key = f"{PITCH_CLASSES[minor_pc]}m"
        elif minor_ratio > 0.6:
            # Fallback: >60% minor duration — try relative minor
            major_pc = PITCH_CLASSES.index(best_key) if best_key in PITCH_CLASSES else 0
            minor_pc = (major_pc + 9) % 12
            best_key = f"{PITCH_CLASSES[minor_pc]}m"

    # Apply enharmonic normalization for flat keys
    use_flats = best_key in FLAT_KEYS or best_key.rstrip("m") in ENHARMONIC
    if use_flats:
        root = best_key.rstrip("m")
        suffix = "m" if best_key.endswith("m") else ""
        flat_root = ENHARMONIC.get(root, root)
        best_key = f"{flat_root}{suffix}"

    return best_key


# ---------------------------------------------------------------------------
# Time signature detection
# ---------------------------------------------------------------------------

def detect_time_signature(onset_env: np.ndarray, beat_frames: np.ndarray) -> str:
    """
    Estimate time signature from onset strength patterns at beat positions.
    Returns '3/4', '4/4', '6/8', or '2/4'.
    """
    if len(beat_frames) < 4:
        return "4/4"

    # Get onset strengths at beat positions
    beat_strengths = onset_env[beat_frames[beat_frames < len(onset_env)]]

    if len(beat_strengths) < 4:
        return "4/4"

    # Compute autocorrelation of beat strengths to find grouping pattern
    # Group by 2, 3, and 4, see which has strongest downbeat pattern
    scores = {}

    for group_size in [2, 3, 4]:
        if len(beat_strengths) < group_size * 2:
            continue

        # Trim to exact multiple
        n = (len(beat_strengths) // group_size) * group_size
        grouped = beat_strengths[:n].reshape(-1, group_size)

        # Score: how much stronger is the first beat vs others?
        if grouped.shape[0] < 2:
            continue

        first_beat_mean = grouped[:, 0].mean()
        other_beats_mean = grouped[:, 1:].mean()

        if other_beats_mean > 0:
            scores[group_size] = first_beat_mean / other_beats_mean
        else:
            scores[group_size] = 1.0

    if not scores:
        return "4/4"

    best_grouping = max(scores, key=scores.get)

    grouping_to_time_sig = {
        2: "2/4",
        3: "3/4",
        4: "4/4",
    }

    return grouping_to_time_sig.get(best_grouping, "4/4")
