"""
Swaram Chord Detection Service v4.1
FastAPI microservice — detects chords from uploaded audio files using
librosa chroma analysis with HMM/Viterbi decoding and key-aware filtering.

v4.1: Key refinement
  - Post-Viterbi key refinement resolves relative major/minor ambiguity
    (e.g., Eb major vs Cm) by analyzing chord resolution patterns
  - Two-pass Viterbi: if key changes, re-runs with corrected diatonic set

v4.0: Major accuracy overhaul
  - HPSS + chroma_cqt (replaces chroma_stft)
  - Viterbi decoding with key-aware transition matrix (replaces argmax + median)
  - Dual key profile detection (Krumhansl + Temperley)
  - 9th chord templates added
  - Minimum chord duration enforcement
  - Relaxed time signature threshold for 3/4

Optimized for low-CPU environments (Render free tier = 0.1 vCPU).
"""

import os
import re
import tempfile
import logging
from pathlib import Path

import numpy as np
import librosa
from scipy.special import softmax
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ===== Configuration =====
MAX_DURATION_SEC = 240   # 4 minutes max
MAX_UPLOAD_MB = 30
SAMPLE_RATE = 16000      # 16kHz keeps processing fast on 0.1 vCPU
HOP_LENGTH = 2048        # balance between resolution and speed

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("chord-service")

app = FastAPI(title="Swaram Chord Detection", version="4.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ===== Response models =====
class ChordEntry(BaseModel):
    time: float
    duration: float
    chord: str


class AnalyzeResponse(BaseModel):
    videoId: str
    key: str
    bpm: int
    timeSignature: str
    chords: list[ChordEntry]


# ===== Chord Templates =====
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

CHORD_QUALITIES = {
    "":     [0, 4, 7],
    "m":    [0, 3, 7],
    "7":    [0, 4, 7, 10],
    "m7":   [0, 3, 7, 10],
    "M7":   [0, 4, 7, 11],
    "9":    [0, 4, 7, 10, 2],  # dominant 9th (root, M3, P5, m7, M9)
    "m9":   [0, 3, 7, 10, 2],  # minor 9th (root, m3, P5, m7, M9)
    "dim":  [0, 3, 6],
    "aug":  [0, 4, 8],
    "sus4": [0, 5, 7],
    "sus2": [0, 2, 7],
}

# Mapping from note name to semitone index
NOTE_TO_IDX = {name: i for i, name in enumerate(NOTE_NAMES)}
# Flat-to-sharp mapping for normalization
FLAT_TO_SHARP = {
    "Db": "C#", "Eb": "D#", "Fb": "E", "Gb": "F#",
    "Ab": "G#", "Bb": "A#", "Cb": "B",
}


def build_chord_templates() -> tuple[list[str], np.ndarray]:
    """Build chord templates. Returns (names, matrix) for fast vectorized matching."""
    # Complexity penalty: extended chords (7ths, 9ths) get slightly lower template
    # weights so they don't win over triads when the extra note isn't clearly present.
    COMPLEXITY_SCALE = {
        "": 1.0, "m": 1.0, "dim": 1.0, "aug": 1.0, "sus4": 1.0, "sus2": 1.0,
        "7": 0.92, "m7": 0.92, "M7": 0.88,
        "9": 0.85, "m9": 0.85,
    }
    names = []
    templates = []
    for root_idx, root_name in enumerate(NOTE_NAMES):
        for quality_name, intervals in CHORD_QUALITIES.items():
            chord_name = f"{root_name}{quality_name}"
            template = np.zeros(12)
            for interval in intervals:
                template[(root_idx + interval) % 12] = 1.0
            # Boost the root note
            template[root_idx] = 1.5
            # Apply complexity penalty
            template *= COMPLEXITY_SCALE.get(quality_name, 1.0)
            template = template / np.linalg.norm(template)
            names.append(chord_name)
            templates.append(template)
    return names, np.array(templates)


TEMPLATE_NAMES, TEMPLATE_MATRIX = build_chord_templates()
N_TEMPLATES = len(TEMPLATE_NAMES)

# Pre-build lookup: template name -> index
TEMPLATE_NAME_TO_IDX = {name: i for i, name in enumerate(TEMPLATE_NAMES)}
# Pre-build lookup: quality count per root (for indexing)
N_QUALITIES = len(CHORD_QUALITIES)


# ===== Key Profiles =====
# Krumhansl-Schmuckler (1990) — classic, well-validated
KRUMHANSL_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KRUMHANSL_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

# Temperley (2005) — better on pop/folk music
TEMPERLEY_MAJOR = np.array([5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0])
TEMPERLEY_MINOR = np.array([5.0, 2.0, 3.5, 4.5, 2.0, 3.5, 2.0, 4.5, 3.5, 2.0, 1.5, 4.0])


def detect_key(chroma_mean: np.ndarray) -> tuple[str, bool]:
    """
    Detect musical key using dual profile correlation (Krumhansl + Temperley).
    Returns (key_string, is_minor). e.g., ("Cm", True) or ("C", False).
    """
    results = []
    for major_profile, minor_profile, weight in [
        (KRUMHANSL_MAJOR, KRUMHANSL_MINOR, 1.0),
        (TEMPERLEY_MAJOR, TEMPERLEY_MINOR, 1.0),
    ]:
        major_corr = np.array([
            np.corrcoef(chroma_mean, np.roll(major_profile, i))[0, 1]
            for i in range(12)
        ])
        minor_corr = np.array([
            np.corrcoef(chroma_mean, np.roll(minor_profile, i))[0, 1]
            for i in range(12)
        ])
        best_maj_idx = np.argmax(major_corr)
        best_min_idx = np.argmax(minor_corr)
        best_maj_score = major_corr[best_maj_idx]
        best_min_score = minor_corr[best_min_idx]
        results.append((best_maj_idx, best_maj_score, best_min_idx, best_min_score, weight))

    # Weighted vote: sum up scores across profiles
    major_votes = {}  # root_idx -> total weighted score
    minor_votes = {}
    for maj_idx, maj_score, min_idx, min_score, w in results:
        major_votes[maj_idx] = major_votes.get(maj_idx, 0) + maj_score * w
        minor_votes[min_idx] = minor_votes.get(min_idx, 0) + min_score * w

    best_maj_key = max(major_votes, key=major_votes.get)
    best_min_key = max(minor_votes, key=minor_votes.get)
    best_maj_total = major_votes[best_maj_key]
    best_min_total = minor_votes[best_min_key]

    if best_maj_total >= best_min_total:
        return NOTE_NAMES[best_maj_key], False
    else:
        return NOTE_NAMES[best_min_key] + "m", True


def refine_key_with_chords(
    initial_key: str, is_minor: bool, chord_names: list[str], chord_durations: list[float]
) -> tuple[str, bool]:
    """
    Post-Viterbi key refinement: resolve relative major/minor ambiguity by
    analyzing which tonic the detected chords actually resolve to.

    E.g., if chroma says Eb major but chords land on Cm far more than Eb,
    the real key is Cm (relative minor of Eb).
    """
    if not chord_names:
        return initial_key, is_minor

    root_name = initial_key.rstrip("m")
    for flat, sharp in FLAT_TO_SHARP.items():
        if root_name == flat:
            root_name = sharp
            break
    root_idx = NOTE_TO_IDX.get(root_name, 0)

    if is_minor:
        rel_idx = (root_idx + 3) % 12  # relative major
        candidate_minor_root = root_idx
        candidate_major_root = rel_idx
    else:
        rel_idx = (root_idx - 3) % 12  # relative minor
        candidate_major_root = root_idx
        candidate_minor_root = rel_idx

    minor_root_name = NOTE_NAMES[candidate_minor_root]
    major_root_name = NOTE_NAMES[candidate_major_root]

    # Count weighted chord occurrences
    chord_weights = {}
    for name, dur in zip(chord_names, chord_durations):
        chord_weights[name] = chord_weights.get(name, 0.0) + dur

    # Score for minor key candidate
    minor_score = 0.0
    # Direct tonic chords (i, i7)
    minor_score += chord_weights.get(minor_root_name + "m", 0) * 1.5
    minor_score += chord_weights.get(minor_root_name + "m7", 0) * 1.5
    # Dominant V7 (strongest indicator of minor key — G7 for Cm)
    dom_minor_name = NOTE_NAMES[(candidate_minor_root + 7) % 12]
    minor_score += chord_weights.get(dom_minor_name + "7", 0) * 3.0
    minor_score += chord_weights.get(dom_minor_name, 0) * 1.0
    # Subdominant iv (Fm for Cm)
    subdominant_minor = NOTE_NAMES[(candidate_minor_root + 5) % 12]
    minor_score += chord_weights.get(subdominant_minor + "m", 0) * 0.5
    minor_score += chord_weights.get(subdominant_minor + "m7", 0) * 0.5

    # Score for major key candidate
    major_score = 0.0
    # Direct tonic chord — plain triad only (M7 is ambiguous: could be III of relative minor)
    major_score += chord_weights.get(major_root_name, 0) * 1.5
    major_score += chord_weights.get(major_root_name + "M7", 0) * 0.3
    # Dominant V7 (strongest indicator of major key — B7 for Eb)
    dom_major_name = NOTE_NAMES[(candidate_major_root + 7) % 12]
    major_score += chord_weights.get(dom_major_name + "7", 0) * 3.0
    major_score += chord_weights.get(dom_major_name, 0) * 1.0
    # Subdominant IV (Ab for Eb) — also ambiguous (VI of minor), low weight
    subdominant_major = NOTE_NAMES[(candidate_major_root + 5) % 12]
    major_score += chord_weights.get(subdominant_major, 0) * 0.3
    major_score += chord_weights.get(subdominant_major + "M7", 0) * 0.3

    # Anchor bonus: first and last chords are strong tonic hints
    for anchor in [chord_names[0], chord_names[-1]]:
        if anchor in (minor_root_name + "m", minor_root_name + "m7"):
            minor_score += 5.0
        elif anchor in (major_root_name, major_root_name + "M7"):
            major_score += 5.0

    logger.info("Key refinement: minor(%sm)=%.1f vs major(%s)=%.1f",
                minor_root_name, minor_score, major_root_name, major_score)

    if is_minor:
        # Currently minor — only switch to major if major clearly dominates
        if major_score > minor_score * 1.5:
            new_key = NOTE_NAMES[candidate_major_root]
            logger.info("Key refined: %s -> %s", initial_key, new_key)
            return new_key, False
        return initial_key, is_minor
    else:
        # Currently major — switch to minor if minor wins
        if minor_score > major_score:
            new_key = NOTE_NAMES[candidate_minor_root] + "m"
            logger.info("Key refined: %s -> %s", initial_key, new_key)
            return new_key, True
        return initial_key, is_minor


# Sharp-to-flat mapping for enharmonic normalization
SHARP_TO_FLAT = {v: k for k, v in FLAT_TO_SHARP.items()}  # C# -> Db, D# -> Eb, etc.

# Keys that conventionally use flats (major keys and their relative minors)
FLAT_KEYS = {"F", "Bb", "Eb", "Ab", "Db", "Gb",
             "Dm", "Gm", "Cm", "Fm", "Bbm", "Ebm"}


def normalize_enharmonic(chords: list[dict], key_str: str) -> tuple[list[dict], str]:
    """
    Convert sharp chord names to flats when the key conventionally uses flats.
    E.g., in key Cm: D# → Eb, G# → Ab, A# → Bb.
    Also normalizes the key string itself.
    """
    # Check if key uses flats (normalize from sharps first to check)
    key_root = key_str.rstrip("m")
    key_suffix = "m" if key_str.endswith("m") else ""

    # If key root is sharp, check if the flat equivalent is a flat key
    flat_root = SHARP_TO_FLAT.get(key_root)
    if flat_root and (flat_root + key_suffix) in FLAT_KEYS:
        use_flats = True
        key_str = flat_root + key_suffix
    elif (key_root + key_suffix) in FLAT_KEYS:
        use_flats = True
    else:
        use_flats = False

    if not use_flats:
        return chords, key_str

    for chord in chords:
        name = chord["chord"]
        # Extract root (e.g., "C#" from "C#m7")
        m = re.match(r'^([A-G]#?)(.*)', name)
        if m:
            root, quality = m.group(1), m.group(2)
            if root in SHARP_TO_FLAT:
                chord["chord"] = SHARP_TO_FLAT[root] + quality

    return chords, key_str


def get_diatonic_chord_indices(key_str: str) -> set[int]:
    """
    Given a key string (e.g., "Cm", "C", "G#m"), return the set of template indices
    for diatonic and commonly borrowed chords.
    """
    is_minor = key_str.endswith("m")
    root_name = key_str[:-1] if is_minor else key_str
    # Normalize flats to sharps
    for flat, sharp in FLAT_TO_SHARP.items():
        if root_name == flat:
            root_name = sharp
            break
    root = NOTE_TO_IDX.get(root_name, 0)

    diatonic_indices = set()

    def add_chord(semitone_from_root: int, quality: str):
        """Add a chord to diatonic set if it exists in our templates."""
        note_idx = (root + semitone_from_root) % 12
        chord_name = f"{NOTE_NAMES[note_idx]}{quality}"
        if chord_name in TEMPLATE_NAME_TO_IDX:
            diatonic_indices.add(TEMPLATE_NAME_TO_IDX[chord_name])

    if is_minor:
        # Natural minor: i, iiº, III, iv, v, VI, VII
        add_chord(0, "m")       # i  (Cm)
        add_chord(0, "m7")      # i7 (Cm7)
        add_chord(2, "dim")     # iiº (Ddim)
        add_chord(3, "")        # III (Eb)
        add_chord(3, "M7")      # IIIM7 (EbM7)
        add_chord(3, "9")       # III9 (Eb9)
        add_chord(5, "m")       # iv  (Fm)
        add_chord(5, "m7")      # iv7 (Fm7)
        add_chord(7, "m")       # v   (Gm)
        add_chord(7, "m7")      # v7  (Gm7)
        add_chord(8, "")        # VI  (Ab)
        add_chord(8, "M7")      # VIM7 (AbM7)
        add_chord(8, "9")       # VI9 (Ab9)
        add_chord(10, "")       # VII (Bb)
        add_chord(10, "7")      # VII7 (Bb7)
        add_chord(10, "9")      # VII9 (Bb9)
        # Harmonic minor: raised 7th → major V, V7
        add_chord(7, "")        # V   (G)
        add_chord(7, "7")       # V7  (G7)
        # Borrowed: major I (Picardy third)
        add_chord(0, "")        # I   (C)
        # Borrowed: iv as major IV
        add_chord(5, "")        # IV  (F)
    else:
        # Major: I, ii, iii, IV, V, vi, viiº
        add_chord(0, "")        # I   (C)
        add_chord(0, "M7")      # IM7 (CM7)
        add_chord(2, "m")       # ii  (Dm)
        add_chord(2, "m7")      # ii7 (Dm7)
        add_chord(4, "m")       # iii (Em)
        add_chord(4, "m7")      # iii7 (Em7)
        add_chord(4, "m9")      # iii9 (Em9)
        add_chord(5, "")        # IV  (F)
        add_chord(5, "M7")      # IVM7 (FM7)
        add_chord(7, "")        # V   (G)
        add_chord(7, "7")       # V7  (G7)
        add_chord(7, "sus4")    # Vsus4 (Gsus4)
        add_chord(9, "m")       # vi  (Am)
        add_chord(9, "m7")      # vi7 (Am7)
        add_chord(11, "dim")    # viiº (Bdim)
        # Common borrowed chords
        add_chord(9, "")        # VI (A) — borrowed from parallel minor
        add_chord(9, "7")       # VI7 (A7) — secondary dominant
        add_chord(11, "")       # VII (B) — leading tone chord
        add_chord(11, "7")      # VII7 (B7) — secondary dominant of iii
        add_chord(2, "")        # II (D) — secondary dominant of V
        add_chord(4, "")        # III (E) — secondary dominant of vi

    return diatonic_indices


def build_transition_matrix(diatonic_indices: set[int]) -> np.ndarray:
    """
    Build a chord transition matrix for Viterbi decoding.
    High self-transition, boosted diatonic transitions, low chromatic.
    """
    n = N_TEMPLATES
    # Base: tiny uniform probability for any transition
    trans = np.full((n, n), 0.0005)
    # Self-transition: chords tend to persist across multiple beats
    np.fill_diagonal(trans, 0.90)
    # Diatonic-to-diatonic: moderate probability
    for i in diatonic_indices:
        for j in diatonic_indices:
            if i != j:
                trans[i, j] = 0.02
    # Diatonic-to-non-diatonic: small bump (chromatic passing chords)
    for i in diatonic_indices:
        for j in range(n):
            if j not in diatonic_indices and i != j:
                trans[i, j] = 0.002
    # Normalize rows to sum to 1
    row_sums = trans.sum(axis=1, keepdims=True)
    row_sums[row_sums == 0] = 1.0
    trans = trans / row_sums
    return trans


# ===== Audio Analysis Pipeline =====
def analyze_audio(y: np.ndarray, sr: int) -> dict:
    """
    Full chord analysis pipeline with HMM/Viterbi decoding.
    Target: < 90s on 0.1 vCPU for 4min audio.
    """
    if len(y) < sr * 2:
        raise ValueError("Audio too short (< 2 seconds)")

    logger.info("Audio loaded: %.1fs at %dHz", len(y) / sr, sr)

    # 1. Harmonic-Percussive Source Separation (skip for long audio to save time)
    #    Use harmonic component for chroma (cleaner tonal content)
    #    Use full signal for beat tracking (percussive helps)
    audio_duration = len(y) / sr
    if audio_duration <= 240:  # HPSS for audio up to 4 minutes
        logger.info("HPSS separation (hop=%d to save memory)...", HOP_LENGTH)
        # Use our larger HOP_LENGTH instead of librosa's default 512
        # to reduce STFT memory from ~260MB to ~65MB (4x reduction)
        S = librosa.stft(y, hop_length=HOP_LENGTH)
        H, _ = librosa.decompose.hpss(S)
        y_harm = librosa.istft(H, hop_length=HOP_LENGTH, length=len(y))
        del S, H  # free STFT memory before chroma computation
    else:
        logger.info("Skipping HPSS (audio > 4min, optimizing for speed)")
        y_harm = y

    # 2. Beat tracking on full signal
    logger.info("Beat tracking...")
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, hop_length=HOP_LENGTH)
    bpm = round(float(tempo) if np.isscalar(tempo) else float(tempo[0]))
    logger.info("BPM: %d, beats: %d", bpm, len(beat_frames))

    # 3. Chroma features
    #    CQT is better quality but ~5x slower than STFT on low-CPU.
    #    Use CQT for short audio, STFT for longer to avoid Render timeout.
    if audio_duration <= 240:
        logger.info("Computing chroma (CQT)...")
        chroma = librosa.feature.chroma_cqt(y=y_harm, sr=sr, hop_length=HOP_LENGTH, n_chroma=12)
    else:
        logger.info("Computing chroma (STFT, faster for long audio)...")
        chroma = librosa.feature.chroma_stft(y=y_harm, sr=sr, hop_length=HOP_LENGTH, n_chroma=12)

    # 4. Key detection FIRST (needed for Viterbi weighting)
    chroma_mean = chroma.mean(axis=1)
    key_str, is_minor = detect_key(chroma_mean)
    logger.info("Detected key: %s", key_str)

    # 5. Sync chroma to beats
    if len(beat_frames) >= 2:
        beat_chroma = librosa.util.sync(chroma, beat_frames, aggregate=np.median).T
        beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=HOP_LENGTH)
    else:
        frame_len = int(sr * 0.5 / HOP_LENGTH)
        n_frames = max(1, chroma.shape[1] // frame_len)
        beat_chroma = np.array([
            chroma[:, i * frame_len:(i + 1) * frame_len].mean(axis=1)
            for i in range(n_frames)
        ])
        beat_times = np.arange(n_frames) * 0.5

    n_beats = beat_chroma.shape[0]
    if n_beats < 2:
        raise ValueError("Not enough beats detected")

    # 6. Compute observation probabilities (cosine similarity → softmax)
    logger.info("Computing observation probabilities...")
    norms = np.linalg.norm(beat_chroma, axis=1, keepdims=True)
    norms[norms < 1e-6] = 1.0
    beat_chroma_norm = beat_chroma / norms
    similarities = beat_chroma_norm @ TEMPLATE_MATRIX.T  # (n_beats, n_templates)

    # Mark silent frames
    is_silent = np.linalg.norm(beat_chroma, axis=1) < 1e-6

    # Softmax with temperature to convert similarities to probabilities
    # Lower temperature = sharper (more confident), higher = more uniform
    temperature = 0.15
    obs_prob_base = softmax(similarities / temperature, axis=1).T  # (n_templates, n_beats)

    def run_viterbi_pass(key_str_pass: str) -> list[dict]:
        """Run key-aware Viterbi decoding and return merged chord list."""
        obs_prob = obs_prob_base.copy()

        diatonic_indices = get_diatonic_chord_indices(key_str_pass)
        logger.info("Diatonic chords (%d): %s", len(diatonic_indices),
                     [TEMPLATE_NAMES[i] for i in sorted(diatonic_indices)])

        diatonic_boost = np.ones(N_TEMPLATES)
        for idx in diatonic_indices:
            diatonic_boost[idx] = 3.0
        obs_prob *= diatonic_boost[:, np.newaxis]
        col_sums = obs_prob.sum(axis=0, keepdims=True)
        col_sums[col_sums == 0] = 1.0
        obs_prob /= col_sums

        for i in range(n_beats):
            if is_silent[i]:
                obs_prob[:, i] = 1.0 / N_TEMPLATES

        transition = build_transition_matrix(diatonic_indices)
        states = librosa.sequence.viterbi_discriminative(obs_prob, transition)

        total_dur = len(y) / sr
        chords = []
        for i in range(n_beats):
            if is_silent[i]:
                continue
            idx = int(states[i])
            t_start = float(beat_times[i]) if i < len(beat_times) else 0.0
            if i + 1 < len(beat_times):
                dur = float(beat_times[i + 1] - beat_times[i])
            else:
                dur = float(total_dur - t_start)
            # Clamp individual beat duration (abnormally long = likely silence/noise)
            dur = min(dur, 30.0)
            chords.append({
                "time": round(t_start, 2),
                "duration": round(max(dur, 0.1), 2),
                "chord": TEMPLATE_NAMES[idx],
            })

        merged = []
        for chord in chords:
            if merged and merged[-1]["chord"] == chord["chord"]:
                merged[-1]["duration"] = round(merged[-1]["duration"] + chord["duration"], 2)
            else:
                merged.append(dict(chord))

        MIN_CHORD_DURATION = 0.4
        if len(merged) > 1:
            filtered = [merged[0]]
            for i in range(1, len(merged)):
                if merged[i]["duration"] < MIN_CHORD_DURATION and filtered:
                    filtered[-1]["duration"] = round(
                        filtered[-1]["duration"] + merged[i]["duration"], 2
                    )
                else:
                    filtered.append(merged[i])
            merged = filtered

        return merged

    # 7-11. First Viterbi pass with chroma-detected key
    logger.info("Viterbi pass 1 with key=%s...", key_str)
    merged = run_viterbi_pass(key_str)

    if not merged:
        raise ValueError("No chords detected in this audio")

    # 12. Post-Viterbi key refinement (resolve relative major/minor ambiguity)
    chord_names = [c["chord"] for c in merged]
    chord_durations = [c["duration"] for c in merged]
    refined_key, refined_is_minor = refine_key_with_chords(key_str, is_minor, chord_names, chord_durations)

    if refined_key != key_str:
        # Key changed — re-run Viterbi with corrected diatonic set
        logger.info("Viterbi pass 2 with refined key=%s...", refined_key)
        key_str = refined_key
        is_minor = refined_is_minor
        merged = run_viterbi_pass(key_str)
        if not merged:
            raise ValueError("No chords detected in this audio")

    # 13. Time signature estimation (relaxed threshold for 3/4)
    time_sig = "4/4"
    if len(beat_frames) >= 9:
        onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP_LENGTH)
        bs = onset_env[beat_frames[beat_frames < len(onset_env)]]
        if len(bs) >= 9:
            def gscore(g):
                n = len(bs) - (len(bs) % g)
                if n == 0:
                    return 0
                groups = bs[:n].reshape(-1, g)
                return np.mean(groups[:, 0]) / (np.mean(groups[:, 1:]) + 1e-8)

            score3 = gscore(3)
            score4 = gscore(4)
            # Relaxed threshold: 1.05 instead of 1.15
            if score3 > score4 * 1.05:
                time_sig = "3/4"
            # BPM hint: waltz tempo range strongly suggests 3/4
            elif 80 <= bpm <= 140 and score3 > score4 * 0.95:
                time_sig = "3/4"

    logger.info("Done: %d chords, key=%s, bpm=%d, time=%s", len(merged), key_str, bpm, time_sig)

    # 14. Enharmonic normalization — use flats for flat keys, sharps for sharp keys
    merged, key_str = normalize_enharmonic(merged, key_str)

    return {"key": key_str, "bpm": bpm, "timeSignature": time_sig, "chords": merged}


# ===== API Endpoints =====
@app.get("/")
def root():
    return {"name": "Swaram Chord Detection", "version": "4.1.0", "docs": "/docs"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/analyze-upload")
async def analyze_upload(
    file: UploadFile = File(...),
    video_id: str = Form(default=""),
):
    """Analyze an uploaded audio file for chords."""
    contents = await file.read()
    size_mb = len(contents) / (1024 * 1024)
    if size_mb > MAX_UPLOAD_MB:
        raise HTTPException(413, f"File too large ({size_mb:.1f}MB). Max {MAX_UPLOAD_MB}MB.")

    allowed = {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac", ".wma", ".webm"}
    ext = Path(file.filename).suffix.lower() if file.filename else ""
    if ext not in allowed:
        raise HTTPException(415, f"Unsupported type '{ext}'. Use: {', '.join(sorted(allowed))}")

    with tempfile.TemporaryDirectory() as tmpdir:
        audio_path = os.path.join(tmpdir, f"upload{ext}")
        with open(audio_path, "wb") as f:
            f.write(contents)

        logger.info("Uploaded: %s (%.1fMB)", file.filename, size_mb)

        try:
            y, sr = librosa.load(audio_path, sr=SAMPLE_RATE, mono=True, duration=MAX_DURATION_SEC)
        except Exception as e:
            logger.error("Load failed: %s", e)
            raise HTTPException(422, f"Could not read audio file: {e}")

        try:
            result = analyze_audio(y, sr)
        except ValueError as e:
            raise HTTPException(422, str(e))
        except Exception as e:
            logger.error("Analysis failed: %s", e)
            raise HTTPException(500, f"Chord detection failed: {e}")

        return AnalyzeResponse(
            videoId=video_id or "upload",
            key=result["key"],
            bpm=result["bpm"],
            timeSignature=result["timeSignature"],
            chords=[ChordEntry(**c) for c in result["chords"]],
        )


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 7860))
    uvicorn.run(app, host="0.0.0.0", port=port)
