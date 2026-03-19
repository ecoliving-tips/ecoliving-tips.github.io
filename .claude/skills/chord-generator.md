---
description: Guide implementation of AI chord generation — improving accuracy
user-invocable: false
---

# AI Chord Generator Feature — Chordify-Style

## Core Objective
**ACCURATE chord detection is the #1 priority.** Must work for any audio file — any language, artist, genre. Everything must be free (zero cost).

## Current State (as of 2026-03-19)

### What's DONE
- **Frontend fully working**: `generate.html` + `js/generate.js`
  - Audio file upload (drag & drop) as primary input
  - Optional YouTube URL for video embed sync
  - Chord timeline, transpose, share, print, save
  - All 7 original bugs fixed
  - i18n complete (en + ml)
  - Schema.org JSON-LD, sitemap entry, setlist.js loaded
- **Backend v4.0 deployed on Render.com** (Singapore, free tier)
  - URL: `https://swaram-chord-service.onrender.com`
  - GitHub repo: `swaram-chord-service` (standalone)
  - `POST /analyze-upload` — file upload -> chord JSON

### v4.0 Backend Pipeline (DEPLOYED)
- **HPSS + chroma_cqt** for audio <=120s; **chroma_stft** for >120s (speed)
- HPSS skipped for audio >120s
- **Viterbi HMM decoding** with key-aware transition matrix
- **Dual key profiles**: Krumhansl + Temperley weighted vote
- **Key-aware observation weighting**: 3x boost for diatonic chords
- **11 chord qualities**: major, minor, 7, m7, M7, 9, m9, dim, aug, sus4, sus2 (132 templates)
- **Diatonic chord mapping**: includes borrowed chords, harmonic minor V/V7
- **Min chord duration**: 0.4s enforcement
- **Time sig**: relaxed 3/4 threshold (1.05) + BPM hint
- Optimized for 0.1 vCPU (16kHz SR, hop=2048)

### v4.0 Real Test Results (Krooshakum Meshayil, Key: Cm, Time: 3/4)
| Metric      | v3.1 (old) | v4.0 (new) |
|-------------|-----------|-----------|
| Key         | Gm (WRONG) | D#/Eb (WRONG — relative major) |
| Time sig    | 4/4 (WRONG) | 3/4 (CORRECT) |
| Chord events| 170+      | 54        |
| Precision   | 22%       | 63%       |
| Recall      | 53%       | 63%       |
| F1          | 31%       | 63%       |

**Matched (10):** Cm, Cm7, Eb, F, Fm7, G, AbM7, Gm7, Bb, C
**Missed (6):** G7, Fm, Ab, Ab9, Eb9, Bb9
**Extra (6):** A#7, A#sus4, C7, D#M7, Ddim, Gm9

### Remaining Accuracy Problems
1. **Key = Eb instead of Cm** — relative major/minor confusion. Dual profiles favor major.
2. **Missing G7** — dominant V7 not detected
3. **Missing 9th chords** (Eb9, Bb9, Ab9) — templates too similar to plain triads
4. **Spurious D#M7, Ddim** — M7 confused with plain triad
5. **Gm9 instead of Gm7** — m9 and m7 templates too similar

## Architecture

### Current flow
```
Frontend (generate.html) --file upload--> Render (chord-service) --> JSON response
    optional YouTube URL for video embed (not used for analysis)
```

### Chord data format
```json
{
  "videoId": "VIDEO_ID_or_upload",
  "key": "Cm",
  "bpm": 95,
  "timeSignature": "3/4",
  "chords": [
    { "time": 0.0, "duration": 2.0, "chord": "Cm" },
    { "time": 2.0, "duration": 1.5, "chord": "G7" }
  ]
}
```

### Files
- `generate.html` — page with upload UI + YouTube embed
- `js/generate.js` — file upload, API call, player sync, transpose
- `chord-service/app.py` — FastAPI v4.0 + librosa + Viterbi (deployed on Render)
- `chord-service/Dockerfile` — Python 3.11 + ffmpeg
- `chord-service/requirements.txt` — librosa, scipy, fastapi, uvicorn, python-multipart
- `supabase/functions/generate-chords/index.ts` — Edge Function (exists but NOT in active flow)
- `ai-gen-chords.txt` — latest v4.0 output for Krooshakum Meshayil (for comparison)

## What Needs to Happen Next

### Priority 1: Fix key detection (Eb vs Cm confusion)
The dual Krumhansl+Temperley profile detects Eb (relative major) instead of Cm.
Potential fixes:
- Add chord-based key validation: after Viterbi, count chords resolving to i vs I
- Weight minor profiles higher when low-register energy is present
- Use the first/last chord as tonic hint

### Priority 2: Audio playback with auto-scrolling chord chart
When user uploads mp3 without a YouTube URL, they can't play along.
Need: HTML5 audio player that plays the uploaded file, with the chord chart
auto-scrolling/highlighting to match the current playback position.

### Priority 3: If accuracy <70% after key fix, try chord-extractor (Chordino)
- `pip install chord-extractor` — wraps Chordino Vamp plugin
- Built-in NNLS-Chroma + HMM, proven MIR algorithm
- Lightweight (~100MB RAM), fits in 512MB
- License: GPLv2

### Research conclusions (2026-03-19)
- **CREMA**: best accuracy but needs TensorFlow (>512MB RAM) — won't fit
- **madmom**: dead project, broken on Python 3.11
- **autochord**: needs TensorFlow (>512MB) — won't fit
- **Essentia ChordsDetection**: major/minor triads only, marked "experimental"
- **Free APIs**: none exist

## Test songs
- `songs/anna-pesaha.md` — YouTube: CGfSjeFkL-0, Key: C, Time: 3/4
- `songs/krooshakum-meshayil.md` — YouTube: AwzKPOERtyE, Key: Cm, Time: 3/4
