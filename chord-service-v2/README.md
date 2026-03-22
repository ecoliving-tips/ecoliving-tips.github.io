---
title: Swaram Chord Service v2
emoji: 🎵
colorFrom: purple
colorTo: pink
sdk: docker
app_port: 7860
pinned: false
---

# Swaram Chord Service v2

Chord recognition backend for [Swaram](https://ecoliving-tips.github.io/) — uses the BTC (Bi-directional Transformer for Chord Recognition) model for accurate chord detection.

## API

### POST /analyze

Upload an audio file and receive chord analysis.

**Request**: `multipart/form-data` with `file` (audio) and optional `video_id` (string).

**Response**:
```json
{
  "video_id": "abc123",
  "key": "Cm",
  "bpm": 95,
  "time_signature": "3/4",
  "chords": [
    {"time": 0.0, "duration": 2.0, "chord": "Cm"},
    {"time": 2.0, "duration": 1.5, "chord": "G7"}
  ]
}
```

### GET /health

Health check endpoint.

## Deployment

Deployed on HuggingFace Spaces with Docker SDK. Push this directory as the Space repository.
