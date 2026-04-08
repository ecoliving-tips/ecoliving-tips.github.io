"""
Swaram YouTube Audio Extraction Microservice

Lightweight FastAPI service that extracts audio from YouTube videos using yt-dlp.
Designed to run on free platforms (Koyeb, Railway, etc.) where youtube.com
is not DNS-blocked (unlike HF Spaces).

Called by the main chord-service on HF Spaces when Piped proxy fails.
"""

import os
import re
import asyncio
import tempfile
import logging
import time

from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
VERSION = "1.0.0"
MAX_FILE_SIZE = 30 * 1024 * 1024       # 30 MB
MAX_DURATION_SEC = 600                   # 10 min
DOWNLOAD_TIMEOUT = 90                    # seconds
MIN_AUDIO_BYTES = 10_000                 # 10 KB
YT_VIDEO_ID_RE = re.compile(r'^[A-Za-z0-9_-]{11}$')

# API key shared with HF Spaces backend (set via environment variable)
API_KEY = os.getenv("API_KEY", "")

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
@app.get("/health")
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

        proc = await asyncio.create_subprocess_exec(
            "yt-dlp",
            "--no-playlist",
            "--no-warnings",
            "-f", "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio",
            "--max-filesize", str(MAX_FILE_SIZE),
            "--socket-timeout", "20",
            "--retries", "2",
            "--max-downloads", "1",
            "-o", tmp.name,
            "--force-overwrites",
            f"https://www.youtube.com/watch?v={video_id}",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        stdout, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=DOWNLOAD_TIMEOUT
        )

        elapsed = time.time() - t0

        if proc.returncode != 0:
            err_msg = stderr.decode(errors="replace")[:500]
            logger.warning(f"[yt-dlp] Failed (exit {proc.returncode}): {err_msg}")

            # Detect specific YouTube errors
            if "Sign in to confirm" in err_msg or "bot" in err_msg.lower():
                raise HTTPException(503, "YouTube requires login — try again later")
            if "Video unavailable" in err_msg:
                raise HTTPException(404, "Video not found or unavailable")
            if "Private video" in err_msg:
                raise HTTPException(403, "This video is private")

            raise ValueError(f"yt-dlp exit {proc.returncode}: {err_msg[:200]}")

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
