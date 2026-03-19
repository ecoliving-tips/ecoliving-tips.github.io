---
title: Swaram Chord Service
emoji: 🎵
colorFrom: purple
colorTo: pink
sdk: docker
app_port: 7860
pinned: false
license: mit
---

# Swaram Chord Detection Service

Detects chords from YouTube videos using librosa chroma analysis with beat-synchronized chord template matching.

**Part of [Swaram](https://ecoliving-tips.github.io/) — Free Christian Song Chords for Keyboard & Guitar**

## API

### `POST /analyze`
```json
{ "url": "https://youtube.com/watch?v=VIDEO_ID" }
```

Returns:
```json
{
  "videoId": "VIDEO_ID",
  "key": "Cm",
  "bpm": 95,
  "timeSignature": "3/4",
  "chords": [
    { "time": 0.0, "duration": 1.5, "chord": "Cm" },
    { "time": 1.5, "duration": 2.0, "chord": "G7" }
  ]
}
```

### `GET /health`
Returns `{ "status": "ok" }`

## How It Works

1. **yt-dlp** downloads audio from YouTube
2. **librosa** separates harmonic content (HPSS) and computes CQT chroma features
3. Chroma is synchronized to detected beats
4. Each beat is matched against 108 chord templates (major, minor, 7th, m7, M7, dim, aug, sus2, sus4)
5. Median smoothing reduces rapid chord changes
6. Key detection uses Krumhansl-Kessler profiles
7. Time signature estimated from beat grouping patterns
