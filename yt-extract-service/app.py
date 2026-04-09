"""
Swaram YouTube Audio Extraction Microservice

Lightweight FastAPI service that extracts audio from YouTube videos using yt-dlp.
Designed to run on free platforms (Render, etc.) where youtube.com is accessible.
Uses fresh browser cookies + PO Tokens (via bgutil) to bypass YouTube's bot
detection on cloud IPs.

Called by the main chord-service on HF Spaces when Piped proxy fails.
"""

import os
import re
import asyncio
import tempfile
import logging
import time
import base64
from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
VERSION = "2.3.0"
MAX_FILE_SIZE = 50 * 1024 * 1024       # 50 MB
MAX_DURATION_SEC = 600                   # 10 min
DOWNLOAD_TIMEOUT = 120                   # seconds (includes PO token generation)
MIN_AUDIO_BYTES = 10_000                 # 10 KB
YT_VIDEO_ID_RE = re.compile(r'^[A-Za-z0-9_-]{11}$')

# PO Token server (bgutil-ytdlp-pot-provider) — runs on localhost
BGUTIL_BASE_URL = os.getenv("BGUTIL_BASE_URL", "http://127.0.0.1:4416")

# API key shared with HF Spaces backend (set via environment variable)
API_KEY = os.getenv("API_KEY", "")

# yt-dlp cache directory — stores nsig cache, EJS solver, etc.
YTDLP_CACHE_DIR = "/app/.ytdlp-cache"

# YouTube cookies — required for cloud IP extraction.
# Set YT_COOKIES_B64 env var to base64-encoded Netscape cookies.txt content.
# Export with "Get cookies.txt LOCALLY" Chrome extension → youtube.com.
# Cookies expire periodically — re-export when extraction starts failing.
YT_COOKIES_FILE = None  # Set at startup if cookies are available

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("yt-extract")

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(title="Swaram YT Extract", version=VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# Track temp files for cleanup
_active_files: set[str] = set()


@app.on_event("startup")
def _init_cookies():
    """Decode YT_COOKIES_B64 env var to a cookies.txt file on startup."""
    global YT_COOKIES_FILE
    cookies_b64 = os.getenv("YT_COOKIES_B64", "")
    if not cookies_b64:
        logger.warning("YT_COOKIES_B64 not set — run setup-cookies.sh locally to export fresh cookies")
        return
    try:
        cookies_bytes = base64.b64decode(cookies_b64)
        tmp = tempfile.NamedTemporaryFile(
            mode="wb", suffix=".txt", prefix="yt_cookies_", delete=False
        )
        tmp.write(cookies_bytes)
        tmp.close()
        YT_COOKIES_FILE = tmp.name
        logger.info(f"YouTube cookies loaded ({len(cookies_bytes)} bytes)")
    except Exception as e:
        logger.error(f"Failed to decode YT_COOKIES_B64: {e}")


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
async def verify_api_key(x_api_key: str = Header(None)):
    """Verify API key if one is configured."""
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/")
@app.head("/")
async def root():
    return {"service": "Swaram YT Extract", "version": VERSION, "status": "ok"}


@app.get("/health")
@app.head("/health")
async def health():
    return {"status": "ok", "version": VERSION}


@app.get("/extract", dependencies=[Depends(verify_api_key)])
async def extract_audio(video_id: str):
    """
    Extract audio from a YouTube video and return the file.

    Query params:
        video_id: 11-character YouTube video ID (SSRF-safe: no arbitrary URLs)

    Returns:
        Audio file (M4A/WebM) as streaming download

    Security:
        - Only accepts validated 11-char video IDs (no arbitrary URL injection)
        - Optional API key auth via X-API-Key header
        - Max duration 10 min, max file size 30 MB
    """
    # Validate video ID (SSRF protection — only IDs, never URLs)
    if not video_id or not YT_VIDEO_ID_RE.match(video_id):
        raise HTTPException(400, "Invalid video_id — must be 11 alphanumeric chars")

    tmp_path = None
    try:
        tmp_path = await _download_with_ytdlp(video_id)

        # Determine media type from extension
        ext = os.path.splitext(tmp_path)[1].lower()
        media_types = {
            ".m4a": "audio/mp4",
            ".webm": "audio/webm",
            ".opus": "audio/opus",
            ".mp3": "audio/mpeg",
            ".ogg": "audio/ogg",
        }
        media_type = media_types.get(ext, "audio/mp4")

        _active_files.add(tmp_path)

        return FileResponse(
            path=tmp_path,
            media_type=media_type,
            filename=f"{video_id}{ext}",
            background=_cleanup_task(tmp_path),
        )
    except HTTPException:
        _safe_unlink(tmp_path)
        raise
    except Exception as e:
        _safe_unlink(tmp_path)
        logger.error(f"Extraction failed for {video_id}: {e}")
        raise HTTPException(502, f"YouTube extraction failed: {str(e)[:200]}")


# ---------------------------------------------------------------------------
# yt-dlp extraction
# ---------------------------------------------------------------------------
async def _download_with_ytdlp(video_id: str) -> str:
    """Download audio from YouTube using yt-dlp. Returns path to temp file."""
    tmp = tempfile.NamedTemporaryFile(suffix=".m4a", delete=False)
    tmp.close()

    try:
        logger.info(f"[yt-dlp] Extracting audio for {video_id}...")
        t0 = time.time()

        cmd = [
            "yt-dlp",
            "--no-playlist",
            "-f", "wa/ba/b",  # Worst (smallest) audio first — chord analysis only needs 16kHz
            "--cache-dir", YTDLP_CACHE_DIR,
            "--js-runtimes", "node",  # Enable node (only deno is on by default in yt-dlp 2026)
            "--remote-components", "ejs:github",  # Download EJS challenge solver from GitHub
            "--extractor-args", "youtube:player_client=web",
            "--extractor-args", f"youtubepot-bgutilhttp:base_url={BGUTIL_BASE_URL}",
            "--max-filesize", str(MAX_FILE_SIZE),
            "--socket-timeout", "20",
            "--retries", "2",
            "--max-downloads", "1",
            "-o", tmp.name,
            "--force-overwrites",
        ]
        # Cookies — required for cloud IP extraction
        if YT_COOKIES_FILE and os.path.exists(YT_COOKIES_FILE):
            cmd.extend(["--cookies", YT_COOKIES_FILE])
            logger.info("[yt-dlp] Using cookies for authentication")
        else:
            logger.warning("[yt-dlp] No cookies — extraction will likely fail on cloud IPs")
        cmd.append(f"https://www.youtube.com/watch?v={video_id}")

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        stdout, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=DOWNLOAD_TIMEOUT
        )

        elapsed = time.time() - t0

        # Exit 101 = --max-downloads limit reached (file was downloaded successfully)
        if proc.returncode not in (0, 101) or (proc.returncode == 101 and not os.path.exists(tmp.name)):
            full_err = stderr.decode(errors="replace")
            # Extract actual error/warning lines (skip verbose debug noise)
            err_lines = [l for l in full_err.split("\n")
                         if l.startswith("ERROR:") or l.startswith("WARNING:") or "Sign in" in l]
            err_msg = "\n".join(err_lines)[:1000] if err_lines else full_err[-500:]
            logger.warning(f"[yt-dlp] Failed (exit {proc.returncode}): {err_msg}")

            # Detect specific YouTube errors
            if "Sign in to confirm" in full_err or "confirm you're not a bot" in full_err.lower():
                raise HTTPException(503, "YouTube requires login — try again later")
            if "Video unavailable" in full_err:
                raise HTTPException(404, "Video not found or unavailable")
            if "Private video" in full_err:
                raise HTTPException(403, "This video is private")

            raise ValueError(f"yt-dlp exit {proc.returncode}: {err_msg[:500]}")

        # Validate output file
        if not os.path.exists(tmp.name):
            raise ValueError("Downloaded file not found")

        file_size = os.path.getsize(tmp.name)
        if file_size < MIN_AUDIO_BYTES:
            raise ValueError(f"File too small ({file_size} bytes)")
        if file_size > MAX_FILE_SIZE:
            raise ValueError(f"File too large ({file_size} bytes)")

        logger.info(f"[yt-dlp] Success: {file_size} bytes in {elapsed:.1f}s")
        return tmp.name

    except asyncio.TimeoutError:
        logger.warning(f"[yt-dlp] Timed out after {DOWNLOAD_TIMEOUT}s")
        try:
            proc.kill()
        except Exception:
            pass
        _safe_unlink(tmp.name)
        raise HTTPException(504, "Download timed out — video may be too long")
    except (HTTPException, ValueError):
        _safe_unlink(tmp.name)
        raise
    except Exception as e:
        _safe_unlink(tmp.name)
        raise ValueError(f"Unexpected error: {e}")


# ---------------------------------------------------------------------------
# Cleanup helpers
# ---------------------------------------------------------------------------
def _safe_unlink(path: str | None):
    if path:
        try:
            os.unlink(path)
            _active_files.discard(path)
        except OSError:
            pass


class _cleanup_task:
    """Starlette BackgroundTask-compatible callable for file cleanup."""
    def __init__(self, path: str):
        self.path = path

    async def __call__(self):
        _safe_unlink(self.path)
