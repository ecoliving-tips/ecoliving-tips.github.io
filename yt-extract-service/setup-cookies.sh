#!/bin/bash
# -------------------------------------------------------------------
# Swaram — Export YouTube cookies for Render extraction service
#
# YouTube blocks yt-dlp from cloud IPs. Fresh browser cookies
# (from a logged-in session) + PO tokens bypass this.
#
# Prerequisites:
#   pip install yt-dlp
#   Chrome with "Get cookies.txt LOCALLY" extension installed
#   (https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)
#
# Usage:
#   1. Open Chrome → go to https://www.youtube.com (make sure you're logged in)
#   2. Click the "Get cookies.txt LOCALLY" extension icon
#   3. Click "Export" → save as cookies.txt in this directory
#   4. Run: bash setup-cookies.sh
#   5. Copy the base64 output → set as YT_COOKIES_B64 on Render
#
# Cookies expire periodically. Re-run this when extraction starts
# failing with "Sign in to confirm you're not a bot".
# -------------------------------------------------------------------

set -e

COOKIES_FILE="${1:-cookies.txt}"

echo "============================================"
echo "  Swaram — YouTube Cookie Export"
echo "============================================"
echo ""

if [ ! -f "$COOKIES_FILE" ]; then
    echo "ERROR: $COOKIES_FILE not found!"
    echo ""
    echo "Steps to export cookies:"
    echo "  1. Install 'Get cookies.txt LOCALLY' Chrome extension"
    echo "     https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc"
    echo "  2. Open Chrome → go to https://www.youtube.com (logged in)"
    echo "  3. Click extension icon → Export → save as cookies.txt here"
    echo "  4. Re-run: bash setup-cookies.sh"
    echo ""
    exit 1
fi

# Validate it looks like a Netscape cookies file
if ! head -5 "$COOKIES_FILE" | grep -qi "youtube\|google\|netscape"; then
    echo "WARNING: $COOKIES_FILE doesn't look like a YouTube cookies file."
    echo "Make sure you exported from youtube.com with the extension."
    echo ""
fi

# Count cookie entries
COOKIE_COUNT=$(grep -c "youtube.com\|google.com" "$COOKIES_FILE" 2>/dev/null || echo "0")
echo "Found $COOKIE_COUNT YouTube/Google cookie entries in $COOKIES_FILE"
echo ""

# Quick test: try yt-dlp with these cookies locally
echo "Testing cookies locally..."
if yt-dlp --cookies "$COOKIES_FILE" --skip-download --print title "https://www.youtube.com/watch?v=dQw4w9WgXcQ" 2>/dev/null; then
    echo ""
    echo "Cookies are VALID — yt-dlp can access YouTube."
else
    echo ""
    echo "WARNING: yt-dlp test failed. Cookies might be expired or invalid."
    echo "Try exporting fresh cookies from a logged-in YouTube session."
    echo ""
fi

echo ""
echo "============================================"
echo "  Base64-encoded cookies for Render"
echo "============================================"
echo ""
echo "Copy EVERYTHING between the markers below:"
echo ""
echo "===BASE64_START==="
# base64 encode — handle macOS (no -w flag) and Linux (-w0)
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
echo "Note: Cookies expire periodically. Re-export when extraction"
echo "fails with 'Sign in to confirm you're not a bot'."
