#!/usr/bin/env python3
"""
Export YouTube cookies from Firefox as base64 for the Render yt-extract service.

Usage:
    1. Log into YouTube on Firefox
    2. Run: python tools/export-yt-cookies.py
    3. Copy the base64 output
    4. Paste as YT_COOKIES_B64 env var on Render

Requires: pip install rookiepy
"""

import sys

try:
    import rookiepy
except ImportError:
    print("rookiepy not installed. Run: pip install rookiepy")
    sys.exit(1)

import base64

DOMAINS = ["youtube.com", ".youtube.com", "google.com", ".google.com"]

cookies = rookiepy.to_cookiejar(rookiepy.firefox(DOMAINS))
cookie_list = list(cookies)

if not cookie_list:
    print("No cookies found! Make sure you're logged into YouTube on Firefox.")
    sys.exit(1)

lines = ["# Netscape HTTP Cookie File"]
for c in cookie_list:
    secure = "TRUE" if c.secure else "FALSE"
    expiry = str(c.expires) if c.expires else "0"
    lines.append(f"{c.domain}\tTRUE\t{c.path}\t{secure}\t{expiry}\t{c.name}\t{c.value}")

txt = "\n".join(lines)
b64 = base64.b64encode(txt.encode()).decode()

print(f"Cookies found: {len(cookie_list)}")
print(f"Base64 length: {len(b64)} chars\n")
print("Set this as YT_COOKIES_B64 env var on Render:\n")
print(b64)
