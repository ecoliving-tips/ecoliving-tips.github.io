#!/bin/bash
# -------------------------------------------------------------------
# Swaram — One-time OAuth2 setup for YouTube extraction on Render
#
# This script runs the yt-dlp OAuth2 device flow on YOUR machine,
# then outputs the base64-encoded token for use on Render.
#
# Prerequisites:
#   pip install yt-dlp
#
# Usage:
#   bash setup-oauth.sh
#
# After running:
#   1. Copy the base64 string from the output
#   2. Go to Render Dashboard → Environment → Add env var:
#      Key:   YT_OAUTH_TOKEN_B64
#      Value: <paste the base64 string>
#   3. Redeploy the service
# -------------------------------------------------------------------

set -e

CACHE_DIR="./ytdlp-oauth-cache"
TOKEN_PATH="$CACHE_DIR/youtube-oauth2/token_data.json"
TEST_VIDEO="https://www.youtube.com/watch?v=dQw4w9WgXcQ"

echo "============================================"
echo "  Swaram — YouTube OAuth2 Setup"
echo "============================================"
echo ""
echo "This will open a Google device flow in your browser."
echo "Log in with ANY Google account (doesn't need YouTube Premium)."
echo ""

# Clean previous cache
rm -rf "$CACHE_DIR"

# Run yt-dlp with OAuth2 — triggers device code flow
echo "Starting OAuth2 device flow..."
echo ""
yt-dlp \
    --username oauth2 \
    --password "" \
    --cache-dir "$CACHE_DIR" \
    --skip-download \
    --verbose \
    "$TEST_VIDEO"

echo ""

# Find the token file
if [ -f "$TOKEN_PATH" ]; then
    echo "============================================"
    echo "  SUCCESS! Token saved."
    echo "============================================"
    echo ""
    echo "Token file: $TOKEN_PATH"
    echo ""
    echo "--- Copy EVERYTHING between the markers below ---"
    echo ""
    echo "===BASE64_START==="
    # base64 encode (works on macOS and Linux; -w0 for no wrapping on Linux)
    if base64 --wrap=0 "$TOKEN_PATH" 2>/dev/null; then
        true
    elif base64 -w 0 "$TOKEN_PATH" 2>/dev/null; then
        true
    else
        base64 "$TOKEN_PATH"
    fi
    echo ""
    echo "===BASE64_END==="
    echo ""
    echo "--- Set this as YT_OAUTH_TOKEN_B64 on Render ---"
    echo ""
    echo "Steps:"
    echo "  1. Copy the base64 string above (between the markers)"
    echo "  2. Render Dashboard → your service → Environment"
    echo "  3. Add/update env var: YT_OAUTH_TOKEN_B64 = <paste>"
    echo "  4. Redeploy"
    echo ""
else
    echo "ERROR: Token file not found at $TOKEN_PATH"
    echo ""
    echo "Looking for token files in cache dir..."
    find "$CACHE_DIR" -name "*.json" -type f 2>/dev/null || echo "  (none found)"
    echo ""
    echo "If a different file was created, base64-encode it manually:"
    echo "  base64 -w0 <path-to-file>"
    echo ""
    exit 1
fi
