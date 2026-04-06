"""
Post-processing utilities for chord recognition output.

Handles: beat alignment, chord merging, key detection, time signature
detection, and chord label simplification.
"""

import numpy as np
import librosa
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
    "min6": "m6",       # C:min6 → Cm6 (preserve 6th)
    "maj6": "6",        # C:maj6 → C6 (preserve 6th)
    "min7": "m7",       # C:min7 → Cm7
    "minmaj7": "mM7",   # C:minmaj7 → CmM7 (preserve unique quality)
    "maj7": "maj7",     # C:maj7 → Cmaj7
    "7": "7",           # C:7 → C7
    "dim7": "dim7",     # C:dim7 → Cdim7 (preserve dim7)
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
MAJOR_PROFILE_KK = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
MINOR_PROFILE_KK = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

# Temperley major & minor profiles (complementary to K-K)
MAJOR_PROFILE_T = [5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0]
MINOR_PROFILE_T = [5.0, 2.0, 3.5, 4.5, 2.0, 3.5, 2.0, 4.5, 3.5, 2.0, 1.5, 4.0]

# Combined profiles (average of K-K and Temperley for robustness)
MAJOR_PROFILE = [(a + b) / 2 for a, b in zip(MAJOR_PROFILE_KK, MAJOR_PROFILE_T)]
MINOR_PROFILE = [(a + b) / 2 for a, b in zip(MINOR_PROFILE_KK, MINOR_PROFILE_T)]


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
# Time signature detection (supports odd meters)
# ---------------------------------------------------------------------------

def detect_time_signature(
    onset_env: np.ndarray,
    beat_frames: np.ndarray,
    sr: int = 22050,
    hop_length: int = 512,
) -> str:
    """
    Estimate time signature from onset strength patterns.
    Supports: 2/4, 3/4, 3/8, 4/4, 5/4, 5/8, 6/4, 6/8, 7/8, 9/8, 12/8.

    Uses three complementary methods:
    1. Beat grouping — tests how well beat strengths fit each candidate
    2. IOI variance — boosts odd meter candidates when beat grid is irregular
    3. Tempo-based disambiguation — uses BPM to decide x/4 vs x/8

    Returns the best-fit time signature string.
    """
    if len(beat_frames) < 4:
        return "4/4"

    # Get onset strengths at beat positions
    valid_frames = beat_frames[beat_frames < len(onset_env)]
    beat_strengths = onset_env[valid_frames]

    if len(beat_strengths) < 6:
        return "4/4"

    # Compute BPM from beat positions (needed for x/4 vs x/8 disambiguation)
    beat_times = librosa.frames_to_time(valid_frames, sr=sr, hop_length=hop_length)
    if len(beat_times) >= 2:
        median_ioi_sec = float(np.median(np.diff(beat_times)))
        detected_bpm = 60.0 / median_ioi_sec if median_ioi_sec > 0 else 120.0
    else:
        detected_bpm = 120.0

    # --- Method 1: Beat grouping with downbeat accent ---
    # Test each candidate grouping: how much stronger is beat 1 vs rest?
    # Map group_size → candidate label (denominator resolved later by tempo)
    group_sizes = [2, 3, 4, 5, 6, 7, 9, 12]

    scores = {}
    for group_size in group_sizes:
        if len(beat_strengths) < group_size * 2:
            continue

        # Trim to exact multiple of group_size
        n = (len(beat_strengths) // group_size) * group_size
        grouped = beat_strengths[:n].reshape(-1, group_size)

        if grouped.shape[0] < 2:
            continue

        # Accent ratio: how much stronger is beat 1 vs the average of others
        first_beat_mean = grouped[:, 0].mean()
        other_beats_mean = grouped[:, 1:].mean()

        if other_beats_mean > 0:
            accent_ratio = first_beat_mean / other_beats_mean
        else:
            accent_ratio = 1.0

        # For compound meters, also check secondary accent patterns
        secondary_bonus = 0.0
        if group_size == 6 and grouped.shape[1] >= 4:
            # 6/8 or 6/4: secondary accent at position 3 (middle of measure)
            secondary = grouped[:, 3].mean()
            inner = np.mean([grouped[:, 1].mean(), grouped[:, 2].mean(),
                           grouped[:, 4].mean(), grouped[:, 5].mean()])
            if inner > 0:
                secondary_bonus = (secondary / inner - 1.0) * 0.3
        elif group_size == 7:
            # 7/8: common patterns 2+2+3 or 3+2+2
            for pattern_accents in [[2, 4], [3, 5]]:
                sub_acc = np.mean([grouped[:, p].mean() for p in pattern_accents if p < group_size])
                non_acc = []
                for bi in range(1, group_size):
                    if bi not in pattern_accents:
                        non_acc.append(grouped[:, bi].mean())
                if non_acc and np.mean(non_acc) > 0:
                    bonus = (sub_acc / np.mean(non_acc) - 1.0) * 0.25
                    secondary_bonus = max(secondary_bonus, bonus)
        elif group_size == 5:
            # 5/4 or 5/8: common patterns 3+2 or 2+3
            for pattern_accents in [[3], [2]]:
                sub_acc = np.mean([grouped[:, p].mean() for p in pattern_accents if p < group_size])
                non_acc = []
                for bi in range(1, group_size):
                    if bi not in pattern_accents:
                        non_acc.append(grouped[:, bi].mean())
                if non_acc and np.mean(non_acc) > 0:
                    bonus = (sub_acc / np.mean(non_acc) - 1.0) * 0.2
                    secondary_bonus = max(secondary_bonus, bonus)
        elif group_size == 9:
            # 9/8: 3+3+3 pattern — accents at positions 3 and 6
            if grouped.shape[1] >= 7:
                sub_acc = np.mean([grouped[:, 3].mean(), grouped[:, 6].mean()])
                non_acc = []
                for bi in range(1, group_size):
                    if bi not in [3, 6]:
                        non_acc.append(grouped[:, bi].mean())
                if non_acc and np.mean(non_acc) > 0:
                    secondary_bonus = (sub_acc / np.mean(non_acc) - 1.0) * 0.2

        scores[group_size] = accent_ratio + secondary_bonus

    if not scores:
        return "4/4"

    # --- Method 2: IOI variance test for odd meters ---
    # If inter-beat intervals have high variance, favor odd/compound meters
    if len(valid_frames) >= 4:
        ioi = np.diff(valid_frames).astype(float)
        ioi_cv = float(np.std(ioi) / (np.mean(ioi) + 1e-10))  # coefficient of variation

        # High CV suggests librosa's beat tracker is struggling (odd meter)
        # Slightly boost odd-meter candidates
        if ioi_cv > 0.15:
            for g in [5, 7, 9]:
                if g in scores:
                    scores[g] *= (1.0 + min(ioi_cv, 0.4))

    # Find best grouping
    best_grouping = max(scores, key=scores.get)

    # --- Method 3: Tempo-based disambiguation (x/4 vs x/8) ---
    # High BPM (>160) → beats are eighth notes (x/8)
    # Moderate BPM (80-160) → beats are quarter notes (x/4)
    # Low BPM (<80) → beats could be half notes, but rare in practice
    grouping_to_time_sig = {
        2:  "2/4",   # always 2/4 (2/8 is extremely rare)
        4:  "4/4",   # always 4/4 (4/8 is extremely rare)
        12: "12/8",  # always 12/8 (12/4 is extremely rare)
    }

    if best_grouping in grouping_to_time_sig:
        return grouping_to_time_sig[best_grouping]

    # For groupings that could be x/4 or x/8, use BPM threshold
    # BPM > 160 per beat → likely eighth note beats (x/8)
    # BPM ≤ 160 per beat → likely quarter note beats (x/4)
    bpm_threshold = 160

    if best_grouping == 3:
        return "3/8" if detected_bpm > bpm_threshold else "3/4"
    elif best_grouping == 5:
        return "5/8" if detected_bpm > bpm_threshold else "5/4"
    elif best_grouping == 6:
        return "6/8" if detected_bpm > bpm_threshold else "6/4"
    elif best_grouping == 7:
        return "7/8"  # 7/4 exists but 7/8 is far more common
    elif best_grouping == 9:
        return "9/8"  # 9/4 is extremely rare

    return "4/4"


def compute_beat_confidence(beat_times: np.ndarray) -> float:
    """
    Score how regular/reliable the beat grid is (0.0 = chaotic, 1.0 = perfect).
    Low confidence suggests odd meter or beat tracker failure.
    """
    if len(beat_times) < 3:
        return 0.0

    ioi = np.diff(beat_times)
    if len(ioi) < 2:
        return 0.0

    median_ioi = float(np.median(ioi))
    if median_ioi <= 0:
        return 0.0

    # Coefficient of variation — lower = more regular
    cv = float(np.std(ioi) / median_ioi)

    # Convert to 0-1 confidence (cv=0 → 1.0, cv=0.3+ → ~0)
    confidence = max(0.0, 1.0 - cv * 3.3)

    return confidence


# ---------------------------------------------------------------------------
# Key refinement (two-pass, ported from v1)
# ---------------------------------------------------------------------------

def refine_key_with_chords(
    initial_key: str,
    events: list[tuple[float, float, str]],
) -> str:
    """
    Refine detected key using chord resolution analysis.
    Scores minor vs major candidates using weighted chord functions:
    - Tonic chord: 1.5× weight
    - Dominant V7: 3.0× weight (strongest indicator)
    - Subdominant: 0.5× weight
    - M7 chords on tonic: 0.3× weight (ambiguous — could be I of major or III of minor)
    - Anchor bonus: +5 if first/last chord matches tonic
    """
    if not events or len(events) < 2:
        return initial_key

    is_minor = initial_key.endswith("m")
    key_root_name = initial_key.rstrip("m")
    key_root = _chord_root_to_pitch_class(key_root_name)
    if key_root < 0:
        return initial_key

    # Build chord duration map
    chord_dur = {}
    for _, dur, c in events:
        chord_dur[c] = chord_dur.get(c, 0) + dur

    first_chord = events[0][2]
    last_chord = events[-1][2]

    def score_key(root_pc, minor):
        """Score how well chords fit a given key."""
        s = 0.0
        tonic_name = PITCH_CLASSES[root_pc]
        tonic_chord = f"{tonic_name}m" if minor else tonic_name

        # Dominant V7: root at +7 semitones
        dom_root = (root_pc + 7) % 12
        dom_name = PITCH_CLASSES[dom_root]
        dom7_chord = f"{dom_name}7"

        # Subdominant: root at +5 semitones
        sub_root = (root_pc + 5) % 12
        sub_name = PITCH_CLASSES[sub_root]

        for chord, dur in chord_dur.items():
            c_root = _chord_root_to_pitch_class(chord)
            if c_root < 0:
                continue

            # Tonic chord
            if chord == tonic_chord or (c_root == root_pc and _is_minor_chord(chord) == minor):
                s += dur * 1.5
            # Dominant V7
            elif chord == dom7_chord:
                s += dur * 3.0
            # Subdominant
            elif c_root == sub_root:
                s += dur * 0.5
            # M7 on tonic — ambiguous, weight low
            elif c_root == root_pc and chord.endswith("maj7"):
                s += dur * 0.3
            # Other diatonic chords get base weight
            else:
                interval = (c_root - root_pc) % 12
                if minor:
                    diatonic = {0, 2, 3, 5, 7, 8, 10, 11}  # natural + harmonic minor
                else:
                    diatonic = {0, 2, 4, 5, 7, 9, 11}
                if interval in diatonic:
                    s += dur * 0.2

        # Anchor bonus: first/last chord matching tonic
        for anchor in [first_chord, last_chord]:
            a_root = _chord_root_to_pitch_class(anchor)
            if a_root == root_pc:
                s += 5.0

        return s

    # Score both major and minor candidates for the same root
    major_score = score_key(key_root, False)
    minor_score = score_key(key_root, True)

    # Also score relative major/minor
    if is_minor:
        rel_major_root = (key_root + 3) % 12
        rel_major_score = score_key(rel_major_root, False)
    else:
        rel_minor_root = (key_root + 9) % 12
        rel_minor_score = score_key(rel_minor_root, True)

    if is_minor:
        # Currently detected as minor — need strong evidence to flip to major
        if rel_major_score > minor_score * 1.5:
            new_root = PITCH_CLASSES[rel_major_root]
            return new_root
    else:
        # Currently detected as major — easier to flip to minor
        if minor_score > major_score:
            return f"{key_root_name}m"
        if rel_minor_score > major_score:
            new_root = PITCH_CLASSES[rel_minor_root]
            return f"{new_root}m"

    return initial_key


# ---------------------------------------------------------------------------
# Diatonic chord set (for Viterbi transition matrix)
# ---------------------------------------------------------------------------

# Major/minor scale degrees in semitones from root
_MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11]
_MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10]

def get_diatonic_chords(key: str) -> set[str]:
    """
    Return set of chord names diatonic to the given key.
    Includes natural scale chords, harmonic minor V/V7, secondary dominants,
    borrowed chords, and Picardy third.
    """
    is_minor = key.endswith("m")
    root_name = key.rstrip("m")
    root_pc = _chord_root_to_pitch_class(root_name)
    if root_pc < 0:
        return set()

    chords = set()

    if is_minor:
        # Natural minor: i, ii°, III, iv, v, VI, VII
        degrees = _MINOR_SCALE
        minor_degrees = {0, 3, 7}   # i, iv, v (natural)
        major_degrees = {2, 5, 8}   # III, VI, VII (natural: bIII=+3, bVI=+8, bVII=+10)
        dim_degrees = {2}            # ii°

        for d in degrees:
            pc = (root_pc + d) % 12
            name = PITCH_CLASSES[pc]
            chords.add(name)          # major
            chords.add(f"{name}m")    # minor
            chords.add(f"{name}7")    # dominant 7th
            chords.add(f"{name}m7")   # minor 7th
            chords.add(f"{name}maj7") # major 7th
            chords.add(f"{name}dim")  # diminished

        # Harmonic minor: raised 7th for V and V7
        v_root = (root_pc + 7) % 12
        v_name = PITCH_CLASSES[v_root]
        chords.add(v_name)
        chords.add(f"{v_name}7")

        # vii° of harmonic minor
        vii_root = (root_pc + 11) % 12
        vii_name = PITCH_CLASSES[vii_root]
        chords.add(f"{vii_name}dim")
        chords.add(f"{vii_name}dim7")

        # Picardy third (major I)
        chords.add(root_name)

    else:
        # Major: I, ii, iii, IV, V, vi, vii°
        degrees = _MAJOR_SCALE

        for d in degrees:
            pc = (root_pc + d) % 12
            name = PITCH_CLASSES[pc]
            chords.add(name)
            chords.add(f"{name}m")
            chords.add(f"{name}7")
            chords.add(f"{name}m7")
            chords.add(f"{name}maj7")
            chords.add(f"{name}dim")

        # Secondary dominants (V/x for each diatonic chord)
        for d in [2, 4, 5, 7, 9]:  # V of ii, iii, IV, V, vi
            sec_dom = (root_pc + d + 7) % 12
            sec_name = PITCH_CLASSES[sec_dom]
            chords.add(f"{sec_name}7")
            chords.add(sec_name)

        # Borrowed from parallel minor (bIII, bVI, bVII, iv)
        for d in [3, 8, 10]:
            pc = (root_pc + d) % 12
            name = PITCH_CLASSES[pc]
            chords.add(name)
            chords.add(f"{name}m")
            chords.add(f"{name}7")

    # Add common extended types for all diatonic roots
    for d in (degrees if not is_minor else _MINOR_SCALE):
        pc = (root_pc + d) % 12
        name = PITCH_CLASSES[pc]
        for suffix in ["sus2", "sus4", "6", "m6", "m7b5", "dim7", "mM7", "aug"]:
            chords.add(f"{name}{suffix}")

    return chords


# ---------------------------------------------------------------------------
# Viterbi HMM post-smoothing
# ---------------------------------------------------------------------------

def viterbi_smooth_chords(
    raw_predictions: list[tuple[float, str]],
    key: str,
    song_length: float,
) -> list[tuple[float, str]]:
    """
    Apply Viterbi HMM smoothing to frame-level chord predictions.
    Uses a key-aware transition matrix to favor diatonic chord sequences.

    Args:
        raw_predictions: list of (time_sec, chord_label) from BTC
        key: detected key string (e.g., 'C', 'Am', 'Eb')
        song_length: total audio duration

    Returns:
        Smoothed list of (time_sec, chord_label)
    """
    if len(raw_predictions) < 3:
        return raw_predictions

    # Build vocabulary of unique chord labels (excluding N)
    labels_in_data = []
    for _, label in raw_predictions:
        if label not in labels_in_data:
            labels_in_data.append(label)

    # Need at least 2 states for Viterbi
    if len(labels_in_data) < 2:
        return raw_predictions

    n_states = len(labels_in_data)
    label_to_idx = {l: i for i, l in enumerate(labels_in_data)}

    # Build diatonic chord set for the key
    diatonic = get_diatonic_chords(key)

    # Also include enharmonic equivalents in diatonic set
    diatonic_expanded = set(diatonic)
    for chord in list(diatonic):
        # Apply both sharp→flat and ensure coverage
        en = apply_enharmonic(chord, True)
        if en != chord:
            diatonic_expanded.add(en)

    diatonic_indices = set()
    for i, label in enumerate(labels_in_data):
        if label in diatonic_expanded or label == "N":
            diatonic_indices.add(i)

    # Build transition matrix
    transition = np.full((n_states, n_states), 0.0005)  # non-diatonic default
    for i in range(n_states):
        # Self-transition: strong persistence
        transition[i, i] = 0.90

        i_diatonic = i in diatonic_indices
        for j in range(n_states):
            if i == j:
                continue
            j_diatonic = j in diatonic_indices
            if i_diatonic and j_diatonic:
                transition[i, j] = 0.02    # diatonic → diatonic
            elif i_diatonic or j_diatonic:
                transition[i, j] = 0.002   # mixed

    # Normalize rows
    for i in range(n_states):
        row_sum = transition[i].sum()
        if row_sum > 0:
            transition[i] /= row_sum

    # Build observation probability matrix
    # Shape: (n_states, n_frames)
    n_frames = len(raw_predictions)
    obs_prob = np.full((n_states, n_frames), 0.01)  # small floor probability

    for t, (_, label) in enumerate(raw_predictions):
        idx = label_to_idx.get(label)
        if idx is not None:
            # Softened one-hot: primary label gets 0.85, others share remaining
            obs_prob[idx, t] = 0.85
            remaining = 0.15 / max(1, n_states - 1)
            for j in range(n_states):
                if j != idx:
                    obs_prob[j, t] = remaining + 0.01

    # Normalize columns
    for t in range(n_frames):
        col_sum = obs_prob[:, t].sum()
        if col_sum > 0:
            obs_prob[:, t] /= col_sum

    # Run Viterbi
    try:
        smoothed_indices = librosa.sequence.viterbi_discriminative(
            obs_prob, transition
        )
    except Exception:
        # If Viterbi fails for any reason, return original
        return raw_predictions

    # Convert back to (time, label) format
    result = []
    for t in range(n_frames):
        time_sec = raw_predictions[t][0]
        label = labels_in_data[smoothed_indices[t]]
        result.append((time_sec, label))

    return result
