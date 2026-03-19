FROM python:3.11-slim

# System dependencies: ffmpeg for audio format conversion, libsndfile for soundfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code
COPY app.py .

# Render uses the PORT env var; default 7860 as fallback
EXPOSE 7860
RUN useradd -m -u 1000 user
USER user

CMD uvicorn app:app --host 0.0.0.0 --port ${PORT:-7860}
