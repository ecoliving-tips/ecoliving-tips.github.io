"""
Post-processing utilities for chord recognition output.

Handles: chord label simplification, median filtering, Viterbi HMM
smoothing, and consecutive chord merging.
"""

import numpy as np
import librosa

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


def median_filter_chords(
    predictions: list[tuple[float, str]], window: int = 5
) -> list[tuple[float, str]]:
    """
    Apply median-style filter to frame-level chord predictions.
    Replaces each frame's label with the most common label in its
    ±(window//2) neighborhood. Eliminates isolated single-frame blips
    that would otherwise confuse Viterbi.
    """
    n = len(predictions)
    if n < window:
        return predictions

    half = window // 2
    result = []

    for i in range(n):
        lo = max(0, i - half)
        hi = min(n, i + half + 1)
        # Count labels in window
        counts = {}
        for j in range(lo, hi):
            label = predictions[j][1]
            counts[label] = counts.get(label, 0) + 1
        # Pick the most common
        best_label = max(counts, key=counts.get)
        result.append((predictions[i][0], best_label))

    return result


# ---------------------------------------------------------------------------
# Pitch class utilities (used by Viterbi key-aware mode)
# ---------------------------------------------------------------------------

PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


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


# ---------------------------------------------------------------------------
# Diatonic chord set (for Viterbi key-aware mode)
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
    key: str | None,
    song_length: float,
    frame_probs: "np.ndarray | None" = None,
    vocab_map: "dict | None" = None,
) -> list[tuple[float, str]]:
    """
    Apply Viterbi HMM smoothing to frame-level chord predictions.
    When key is None, uses uniform transitions (pure persistence smoothing).
    When key is provided, uses key-aware diatonic transition bias.

    If frame_probs (softmax output from BTC, shape n_frames × n_classes) and
    vocab_map (index → BTC label) are provided, builds observation probabilities
    from the model's own confidence instead of synthetic one-hot.

    Args:
        raw_predictions: list of (time_sec, chord_label) from BTC
        key: detected key string or None for key-agnostic mode
        song_length: total audio duration
        frame_probs: optional softmax probability matrix from BTC
        vocab_map: optional dict mapping class index → BTC chord label

    Returns:
        Smoothed list of (time_sec, chord_label)
    """
    if len(raw_predictions) < 3:
        return raw_predictions

    # Build vocabulary of unique chord labels
    labels_in_data = []
    for _, label in raw_predictions:
        if label not in labels_in_data:
            labels_in_data.append(label)

    # Need at least 2 states for Viterbi
    if len(labels_in_data) < 2:
        return raw_predictions

    n_states = len(labels_in_data)
    label_to_idx = {l: i for i, l in enumerate(labels_in_data)}

    # Build transition matrix
    if key is not None:
        # Key-aware mode: diatonic chords get higher transition probability
        diatonic = get_diatonic_chords(key)
        diatonic_expanded = set(diatonic)
        for chord in list(diatonic):
            en = apply_enharmonic(chord, True)
            if en != chord:
                diatonic_expanded.add(en)

        diatonic_indices = set()
        for i, label in enumerate(labels_in_data):
            if label in diatonic_expanded or label == "N":
                diatonic_indices.add(i)

        transition = np.full((n_states, n_states), 0.0005)
        for i in range(n_states):
            transition[i, i] = 0.90
            i_diatonic = i in diatonic_indices
            for j in range(n_states):
                if i == j:
                    continue
                j_diatonic = j in diatonic_indices
                if i_diatonic and j_diatonic:
                    transition[i, j] = 0.02
                elif i_diatonic or j_diatonic:
                    transition[i, j] = 0.002
    else:
        # Key-agnostic mode: uniform transitions, only self-persistence bias
        uniform_prob = 0.10 / max(1, n_states - 1)
        transition = np.full((n_states, n_states), uniform_prob)
        for i in range(n_states):
            transition[i, i] = 0.90

    # Normalize rows
    for i in range(n_states):
        row_sum = transition[i].sum()
        if row_sum > 0:
            transition[i] /= row_sum

    # Build observation probability matrix
    # Shape: (n_states, n_frames)
    n_frames = len(raw_predictions)
    obs_prob = np.full((n_states, n_frames), 0.01)  # small floor probability

    # Try to use BTC softmax probabilities for richer observation model
    used_softmax = False
    if frame_probs is not None and vocab_map is not None:
        try:
            # Build mapping: BTC class index → our Viterbi state index
            # We need to map through simplify_chord_label since our labels are simplified
            btc_to_state = {}
            for cls_idx, btc_label in vocab_map.items():
                simplified = simplify_chord_label(btc_label)
                state_idx = label_to_idx.get(simplified)
                if state_idx is not None:
                    if cls_idx not in btc_to_state:
                        btc_to_state[cls_idx] = state_idx

            if len(btc_to_state) > 0 and frame_probs.shape[0] == n_frames:
                # Aggregate softmax probabilities into our state space
                for t in range(n_frames):
                    for cls_idx, state_idx in btc_to_state.items():
                        if cls_idx < frame_probs.shape[1]:
                            obs_prob[state_idx, t] += frame_probs[t, cls_idx]
                # Add floor to prevent zeros
                obs_prob = np.maximum(obs_prob, 0.001)
                used_softmax = True
        except Exception:
            used_softmax = False

    if not used_softmax:
        # Fallback: synthetic one-hot from argmax labels
        for t, (_, label) in enumerate(raw_predictions):
            idx = label_to_idx.get(label)
            if idx is not None:
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
