"""
Swaram Chord Service v2 — FastAPI backend for chord recognition.

Uses BTC (Bi-directional Transformer for Chord Recognition) model
cloned from https://github.com/jayg996/BTC-ISMIR19 at Docker build time.

Endpoint: POST /analyze — accepts audio file, returns chord analysis JSON.
"""

import sys
import os
import re
import time
import asyncio
import tempfile
import logging

import yaml
import numpy as np
import torch
import librosa
import httpx
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from postprocess import (
    simplify_chord_label,
    merge_consecutive_chords,
    median_filter_chords,
    viterbi_smooth_chords,
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
VERSION = "3.0.0"
MAX_DURATION_SEC = 300  # 5 minutes
MAX_FILE_SIZE = 30 * 1024 * 1024  # 30 MB
ALLOWED_EXTENSIONS = {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac", ".wma", ".webm"}

# YouTube audio extraction — server-side (no CORS restrictions)
YT_VIDEO_ID_RE = re.compile(r'^[A-Za-z0-9_-]{11}$')
YT_URL_PATTERNS = [
    re.compile(r'(?:youtube\.com/watch\?.*v=)([A-Za-z0-9_-]{11})'),
    re.compile(r'(?:youtu\.be/)([A-Za-z0-9_-]{11})'),
    re.compile(r'(?:youtube\.com/embed/)([A-Za-z0-9_-]{11})'),
    re.compile(r'(?:youtube\.com/shorts/)([A-Za-z0-9_-]{11})'),
]
YT_METADATA_TIMEOUT = 10.0
YT_DOWNLOAD_TIMEOUT = 60.0
YT_MIN_AUDIO_BYTES = 10_000
YT_MAX_DURATION_SEC = 600  # 10 min — download cap (analysis truncates to MAX_DURATION_SEC)

YT_PIPED_INSTANCES = [
    'https://api.piped.private.coffee', # WORKING — only official instance (Apr 2026)
]
YT_PIPED_MAX_RETRIES = 3              # Retry transient 500s with backoff
YT_PIPED_RETRY_DELAY = 2.0            # Seconds between retries
YT_INVIDIOUS_INSTANCES = [
    'https://inv.thepixora.com',        # /latest_version fallback (API returns 403)
]

# Cobalt API — public YouTube audio extraction service (tunnel mode proxies audio)
YT_COBALT_INSTANCES = [
    'https://api.cobalt.tools',         # Official API endpoint
]
YT_COBALT_TIMEOUT = 15.0               # Metadata request timeout
YT_COBALT_DOWNLOAD_TIMEOUT = 90.0      # Audio download timeout (tunnel can be slow)

# External extraction microservice (yt-dlp on a platform with YouTube access)
# Set YT_EXTRACT_URL and YT_EXTRACT_API_KEY via environment variables
YT_EXTRACT_URL = os.getenv("YT_EXTRACT_URL", "")       # e.g. https://my-app.koyeb.app/extract
YT_EXTRACT_API_KEY = os.getenv("YT_EXTRACT_API_KEY", "")
YT_EXTRACT_TIMEOUT = 120.0  # yt-dlp can be slow on free tiers
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
    Run BTC model on CQT features.

    Returns:
        predictions: list of (time_sec, chord_label)
        frame_probs: dict mapping chord_label → np.array of per-frame probabilities
                     (None if softmax extraction fails)
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
    all_logits = []
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
            # Extract raw logits directly from the linear projection layer
            # output_layer returns (top1_indices, top2_indices) — NOT logits
            # So we call output_projection ourselves to get (1, n_timestep, n_classes)
            logits = model.output_layer.output_projection(encoder_output)
            all_logits.append(logits.squeeze(0).cpu())

    chord_indices = torch.cat(all_predictions, dim=0).numpy()  # (total_padded_frames,)

    # Trim padding frames
    chord_indices = chord_indices[:n_frames]

    # Build softmax probability matrix from raw logits
    frame_probs = None
    try:
        logits_cat = torch.cat(all_logits, dim=0)[:n_frames]  # (n_frames, n_classes)
        frame_probs = torch.nn.functional.softmax(logits_cat, dim=-1).numpy()
    except Exception as e:
        logger.debug(f"Could not build softmax probabilities: {e}")

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

    return results, frame_probs


# ---------------------------------------------------------------------------
# Main analysis pipeline
# ---------------------------------------------------------------------------
def analyze_audio(audio_path: str, video_id: str = "upload"):
    """Lean pipeline: features → BTC → simplify → median filter → Viterbi → group → cleanup → response."""

    t0 = time.time()

    # 1. Extract features
    logger.info("Extracting CQT features...")
    feature, fps, song_length = extract_features(audio_path)
    logger.info(f"Features: shape={feature.shape}, fps={fps:.1f}, length={song_length:.1f}s")

    # 2. Run BTC inference
    logger.info("Running BTC inference...")
    raw_chords, frame_probs = run_btc_inference(feature, fps)
    logger.info(f"BTC returned {len(raw_chords)} frame predictions (softmax={'yes' if frame_probs is not None else 'no'})")

    # 3. Simplify chord labels (preserve richer vocabulary: dim7, mM7, 6, m6)
    simplified = [
        (t, simplify_chord_label(label)) for t, label in raw_chords
    ]

    # 4. Median pre-filter — remove single-frame chord blips before Viterbi
    simplified = median_filter_chords(simplified, window=5)

    # 5. Viterbi HMM smoothing (key-agnostic — pure chord persistence)
    #    Uses BTC softmax probabilities when available for richer observation model
    logger.info("Applying Viterbi HMM smoothing...")
    smoothed = viterbi_smooth_chords(
        simplified, None, song_length,
        frame_probs=frame_probs,
        vocab_map=large_voca_map if use_large_voca else None,
    )

    # 6. Group consecutive same-label frames into duration events
    chord_events = []
    if smoothed:
        cur_time, cur_label = smoothed[0]
        for i in range(1, len(smoothed)):
            t_val, label = smoothed[i]
            if label != cur_label:
                dur = t_val - cur_time
                chord_events.append((cur_time, dur, cur_label))
                cur_time, cur_label = t_val, label
        dur = song_length - cur_time
        chord_events.append((cur_time, min(dur, 30.0), cur_label))

    # 7. Filter out "N" chords and very short events
    MIN_DURATION = 0.3
    chord_events = [
        (t_val, dur, label) for t_val, dur, label in chord_events
        if label != "N" and dur >= MIN_DURATION
    ]

    # 8. Merge consecutive identical chords
    chord_events = merge_consecutive_chords(chord_events)

    # Clamp last chord duration to 30s max
    if chord_events:
        last_t, last_dur, last_c = chord_events[-1]
        if last_dur > 30.0:
            chord_events[-1] = (last_t, 30.0, last_c)

    processing_time = int((time.time() - t0) * 1000)
    logger.info(
        f"Analysis complete: chords={len(chord_events)}, time={processing_time}ms"
    )

    return AnalyzeResponse(
        video_id=video_id,
        chords=[
            ChordEvent(time=round(t, 2), duration=round(d, 2), chord=c)
            for t, d, c in chord_events
        ],
        processing_time_ms=processing_time,
    )


# ---------------------------------------------------------------------------
# YouTube audio extraction — server-side, 3-tier cascade
# ---------------------------------------------------------------------------
def extract_video_id(url: str) -> str | None:
    """Extract YouTube video ID from URL (SSRF-safe: only the ID is used downstream)."""
    if not url:
        return None
    # Accept bare 11-char ID
    if YT_VIDEO_ID_RE.match(url.strip()):
        return url.strip()
    for pattern in YT_URL_PATTERNS:
        m = pattern.search(url)
        if m:
            return m.group(1)
    return None


async def _stream_to_tempfile(resp: httpx.Response) -> str:
    """Stream an httpx response body to a temp .m4a file. Returns path."""
    tmp = tempfile.NamedTemporaryFile(suffix=".m4a", delete=False)
    try:
        total = 0
        async for chunk in resp.aiter_bytes(65536):
            total += len(chunk)
            if total > MAX_FILE_SIZE:
                raise ValueError(f"Audio too large ({total} bytes)")
            tmp.write(chunk)
        tmp.close()
        if total < YT_MIN_AUDIO_BYTES:
            raise ValueError(f"Audio too small ({total} bytes)")
        return tmp.name
    except Exception:
        tmp.close()
        try:
            os.unlink(tmp.name)
        except OSError:
            pass
        raise


async def _try_invidious_latest(video_id: str) -> str | None:
    """Tier 2: Invidious /latest_version — redirect to googlevideo.com audio."""
    for inst in YT_INVIDIOUS_INSTANCES:
        try:
            logger.info(f"[YT-Inv-LV] Trying {inst}...")
            async with httpx.AsyncClient(follow_redirects=True, timeout=YT_DOWNLOAD_TIMEOUT) as client:
                async with client.stream(
                    "GET",
                    f"{inst}/latest_version",
                    params={"id": video_id, "itag": "140"},
                ) as resp:
                    if resp.status_code not in (200, 206):
                        raise ValueError(f"HTTP {resp.status_code}")
                    ct = resp.headers.get("content-type", "")
                    if "text/html" in ct:
                        raise ValueError("Got HTML, not audio")
                    path = await _stream_to_tempfile(resp)
                    logger.info(f"[YT-Inv-LV] Success via {inst}")
                    return path
        except Exception as e:
            logger.warning(f"[YT-Inv-LV] {inst} failed: {e}")
    return None


async def _try_piped(video_id: str) -> str | None:
    """Tier 1: Piped /streams — proxy audio URLs, with retry for transient 500s."""
    for inst in YT_PIPED_INSTANCES:
        for attempt in range(1, YT_PIPED_MAX_RETRIES + 1):
            try:
                logger.info(f"[YT-Piped] Trying {inst} (attempt {attempt}/{YT_PIPED_MAX_RETRIES})...")
                async with httpx.AsyncClient(timeout=YT_METADATA_TIMEOUT) as client:
                    resp = await client.get(f"{inst}/streams/{video_id}")
                    if resp.status_code == 500 and attempt < YT_PIPED_MAX_RETRIES:
                        logger.warning(f"[YT-Piped] {inst} returned 500, retrying in {YT_PIPED_RETRY_DELAY}s...")
                        await asyncio.sleep(YT_PIPED_RETRY_DELAY)
                        continue
                    if resp.status_code != 200:
                        raise ValueError(f"HTTP {resp.status_code}")
                    data = resp.json()

                if not data.get("audioStreams"):
                    raise ValueError("No audio streams")
                duration = data.get("duration", 0)
                if duration and duration > YT_MAX_DURATION_SEC:
                    raise ValueError(f"Video too long ({duration}s)")

                # Prefer itag 140 (M4A 128kbps)
                streams = data["audioStreams"]
                stream = next((s for s in streams if s.get("itag") == 140), None)
                if not stream:
                    candidates = sorted(
                        [s for s in streams if s.get("bitrate", 0) < 170000],
                        key=lambda s: s.get("bitrate", 0), reverse=True,
                    )
                    stream = candidates[0] if candidates else streams[0]

                audio_url = stream.get("url")
                if not audio_url:
                    raise ValueError("No stream URL")

                async with httpx.AsyncClient(follow_redirects=True, timeout=YT_DOWNLOAD_TIMEOUT) as dl_client:
                    async with dl_client.stream("GET", audio_url) as stream_resp:
                        if stream_resp.status_code not in (200, 206):
                            if stream_resp.status_code == 502 and attempt < YT_PIPED_MAX_RETRIES:
                                logger.warning(f"[YT-Piped] Proxy 502, retrying in {YT_PIPED_RETRY_DELAY}s...")
                                await asyncio.sleep(YT_PIPED_RETRY_DELAY)
                                continue
                            raise ValueError(f"Audio download HTTP {stream_resp.status_code}")
                        path = await _stream_to_tempfile(stream_resp)
                        logger.info(f"[YT-Piped] Success via {inst} (attempt {attempt})")
                        return path
            except Exception as e:
                if attempt < YT_PIPED_MAX_RETRIES and "500" in str(e):
                    logger.warning(f"[YT-Piped] {inst} attempt {attempt} failed: {e}, retrying...")
                    await asyncio.sleep(YT_PIPED_RETRY_DELAY)
                    continue
                logger.warning(f"[YT-Piped] {inst} failed after {attempt} attempts: {e}")
                break  # Move to next instance
    return None


async def _try_cobalt(video_id: str) -> str | None:
    """Tier 2: Cobalt API — public YouTube extraction with tunneled audio download.

    Cobalt proxies the audio through its own servers ('tunnel' mode),
    so the download URL is NOT a direct googlevideo.com link.
    This avoids the IP-lock issue that blocks direct YouTube downloads from HF Spaces.
    """
    yt_url = f"https://www.youtube.com/watch?v={video_id}"

    for inst in YT_COBALT_INSTANCES:
        # Try v10 API payload first, then v7 fallback
        payloads = [
            {
                "endpoint": "/",
                "body": {
                    "url": yt_url,
                    "downloadMode": "audio",
                    "audioFormat": "mp3",
                    "audioBitrate": "128",
                },
            },
            {
                "endpoint": "/api/json",
                "body": {
                    "url": yt_url,
                    "isAudioOnly": True,
                    "aFormat": "mp3",
                },
            },
        ]

        for payload in payloads:
            ep = payload["endpoint"]
            try:
                logger.info(f"[YT-Cobalt] Trying {inst}{ep}...")
                async with httpx.AsyncClient(timeout=YT_COBALT_TIMEOUT) as client:
                    resp = await client.post(
                        f"{inst}{ep}",
                        json=payload["body"],
                        headers={
                            "Accept": "application/json",
                            "Content-Type": "application/json",
                        },
                    )
                    if resp.status_code != 200:
                        raise ValueError(f"HTTP {resp.status_code}")
                    data = resp.json()

                # Cobalt returns status: "error" for failures
                status = data.get("status", "")
                if status == "error":
                    err_code = data.get("error", {})
                    if isinstance(err_code, dict):
                        err_code = err_code.get("code", "unknown")
                    raise ValueError(f"Cobalt error: {err_code}")

                # Get audio URL — could be 'url' (tunnel/redirect) or 'stream'
                audio_url = data.get("url") or data.get("stream")
                if not audio_url:
                    raise ValueError("No audio URL in response")

                logger.info(f"[YT-Cobalt] Got audio URL (status={status}), downloading...")

                # Download the audio (tunnel URLs are proxied through Cobalt)
                async with httpx.AsyncClient(
                    follow_redirects=True, timeout=YT_COBALT_DOWNLOAD_TIMEOUT
                ) as dl_client:
                    async with dl_client.stream("GET", audio_url) as stream_resp:
                        if stream_resp.status_code not in (200, 206):
                            raise ValueError(f"Audio download HTTP {stream_resp.status_code}")
                        path = await _stream_to_tempfile(stream_resp)
                        logger.info(f"[YT-Cobalt] Success via {inst} ({os.path.getsize(path)} bytes)")
                        return path

            except Exception as e:
                logger.warning(f"[YT-Cobalt] {inst}{ep} failed: {e}")
    return None


async def _try_extract_service(video_id: str) -> str | None:
    """Tier 3: External yt-dlp extraction microservice (Koyeb/Railway/etc.).

    Calls a lightweight service running on a platform where youtube.com
    is accessible. The service runs yt-dlp and streams the audio file back.
    """
    if not YT_EXTRACT_URL:
        return None  # Not configured — skip this tier

    try:
        logger.info(f"[YT-Extract] Calling extraction service for {video_id}...")
        headers = {}
        if YT_EXTRACT_API_KEY:
            headers["X-API-Key"] = YT_EXTRACT_API_KEY

        async with httpx.AsyncClient(timeout=YT_EXTRACT_TIMEOUT, follow_redirects=True) as client:
            async with client.stream(
                "GET",
                YT_EXTRACT_URL,
                params={"video_id": video_id},
                headers=headers,
            ) as resp:
                if resp.status_code != 200:
                    body = ""
                    async for chunk in resp.aiter_bytes(1024):
                        body += chunk.decode(errors="replace")
                        if len(body) > 500:
                            break
                    raise ValueError(f"HTTP {resp.status_code}: {body[:200]}")

                ct = resp.headers.get("content-type", "")
                if "text/html" in ct or "application/json" in ct:
                    raise ValueError(f"Unexpected content-type: {ct}")

                path = await _stream_to_tempfile(resp)
                logger.info(f"[YT-Extract] Success ({os.path.getsize(path)} bytes)")
                return path
    except Exception as e:
        logger.warning(f"[YT-Extract] Failed: {e}")
    return None


async def fetch_youtube_audio(video_id: str) -> str:
    """
    Download audio from YouTube via tiered cascade (server-side, no CORS).
    Returns path to temp audio file. Raises HTTPException(502) if all fail.

    Tier 1: Piped /streams (proxied audio, retries transient 500s)
    Tier 2: Cobalt API (tunneled audio download, avoids IP-lock)
    Tier 3: External extraction service (yt-dlp on Koyeb/Railway, if configured)
    Tier 4: Invidious /latest_version (redirect to googlevideo.com)
    """
    # Tier 1: Piped (with retries for transient 500s)
    path = await _try_piped(video_id)
    if path:
        return path

    # Tier 2: Cobalt (tunneled audio — no IP-lock issue)
    path = await _try_cobalt(video_id)
    if path:
        return path

    # Tier 3: External extraction microservice (yt-dlp, if configured)
    path = await _try_extract_service(video_id)
    if path:
        return path

    # Tier 4: Invidious /latest_version (single redirect to googlevideo)
    path = await _try_invidious_latest(video_id)
    if path:
        return path

    raise HTTPException(
        status_code=502,
        detail="youtube_extraction_failed",
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
    file: UploadFile = File(None),
    video_id: str = Form(None),
    youtube_url: str = Form(None),
):
    """Analyze audio and return chord recognition results.

    Accepts either a file upload OR a YouTube URL (not both).
    When youtube_url is provided, the server fetches the audio server-side.
    """
    has_file = file is not None and file.filename
    if not has_file and not youtube_url:
        raise HTTPException(400, "Provide either 'file' or 'youtube_url'")

    tmp_path = None
    effective_video_id = video_id or "upload"

    try:
        if youtube_url:
            # --- YouTube URL path: server-side extraction ---
            vid = extract_video_id(youtube_url)
            if not vid:
                raise HTTPException(400, "Invalid YouTube URL")
            effective_video_id = vid
            logger.info(f"YouTube extraction requested for video: {vid}")
            tmp_path = await fetch_youtube_audio(vid)
            # fetch_youtube_audio raises HTTPException(502) if all tiers fail
        else:
            # --- File upload path (existing logic) ---
            _, ext = os.path.splitext(file.filename or "")
            if ext.lower() not in ALLOWED_EXTENSIONS:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported file type: {ext}. Allowed: {', '.join(ALLOWED_EXTENSIONS)}",
                )
            content = await file.read()
            if len(content) > MAX_FILE_SIZE:
                raise HTTPException(
                    status_code=400,
                    detail=f"File too large ({len(content) / 1024 / 1024:.1f}MB). Max: {MAX_FILE_SIZE / 1024 / 1024:.0f}MB",
                )
            suffix = ext.lower() if ext else ".wav"
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                tmp.write(content)
                tmp_path = tmp.name

        result = analyze_audio(tmp_path, video_id=effective_video_id)
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Analysis failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
