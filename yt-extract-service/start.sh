#!/bin/bash
# Startup script for yt-extract-service

# Start FastAPI (exec replaces shell so signals propagate correctly)
exec uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000}
