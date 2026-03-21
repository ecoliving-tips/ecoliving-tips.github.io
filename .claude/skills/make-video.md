---
description: Create a YouTube Shorts promo video for a song page using LaunchReel
user-invocable: true
---

# Make Video Skill

Create a YouTube Shorts / social media promo video for a Swaram song page using LaunchReel CLI.

## Prerequisites (one-time setup, already done)
- `npm install -g launchreel` (globally installed)
- `rrweb@2.0.0-alpha.20` installed in `launchreel-output/node_modules/`
- ffmpeg installed via winget (`Gyan.FFmpeg`)
- ffmpeg PATH: `/c/Users/z004tuyd/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1-full_build/bin`

## Step 1: Get Song Details

Ask the user which song to create a video for. The user may provide:
- A song ID (e.g., `krooshakum-meshayil`)
- A song title
- "all" to create videos for all songs

Look up the song in `songs/index.json` to get: `id`, `title`, `artist`, `category`, `key`.

## Step 2: Generate the YAML Config

Create a LaunchReel YAML config at `launchreel-output/launchreel.yaml`.

**For YouTube Shorts (vertical 9:16):**
- Viewport: `1080x1920` with `deviceScaleFactor: 2`
- Keep videos SHORT: 15-30 seconds max
- Focus on the most visually interesting parts

**For regular promo (landscape 16:9):**
- Viewport: `1440x900` with `deviceScaleFactor: 2`

### Template for a single song promo:

```yaml
project:
  name: "Swaram - {{SONG_TITLE}}"
  url: "https://ecoliving-tips.github.io"
  viewport:
    width: 1080    # For Shorts; use 1440 for landscape
    height: 1920   # For Shorts; use 900 for landscape
    deviceScaleFactor: 2
  theme: "dark"

scenarios:
  - id: song-promo
    name: "{{SONG_TITLE}} - Swaram"
    type: screenshot+video
    page: /songs/{{SONG_ID}}/
    actions:
      - wait: 2000
      - finish_animations: true
      - screenshot: { name: "01-song-hero" }
      # Show the song title and key info
      - scroll: { to: 200, duration: 1000 }
      - wait: 800
      # Click first chord to show diagram
      - click: { selector: "[data-original]" }
      - wait: 2000
      - screenshot: { name: "02-chord-diagram" }
      # Dismiss chord popup
      - press_key: "Escape"
      - wait: 500
      # Transpose up to show the feature
      - click: { selector: "#transpose-up" }
      - wait: 600
      - click: { selector: "#transpose-up" }
      - wait: 600
      - screenshot: { name: "03-transposed" }
      # Reset
      - click: { selector: "#transpose-reset" }
      - wait: 500
      # Scroll through chord content
      - scroll: { to: 500, duration: 1500 }
      - wait: 800
      - scroll: { to: 800, duration: 1500 }
      - wait: 800
      - screenshot: { name: "04-chord-content" }

export:
  videos:
    format: mp4
    fps: 24
    crf: 18
  combined_video:
    enabled: false
```

### Key CSS selectors for actions:
| Element | Selector |
|---------|----------|
| Search input (homepage) | `#home-search` |
| Search input (songs page) | `#search-input` |
| Transpose down (-) | `#transpose-down` |
| Transpose up (+) | `#transpose-up` |
| Transpose reset | `#transpose-reset` |
| Auto-scroll toggle | `#auto-scroll-btn` |
| Language toggle (EN/ML) | `.lang-toggle` |
| Song cards | `.song-card` |
| Chord elements (clickable) | `[data-original]` |
| Add to Setlist | `.setlist-btn-add` |
| Scroll speed buttons | `.speed-btn` |

## Step 3: Record

```bash
cd launchreel-output
launchreel record launchreel.yaml -v
```

This uses Puppeteer + rrweb to record DOM sessions. Runs headless. Takes ~30s per scenario.

## Step 4: Export to MP4

**IMPORTANT**: Must add ffmpeg to PATH first.

```bash
export PATH="/c/Users/z004tuyd/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1-full_build/bin:$PATH"
cd launchreel-output
launchreel export launchreel.yaml -v
```

Export renders each frame in headless Chrome and encodes with ffmpeg. **This is slow** — ~2-5 min per scenario depending on duration.

Output goes to: `launchreel-output/launchreel-output/videos/`

## Step 5: Report Results

Tell the user:
- Video file path(s) and size(s)
- Screenshot file path(s)
- Suggest they review and trim if needed before uploading

## Tips
- **Keep scenarios SHORT** for Shorts (15-30s). Fewer actions = faster export.
- **Use `--scenario <id>`** to record/export a single scenario: `launchreel record --scenario song-promo`
- **Use `--headed`** to watch recording in real browser: `launchreel record --headed`
- The `click: { selector: "[data-original]" }` clicks the FIRST chord on the page. To click a specific chord, use `evaluate: "document.querySelector('[data-original=\"Am\"]').click()"`
- Export is the bottleneck. For quick previews, use `launchreel screenshot` (screenshots only, very fast).
- The `navigate` action can jump between pages within one scenario.

## Troubleshooting
- **"Could not find rrweb UMD bundle"**: Run `npm install rrweb@2.0.0-alpha.20` in the `launchreel-output/` directory.
- **"Selector not found"**: The selector doesn't exist on the page. Check the live site and adjust.
- **Export hangs/slow**: Each frame is rendered individually. Reduce scenario duration or use fewer actions.
- **ffmpeg not found**: Add ffmpeg to PATH (see Step 4).
