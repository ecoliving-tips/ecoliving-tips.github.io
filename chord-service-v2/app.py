"""
Swaram Chord Service v2 — FastAPI backend for chord recognition.

Uses BTC (Bi-directional Transformer for Chord Recognition) model
cloned from https://github.com/jayg996/BTC-ISMIR19 at Docker build time.

Endpoint: POST /analyze — accepts audio file, returns chord analysis JSON.
"""

import sys
import os
import time
import tempfile
import logging

import yaml
import numpy as np
import torch
import librosa
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from postprocess import (
    simplify_chord_label,
    apply_enharmonic,
    detect_key,
)

# ---------------------------------------------------------------------------
# BTC imports — the repo is cloned to /app/btc-repo at Docker build time.
# We add it to sys.path so we can import directly.
# ---------------------------------------------------------------------------
BTC_REPO = os.getenv("BTC_REPO_PATH", "/app/btc-repo")
sys.path.insert(0, BTC_REPO)

# Monkey-patch removed numpy aliases used by BTC repo (removed in NumPy 1.24+)
np.float = float
np.int = int
np.complex = complex

from btc_model import BTC_model  # noqa: E402
from utils.mir_eval_modules import idx2chord as idx2chord_list  # noqa: E402
from utils.mir_eval_modules import idx2voca_chord  # noqa: E402
from utils.hparams import HParams  # noqa: E402

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("chord-service")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
VERSION = "2.0.0"
MAX_DURATION_SEC = 300  # 5 minutes
MAX_FILE_SIZE = 30 * 1024 * 1024  # 30 MB
ALLOWED_EXTENSIONS = {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac", ".wma", ".webm"}
SAMPLE_RATE = 22050
HOP_LENGTH = 2048  # BTC default (from run_config.yaml)

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(title="Swaram Chord Service", version=VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Response model
# ---------------------------------------------------------------------------
class ChordEvent(BaseModel):
    time: float
    duration: float
    chord: str


class AnalyzeResponse(BaseModel):
    video_id: str
    key: str = ""
    bpm: int = 0
    time_signature: str = ""
    chords: list[ChordEvent]
    processing_time_ms: int


# ---------------------------------------------------------------------------
# Model loading (runs once at startup)
# ---------------------------------------------------------------------------
device = torch.device("cpu")
model = None
mean = None
std = None
config = None
n_timestep = 108
large_voca_map = None  # dict: index → chord label for 170-class model
use_large_voca = False


def load_model():
    """Load BTC model and checkpoint."""
    global model, mean, std, config, n_timestep, large_voca_map, use_large_voca

    config_path = os.path.join(BTC_REPO, "run_config.yaml")
    # Try large vocab first, fall back to standard
    weight_path = os.path.join(BTC_REPO, "test", "btc_model_large_voca.pt")
    if not os.path.exists(weight_path):
        weight_path = os.path.join(BTC_REPO, "test", "btc_model.pt")
        use_large_voca = False
    else:
        use_large_voca = True

    logger.info(f"Loading BTC config from {config_path}")
    # Load YAML ourselves to avoid HParams.load() using deprecated yaml.load() without Loader
    with open(config_path, "r") as f:
        config_dict = yaml.load(f, Loader=yaml.SafeLoader)
    config = HParams(**config_dict)
    n_timestep = config.model.get("timestep", 108)

    # Override config for large vocab model
    if use_large_voca:
        config.model["num_chords"] = 170
        config.feature["large_voca"] = True
        logger.info("Overriding config for large vocabulary model (170 chords)")

    logger.info(f"Loading BTC weights from {weight_path}")
    model_inst = BTC_model(config=config.model).to(device)
    checkpoint = torch.load(weight_path, map_location=device, weights_only=False)

    mean = checkpoint["mean"]
    std = checkpoint["std"]
    model_inst.load_state_dict(checkpoint["model"])
    model_inst.eval()
    model = model_inst

    # Build large vocabulary mapping: idx → chord label
    # idx2voca_chord() returns a dict {0: 'C:min', 1: 'C', ..., 168: 'X', 169: 'N'}
    large_voca_map = idx2voca_chord()
    logger.info(
        f"BTC model loaded: large_voca={use_large_voca}, "
        f"vocab_size={len(large_voca_map)}"
    )


@app.on_event("startup")
async def startup():
    load_model()


# ---------------------------------------------------------------------------
# Feature extraction (matches BTC's expected input)
# ---------------------------------------------------------------------------
def extract_features(audio_path: str):
    """
    Load audio file, compute CQT features matching BTC input format.
    Returns (feature_matrix, feature_per_second, song_length_sec).
    """
    # Try BTC's built-in feature extraction first (most accurate match)
    try:
        from utils.mir_eval_modules import audio_file_to_features

        feature, feature_per_second, song_length = audio_file_to_features(
            audio_path, config
        )
        logger.info("Using BTC built-in feature extraction")
        # BTC's feature_per_second is actually seconds-per-frame
        # (e.g., 0.1 = each frame covers 0.1s), NOT frames-per-second.
        # Convert to true fps for our downstream code.
        true_fps = 1.0 / feature_per_second if feature_per_second > 0 else 10.0
        return feature, true_fps, song_length
    except Exception as e:
        logger.info(f"BTC feature extraction failed ({e}), using custom fallback")

    # Fallback: custom CQT extraction matching BTC's expected format
    y, sr = librosa.load(audio_path, sr=SAMPLE_RATE, mono=True)

    # Trim silence from beginning/end
    y, _ = librosa.effects.trim(y, top_db=30)

    # Cap duration
    max_samples = MAX_DURATION_SEC * sr
    if len(y) > max_samples:
        y = y[:max_samples]

    song_length = len(y) / sr

    # HPSS — isolate harmonic content for better chord detection
    y_harmonic = librosa.effects.harmonic(y, margin=2.0)

    # CQT extraction matching BTC config: sr=22050, n_bins=144,
    # bins_per_octave=24, hop_length=2048
    n_bins = config.feature.get("n_bins", 144) if isinstance(config.feature, dict) else 144
    bins_per_octave = config.feature.get("bins_per_octave", 24) if isinstance(config.feature, dict) else 24
    hop = config.feature.get("hop_length", HOP_LENGTH) if isinstance(config.feature, dict) else HOP_LENGTH

    cqt = librosa.cqt(
        y=y_harmonic,
        sr=sr,
        hop_length=hop,
        n_bins=n_bins,
        bins_per_octave=bins_per_octave,
    )
    cqt_mag = np.abs(cqt)

    # Log-scale amplitude (standard for CQT features)
    cqt_log = librosa.amplitude_to_db(cqt_mag, ref=np.max)

    # Normalize to [0, 1] range
    cqt_norm = (cqt_log - cqt_log.min()) / (cqt_log.max() - cqt_log.min() + 1e-8)

    feature_per_second = sr / hop
    return cqt_norm, feature_per_second, song_length


# ---------------------------------------------------------------------------
# BTC inference
# ---------------------------------------------------------------------------
def run_btc_inference(feature_matrix, feature_per_second):
    """
    Run BTC model on CQT features, return list of (frame_idx, chord_label) tuples.
    """
    # feature_matrix shape: (n_bins, n_frames) — transpose to (n_frames, n_bins)
    feature = feature_matrix.T

    # Normalize using checkpoint stats
    feature = (feature - mean) / std

    # Pad to multiple of n_timestep
    n_frames = feature.shape[0]
    remainder = n_frames % n_timestep
    if remainder != 0:
        num_pad = n_timestep - remainder
        feature = np.pad(feature, ((0, num_pad), (0, 0)), mode="constant")

    num_segments = feature.shape[0] // n_timestep

    # Run inference segment by segment (matches BTC's own evaluation pattern)
    all_predictions = []
    with torch.no_grad():
        for t in range(num_segments):
            start = n_timestep * t
            end = n_timestep * (t + 1)
            segment = feature[start:end, :]
            segment_tensor = (
                torch.tensor(segment, dtype=torch.float32).unsqueeze(0).to(device)
            )
            # BTC pattern: self_attn_layers → output_layer (not model.forward)
            encoder_output, _ = model.self_attn_layers(segment_tensor)
            prediction, _ = model.output_layer(encoder_output)
            # prediction shape: (1, n_timestep) — squeeze all dims to get (n_timestep,)
            all_predictions.append(prediction.squeeze().cpu())

    chord_indices = torch.cat(all_predictions, dim=0).numpy()  # (total_padded_frames,)

    # Trim padding frames
    chord_indices = chord_indices[:n_frames]

    # Convert to chord labels using the appropriate vocabulary
    if use_large_voca and large_voca_map:
        # Large vocab (170 classes): use idx2voca_chord() mapping
        chord_labels = [
            large_voca_map.get(int(idx), "N") for idx in chord_indices
        ]
    else:
        # Standard vocab (25 classes): use idx2chord list from BTC
        chord_labels = [
            idx2chord_list[int(idx)] if int(idx) < len(idx2chord_list) else "N"
            for idx in chord_indices
        ]

    # Convert frames to time
    results = []
    for i, label in enumerate(chord_labels):
        time_sec = i / feature_per_second
        results.append((time_sec, label))

    return results


# ---------------------------------------------------------------------------
# Main analysis pipeline
# ---------------------------------------------------------------------------
def analyze_audio(audio_path: str, video_id: str = "upload"):
    """Lean pipeline: features → BTC → simplify → merge → cleanup → response."""

    t0 = time.time()

    # 1. Extract features
    logger.info("Extracting CQT features...")
    feature, fps, song_length = extract_features(audio_path)
    logger.info(f"Features: shape={feature.shape}, fps={fps:.1f}, length={song_length:.1f}s")

    # 2. Run BTC inference
    logger.info("Running BTC inference...")
    raw_chords = run_btc_inference(feature, fps)
    logger.info(f"BTC returned {len(raw_chords)} frame predictions")

    # 3. Simplify chord labels
    simplified = [
        (t, simplify_chord_label(label)) for t, label in raw_chords
    ]

    # 4. Merge consecutive identical chords into events
    MIN_DURATION = 0.8  # Filter very short spurious chords
    chord_events = []
    if simplified:
        cur_time, cur_label = simplified[0]
        for i in range(1, len(simplified)):
            t, label = simplified[i]
            if label != cur_label:
                dur = t - cur_time
                if cur_label != "N" and dur >= MIN_DURATION:
                    chord_events.append((cur_time, dur, cur_label))
                cur_time, cur_label = t, label
        # Last chord
        dur = song_length - cur_time
        if cur_label != "N" and dur >= MIN_DURATION:
            chord_events.append((cur_time, min(dur, 30.0), cur_label))

    # 5. Detect key for enharmonic normalization
    key = detect_key(chord_events)
    use_flats = key.rstrip("m") in ("Db", "Eb", "Gb", "Ab", "Bb", "F") or key.endswith("m") and key.rstrip("m") in ("D", "G", "C", "F", "Bb", "Eb")
    logger.info(f"Detected key: {key}, use_flats: {use_flats}")

    # 6. Apply enharmonic normalization (G# → Ab, A# → Bb, D# → Eb etc.)
    chord_events = [
        (t, dur, apply_enharmonic(label, use_flats))
        for t, dur, label in chord_events
    ]

    # 7. Merge again after enharmonic (e.g., G# + Ab that are now both Ab)
    merged = []
    for t, dur, label in chord_events:
        if merged and merged[-1][2] == label:
            prev_t, prev_dur, prev_label = merged[-1]
            merged[-1] = (prev_t, prev_dur + dur, prev_label)
        else:
            merged.append((t, dur, label))
    chord_events = merged

    processing_time = int((time.time() - t0) * 1000)
    logger.info(
        f"Analysis complete: key={key}, chords={len(chord_events)}, time={processing_time}ms"
    )

    return AnalyzeResponse(
        video_id=video_id,
        key=key,
        chords=[
            ChordEvent(time=round(t, 2), duration=round(d, 2), chord=c)
            for t, d, c in chord_events
        ],
        processing_time_ms=processing_time,
    )


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------
@app.get("/health")
async def health():
    return {
        "status": "ok",
        "version": VERSION,
        "model": "BTC-large-voca" if model else "not loaded",
    }


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(
    file: UploadFile = File(...),
    video_id: str = Form(None),
):
    """Analyze an uploaded audio file and return chord recognition results."""

    # Validate file extension
    _, ext = os.path.splitext(file.filename or "")
    if ext.lower() not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {ext}. Allowed: {', '.join(ALLOWED_EXTENSIONS)}",
        )

    # Read file content
    content = await file.read()

    # Validate file size
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"File too large ({len(content) / 1024 / 1024:.1f}MB). Max: {MAX_FILE_SIZE / 1024 / 1024:.0f}MB",
        )

    # Save to temp file
    suffix = ext.lower() if ext else ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        result = analyze_audio(tmp_path, video_id=video_id or "upload")
        return result
    except Exception as e:
        logger.error(f"Analysis failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
