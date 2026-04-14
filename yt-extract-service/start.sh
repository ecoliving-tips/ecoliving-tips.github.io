#!/bin/bash
# Startup script for yt-extract-service
# Uses supervisord to manage both bgutil PO token server and FastAPI

exec supervisord -c /app/supervisord.conf
