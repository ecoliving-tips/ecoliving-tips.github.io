FROM python:3.11-slim

# Install ffmpeg + Node.js (required by bgutil PO token provider)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg curl ca-certificates gnupg && \
    mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-install bgutil server dependencies (avoids npx download at runtime)
RUN npx --yes bgutil-ytdlp-pot-provider@latest server --help 2>/dev/null || true

# Copy app + startup script
COPY app.py .
COPY start.sh .
RUN chmod +x start.sh

# Render/Railway use PORT env var; default to 8000
ENV PORT=8000
EXPOSE ${PORT}

CMD ["./start.sh"]
