---
description: Pre-deploy validation checklist
user-invocable: true
---

# Deploy Check Skill

Run a full validation of the site before deploying to production (merging to `main`).

## Checks to Perform

### 1. Build Freshness
Run `node build.js` and check for errors. All generated files should be up-to-date.

### 2. Test Suite
Run `node test-chords.js`. All tests must PASS.

### 3. Song Data Integrity
For each song in `songs/index.json`:
- [ ] The `.md` file referenced by `file` exists in `songs/`
- [ ] Frontmatter parses correctly (title, artist, category, key, time)
- [ ] Generated `songs/<id>/index.html` exists and contains the song title
- [ ] Generated `lyrics/<id>/index.html` exists
- [ ] YouTube embed URL is valid (if present)

### 4. Category & Artist Pages
- [ ] Every unique category in index.json has a `category/<slug>/index.html`
- [ ] Every unique artist in index.json has an `artist/<slug>/index.html`

### 5. Sitemap Validation
Read `sitemap.xml` and verify:
- [ ] All song pages are listed
- [ ] All lyrics pages are listed
- [ ] All category pages are listed
- [ ] All artist pages are listed
- [ ] All root pages are listed (/, /songs.html, /request.html, /privacy-policy.html)
- [ ] No dead/stale URLs

### 6. Service Worker
Read `sw.js` and verify:
- [ ] All generated pages are in the STATIC_ASSETS precache list
- [ ] All root HTML pages are in the precache list
- [ ] Cache version is appropriate

### 7. i18n Completeness
Read `i18n/translations.json` and verify:
- [ ] Every `data-i18n` key used in HTML files exists in both `en` and `ml`
- [ ] No orphaned keys (keys in JSON but not used in any HTML)

### 8. SEO Checks
For each root HTML page and generated page, verify:
- [ ] `<title>` tag exists and is descriptive
- [ ] `<meta name="description">` exists
- [ ] `<link rel="canonical">` exists and is correct
- [ ] Open Graph tags are present

### 9. Navigation Consistency
Verify that the navigation (header + footer) is consistent across:
- [ ] All root HTML pages
- [ ] All templates (partials/header.html, partials/footer.html)
- [ ] Links point to valid pages

### 10. Git Status
- [ ] No untracked generated files (everything committed)
- [ ] Branch is up-to-date with remote
- [ ] No merge conflicts

## Report

Generate a summary:
```
DEPLOY CHECK RESULTS
====================
Build:          PASS/FAIL
Tests:          PASS/FAIL (X/Y passed)
Songs:          PASS/FAIL (N songs validated)
Sitemap:        PASS/FAIL (N URLs)
Service Worker: PASS/FAIL
i18n:           PASS/FAIL (N keys, M missing)
SEO:            PASS/FAIL
Navigation:     PASS/FAIL
Git:            PASS/FAIL

Overall:        READY / NOT READY
```

If any check fails, explain what needs to be fixed.
