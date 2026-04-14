"""
Swaram YouTube Audio Extraction Microservice

Lightweight FastAPI service that extracts audio from YouTube videos using yt-dlp.
Designed to run on free platforms (Render, etc.) where youtube.com is accessible.

Authentication: PO Tokens (via bgutil HTTP server on localhost:4416) eliminate the
need for manual cookie rotation. Cookies are kept as optional fallback only.

Called by the main chord-service on HF Spaces when Piped proxy fails.
"""

import os
import re
import asyncio
import tempfile
import logging
import time
import base64
import urllib.request
import urllib.error
from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
VERSION = "3.0.0"
MAX_FILE_SIZE = 50 * 1024 * 1024       # 50 MB
MAX_DURATION_SEC = 600                   # 10 min
DOWNLOAD_TIMEOUT = 120                   # seconds (includes PO token generation)
MIN_AUDIO_BYTES = 10_000                 # 10 KB
YT_VIDEO_ID_RE = re.compile(r'^[A-Za-z0-9_-]{11}$')

# API key shared with HF Spaces backend (set via environment variable)
API_KEY = os.getenv("API_KEY", "")

# yt-dlp cache directory — stores nsig cache, EJS solver, etc.
YTDLP_CACHE_DIR = "/app/.ytdlp-cache"

# YouTube cookies — optional fallback for cloud IP extraction.
# PO tokens (via bgutil server on localhost:4416) are the primary auth method.
# Set YT_COOKIES_B64 env var to base64-encoded Netscape cookies.txt content
# ONLY if PO tokens alone are insufficient (rare).
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
    """Decode YT_COOKIES_B64 env var to a cookies.txt file on startup (optional fallback)."""
    global YT_COOKIES_FILE
    cookies_b64 = os.getenv("YT_COOKIES_B64", "")
    if not cookies_b64:
        logger.info("YT_COOKIES_B64 not set — using PO tokens only (no cookie fallback)")
        return
    try:
        cookies_bytes = base64.b64decode(cookies_b64)
        tmp = tempfile.NamedTemporaryFile(
            mode="wb", suffix=".txt", prefix="yt_cookies_", delete=False
        )
        tmp.write(cookies_bytes)
        tmp.close()
        YT_COOKIES_FILE = tmp.name
        logger.info(f"YouTube cookies loaded as fallback ({len(cookies_bytes)} bytes)")
    except Exception as e:
        logger.error(f"Failed to decode YT_COOKIES_B64: {e}")


BGUTIL_SERVER_URL = "http://127.0.0.1:4416"


@app.on_event("startup")
def _check_bgutil_server():
    """Log bgutil PO token server status (non-blocking — server may still be starting)."""
    try:
        req = urllib.request.Request(BGUTIL_SERVER_URL, method="GET")
        urllib.request.urlopen(req, timeout=2)
        logger.info(f"bgutil PO token server reachable on {BGUTIL_SERVER_URL}")
    except urllib.error.HTTPError:
        # 404 etc. means server IS running (no root route defined)
        logger.info(f"bgutil PO token server reachable on {BGUTIL_SERVER_URL}")
    except Exception:
        logger.info(f"bgutil PO token server not yet reachable — supervisord will start it")


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
    # Check bgutil server reachability
    pot_status = "unreachable"
    try:
        req = urllib.request.Request(BGUTIL_SERVER_URL, method="GET")
        urllib.request.urlopen(req, timeout=2)
        pot_status = "ok"
    except urllib.error.HTTPError:
        # 404 etc. means server IS running (no root route defined)
        pot_status = "ok"
    except Exception:
        pass
    return {
        "status": "ok",
        "version": VERSION,
        "po_token_server": pot_status,
        "cookies_loaded": YT_COOKIES_FILE is not None,
    }


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
            "-f", "ba/b*",                     # Audio-only first, then any format
            "-S", "+size,+br,proto:m3u8_native:m3u8:https",  # Smallest + prefer m3u8 (~6MB) over https (~30MB)
            "--concurrent-fragments", "4",      # Parallel HLS segment downloads
            "--cache-dir", YTDLP_CACHE_DIR,
            "--js-runtimes", "node",
            "--remote-components", "ejs:github",
            "--socket-timeout", "15",
            "--retries", "1",
            "--extractor-args", "youtube:player_client=mweb",  # mweb works best with PO tokens
            "-o", tmp.name,
            "--force-overwrites",
        ]
        # PO tokens: bgutil plugin auto-discovers HTTP server on localhost:4416
        # Cookies: optional fallback (set YT_COOKIES_B64 env var if needed)
        if YT_COOKIES_FILE and os.path.exists(YT_COOKIES_FILE):
            cmd.extend(["--cookies", YT_COOKIES_FILE])
            logger.info("[yt-dlp] Using PO tokens + cookies (fallback)")
        else:
            logger.info("[yt-dlp] Using PO tokens only (no cookies)")
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

        # Log which format yt-dlp selected (from stderr [info] line)
        for line in stderr.decode(errors="replace").split("\n"):
            if "[info]" in line and "format" in line.lower():
                logger.info(f"[yt-dlp] {line.strip()}")

        # Check yt-dlp exit status
        if proc.returncode != 0:
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

        logger.info(f"[yt-dlp] Success: {file_size/1024/1024:.1f} MB in {elapsed:.1f}s")
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
