# ===== Stage 1: Build bgutil PO Token HTTP server =====
FROM node:20-bookworm-slim AS bgutil-build

# Clone bgutil-ytdlp-pot-provider at pinned version, install deps, compile TS
RUN apt-get update && \
    apt-get install -y --no-install-recommends git ca-certificates && \
    rm -rf /var/lib/apt/lists/*

RUN git clone --single-branch --branch 1.3.1 --depth 1 \
      https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /tmp/bgutil && \
    cd /tmp/bgutil/server && \
    npm ci --omit=dev --no-audit --no-fund && \
    cp -r node_modules /tmp/bgutil-node_modules && \
    npm ci --no-audit --no-fund && \
    npx tsc && \
    rm -rf node_modules && \
    mv /tmp/bgutil-node_modules node_modules


# ===== Stage 2: Final image =====
FROM python:3.11-slim

# Install ffmpeg + Node.js 20 (EJS solver) + supervisor (dual-process mgmt)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ffmpeg curl ca-certificates gnupg supervisor && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy compiled bgutil server from build stage
COPY --from=bgutil-build /tmp/bgutil/server/build /app/bgutil-server/build
COPY --from=bgutil-build /tmp/bgutil/server/node_modules /app/bgutil-server/node_modules
COPY --from=bgutil-build /tmp/bgutil/server/package.json /app/bgutil-server/package.json

# Install Python dependencies (includes yt-dlp + bgutil plugin)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app files
COPY app.py .
COPY start.sh .
COPY supervisord.conf .
RUN chmod +x start.sh

# Render/Railway use PORT env var; default to 8000
ENV PORT=8000
EXPOSE ${PORT}

CMD ["./start.sh"]
