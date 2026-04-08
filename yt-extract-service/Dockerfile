FROM python:3.11-slim

# Install ffmpeg + Node.js + git (required by bgutil PO token provider)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg curl ca-certificates gnupg git && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies (includes bgutil-ytdlp-pot-provider plugin)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Clone and build bgutil PO token HTTP server
RUN git clone --single-branch --branch 1.3.1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil && \
    cd /opt/bgutil/server && \
    npm ci && \
    npx tsc

# Copy app + startup script
COPY app.py .
COPY start.sh .
RUN chmod +x start.sh

# Render/Railway use PORT env var; default to 8000
ENV PORT=8000
EXPOSE ${PORT}

CMD ["./start.sh"]
