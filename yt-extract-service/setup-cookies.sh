#!/bin/bash
# -------------------------------------------------------------------
# Swaram — Export YouTube cookies for Render extraction service
#
# YouTube blocks yt-dlp from cloud IPs. Fresh browser cookies
# (from a logged-in session) + PO tokens bypass this.
#
# Prerequisites:
#   pip install yt-dlp
#   Logged into YouTube in Chrome or Edge
#
# Usage (two options):
#
#   Option A — Auto-export from browser (recommended):
#     Close Chrome/Edge first, then:
#     bash setup-cookies.sh --from-browser chrome
#     bash setup-cookies.sh --from-browser edge
#
#   Option B — Manual cookies.txt file:
#     Export cookies.txt manually, then:
#     bash setup-cookies.sh cookies.txt
#
# After running, copy the base64 output → set as YT_COOKIES_B64 on Render.
#
# Cookies expire periodically. Re-run when extraction starts
# failing with "Sign in to confirm you're not a bot".
# -------------------------------------------------------------------

set -e

COOKIES_FILE="cookies.txt"
TEST_VIDEO="https://www.youtube.com/watch?v=dQw4w9WgXcQ"

echo "============================================"
echo "  Swaram — YouTube Cookie Export"
echo "============================================"
echo ""

# --- Option A: Export from browser ---
if [ "$1" = "--from-browser" ]; then
    BROWSER="${2:-chrome}"
    echo "Exporting cookies from $BROWSER..."
    echo "(Make sure $BROWSER is CLOSED before running this)"
    echo ""

    # yt-dlp reads from browser + writes to cookies.txt
    if yt-dlp \
        --cookies-from-browser "$BROWSER" \
        --cookies "$COOKIES_FILE" \
        --skip-download \
        --print title \
        "$TEST_VIDEO" 2>/dev/null; then
        echo ""
        echo "Browser cookie export SUCCEEDED."
    else
        echo ""
        echo "ERROR: Failed to export cookies from $BROWSER."
        echo ""
        echo "Troubleshooting:"
        echo "  - Make sure $BROWSER is fully closed (check Task Manager)"
        echo "  - Make sure you're logged into YouTube in $BROWSER"
        echo "  - Try a different browser: bash setup-cookies.sh --from-browser edge"
        echo ""
        exit 1
    fi

# --- Option B: Use existing cookies.txt ---
elif [ -n "$1" ] && [ "$1" != "--from-browser" ]; then
    COOKIES_FILE="$1"
fi

# --- Validate cookies file ---
if [ ! -f "$COOKIES_FILE" ]; then
    echo "ERROR: $COOKIES_FILE not found!"
    echo ""
    echo "Usage:"
    echo "  bash setup-cookies.sh --from-browser chrome   (auto-export)"
    echo "  bash setup-cookies.sh --from-browser edge     (auto-export)"
    echo "  bash setup-cookies.sh cookies.txt             (manual file)"
    echo ""
    exit 1
fi

# Count cookie entries
COOKIE_COUNT=$(grep -c "youtube.com\|google.com" "$COOKIES_FILE" 2>/dev/null || echo "0")
echo "Found $COOKIE_COUNT YouTube/Google cookie entries in $COOKIES_FILE"
echo ""

# Quick validation test
echo "Validating cookies with yt-dlp..."
if yt-dlp --cookies "$COOKIES_FILE" --skip-download --print title "$TEST_VIDEO" 2>/dev/null; then
    echo ""
    echo "Cookies are VALID."
else
    echo ""
    echo "WARNING: yt-dlp validation failed. Cookies might be expired."
    echo ""
fi

# --- Output base64 ---
echo ""
echo "============================================"
echo "  Base64-encoded cookies for Render"
echo "============================================"
echo ""
echo "Copy EVERYTHING between the markers below:"
echo ""
echo "===BASE64_START==="
if base64 --wrap=0 "$COOKIES_FILE" 2>/dev/null; then
    true
elif base64 -w 0 "$COOKIES_FILE" 2>/dev/null; then
    true
else
    base64 "$COOKIES_FILE" | tr -d '\n'
fi
echo ""
echo "===BASE64_END==="
echo ""
echo "--- Set this on Render ---"
echo "  1. Render Dashboard → your service → Environment"
echo "  2. Add/update env var:"
echo "       Key:   YT_COOKIES_B64"
echo "       Value: <paste the base64 string above>"
echo "  3. Redeploy the service"
echo ""
echo "Note: Cookies expire every few weeks. Re-run this script"
echo "when extraction fails with 'Sign in to confirm you're not a bot'."
