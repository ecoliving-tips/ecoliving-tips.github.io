---
description: Run the build system and verify output
user-invocable: true
---

# Build Skill

You are running the Swaram static site build system.

## What It Does

`build.js` is the zero-dependency static site generator. It reads song markdown files and templates to produce the full site.

## Steps

### 1. Run the Build

```bash
node build.js
```

### 2. Verify Output

After a successful build, verify:

1. **Song pages exist** — For each entry in `songs/index.json`, check `songs/<id>/index.html` exists
2. **Lyrics pages exist** — For each entry, check `lyrics/<id>/index.html` exists
3. **Category pages exist** — For each unique category, check `category/<slug>/index.html`
4. **Artist pages exist** — For each unique artist, check `artist/<slug>/index.html`
5. **Sitemap updated** — Read `sitemap.xml` and confirm all URLs are present
6. **songs.html updated** — Check that pre-rendered song cards match `songs/index.json` count
7. **sw.js updated** — Check that the precache list includes all generated pages

### 3. Run Tests

```bash
node test-chords.js
```

Report any FAIL results.

### 4. Report

Summarize what was generated:
- Number of song pages
- Number of lyrics pages
- Number of category pages
- Number of artist pages
- Total URLs in sitemap
- Test results (pass/fail count)

If any errors occurred during build, diagnose and fix them.
