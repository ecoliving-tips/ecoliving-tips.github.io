#!/bin/bash
# Startup script for yt-extract-service
# Starts bgutil PO token server (port 4416) then uvicorn

# Start bgutil PO token HTTP server in background
echo "[startup] Starting bgutil PO token server on port 4416..."
npx bgutil-ytdlp-pot-provider@latest server --port 4416 &
BGUTIL_PID=$!

# Wait for server to initialize
sleep 3

# Verify bgutil is running
if kill -0 $BGUTIL_PID 2>/dev/null; then
    echo "[startup] bgutil PO token server running (PID $BGUTIL_PID)"
else
    echo "[startup] WARNING: bgutil server failed to start — yt-dlp will run without PO tokens"
fi

# Start FastAPI (exec replaces shell so signals propagate correctly)
exec uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000}
