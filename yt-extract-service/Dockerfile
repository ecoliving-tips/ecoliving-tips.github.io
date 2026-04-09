FROM python:3.11-slim

# Install ffmpeg + Node.js (EJS solver needs node runtime)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg curl ca-certificates gnupg && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app + startup script
COPY app.py .
COPY start.sh .
RUN chmod +x start.sh

# Render/Railway use PORT env var; default to 8000
ENV PORT=8000
EXPOSE ${PORT}

CMD ["./start.sh"]
