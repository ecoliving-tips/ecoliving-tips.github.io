# Supabase Backend for Swaram AI Chord Generator

This directory contains the Supabase Edge Function and database migrations for the AI Chord Generator feature.

## Structure

```
supabase/
├── functions/
│   └── generate-chords/
│       └── index.ts          # Edge Function for chord generation
└── migrations/
    └── 20250318000000_create_generated_chords.sql  # Database schema
```

## Setup Instructions

### 1. Install Supabase CLI

```bash
npm install -g supabase
```

### 2. Link to your Supabase project

```bash
supabase login
supabase link --project-ref your-project-ref
```

### 3. Run migrations

```bash
supabase db push
```

Or apply the migration directly in the Supabase Dashboard SQL editor.

### 4. Deploy the Edge Function

```bash
supabase functions deploy generate-chords
```

### 5. Set environment variables

In the Supabase Dashboard, set these secrets:

- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Your service role key (for DB writes)

## API Usage

```javascript
const response = await fetch('https://your-project.supabase.co/functions/v1/generate-chords', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer your-anon-key'
  },
  body: JSON.stringify({
    url: 'https://www.youtube.com/watch?v=VIDEO_ID'
  })
});

const data = await response.json();
// { videoId, key, bpm, timeSignature, chords: [{ time, duration, chord }] }
```

## Current Implementation (MVP)

The current implementation returns a placeholder chord progression (C - Am - F - G) for testing purposes.

### Phase 2: Full AI Integration

To integrate real chord detection, update the `generateChordsFromVideo` function in `index.ts`:

#### Option A: Using yt-dlp + Python (Recommended)

Deploy a separate Python microservice using:
- yt-dlp for audio extraction
- librosa or CREMA for chord detection
- Deploy to Fly.io, Railway, or similar
- Call from Edge Function

#### Option B: Using WebAssembly

Compile chord detection to WASM:
- Essentia.js (C++ compiled to WASM)
- Run entirely in the Edge Function

#### Option C: Third-party API

Use a chord detection API:
- AudioAnalyzer API
- Spotify Audio Analysis (limited to Spotify catalog)

## Database Schema

The `generated_chords` table caches results to avoid reprocessing the same video:

- `video_id` (text, unique): YouTube video ID
- `youtube_url` (text): Full YouTube URL
- `key` (text): Detected musical key
- `bpm` (integer): Detected tempo
- `time_signature` (text): Time signature (e.g., "4/4")
- `chords` (jsonb): Array of { time, duration, chord } objects
- `generated_at` (timestamptz): When chords were generated
- `created_at` (timestamptz): Row creation time

## Caching Strategy

1. Check if video_id exists in database
2. If yes, return cached results instantly
3. If no, generate chords, save to DB, then return

This provides instant response for previously processed videos.

## Rate Limiting Considerations

Consider adding rate limiting for the Edge Function:
- Per-IP limits
- Per-user limits (if authentication is added)
- Daily generation limits

## Security

- CORS is configured to allow requests from the Swaram domain
- RLS policies restrict writes to the service role
- No API keys are exposed to the client
