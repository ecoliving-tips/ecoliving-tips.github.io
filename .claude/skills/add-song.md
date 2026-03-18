---
description: Add a new song to the Swaram site
user-invocable: true
---

# Add Song Skill

You are adding a new song to the Swaram devotional chords site. Follow these steps precisely:

## Step 1: Gather Song Details

Ask the user for:
- **Song title** (Malayalam transliteration)
- **Artist** (e.g., "Traditional Syro Malabar", "Fr. Binoj Mulavarickal")
- **Category** (e.g., "Holy Mass", "Holy Communion", "Lent", "Christmas", "Marian")
- **Key** (e.g., "C", "Am", "G")
- **Time signature** (e.g., "4/4", "3/4", "6/8")
- **YouTube link** (optional)
- **Chords and lyrics** — the user may paste raw text, a link, or describe the song

## Step 2: Create the Song Markdown File

Generate a song ID by slugifying the title (lowercase, hyphens, no special chars).

Create `songs/<song-id>.md` using this exact format:

```markdown
---
title: Full Song Title
artist: Artist Name
youtube: https://youtube.com/watch?v=VIDEO_ID
category: Category Name
key: X
time: N/N
---

{Intro}
|| C | Am | G | Em ||

{Verse 1}
[C]First line of lyrics [Am]continuation
[G]Second line [Em]of lyrics

{Chorus}
[F]Chorus lyrics [G]here [C]end
```

**Chord notation rules:**
- `{Section}` for section labels (Verse 1, Chorus, Bridge, Intro, Outro, BG, Interlude)
- `|| C | Am | G ||` for chord-only progression lines
- `[Chord]lyrics` for chords positioned above lyrics
- Empty lines between sections

## Step 3: Update `songs/index.json`

Read the current `songs/index.json`, then add the new entry:

```json
{
  "id": "<song-id>",
  "title": "<full title>",
  "file": "<song-id>.md",
  "artist": "<artist>",
  "category": "<category>",
  "key": "<key>",
  "time": "<time>"
}
```

Keep the array sorted alphabetically by `id`.

## Step 4: Add i18n Keys (if new category or artist)

If this song introduces a **new category or artist** not already in `i18n/translations.json`, add appropriate translation keys for both `en` and `ml` sections.

## Step 5: Build

Run: `node build.js`

This generates:
- `songs/<song-id>/index.html` (chord chart page)
- `lyrics/<song-id>/index.html` (lyrics-only page)
- Category/artist pages (if new)
- Updated `sitemap.xml`
- Updated `songs.html` (pre-rendered cards)
- Updated `sw.js` (precache list)

## Step 6: Verify

1. Check that `songs/<song-id>/index.html` exists and has correct content
2. Check that `lyrics/<song-id>/index.html` exists
3. If new category/artist, check those pages exist
4. Confirm `sitemap.xml` includes the new URLs
5. Run `node test-chords.js` if any unusual chords were used

## Step 7: Report

Tell the user what was created and list the URLs:
- `/songs/<song-id>/` — chord chart
- `/lyrics/<song-id>/` — lyrics only
- Any new category/artist pages
