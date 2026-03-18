---
description: Add a new static page to the site
user-invocable: true
---

# Add Page Skill

You are adding a new static HTML page to the Swaram site.

## Step 1: Determine Page Details

Ask the user for:
- **Page name/slug** (e.g., "about", "contact")
- **Page title** and description
- **Content** — what should be on the page
- **Should it be indexed by search engines?** (yes/no → controls meta robots tag)
- **Should it appear in navigation?** (yes/no)

## Step 2: Create the HTML Page

Create `<slug>.html` at the project root. Follow the existing page structure:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <!-- Copy meta structure from existing pages (privacy-policy.html is a good reference) -->
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Page Title | Swaram</title>
    <meta name="description" content="...">
    <link rel="canonical" href="https://ecoliving-tips.github.io/<slug>.html">
    <!-- OG tags, Twitter cards, favicon links, AdSense, Google Fonts -->
    <link rel="stylesheet" href="css/styles.css">
</head>
<body>
    <!-- Use the same header as other pages (copy from privacy-policy.html or similar) -->
    <header>...</header>

    <main class="container">
        <!-- Page content here -->
    </main>

    <!-- Use the same footer as other pages -->
    <footer>...</footer>

    <script src="js/main.js"></script>
    <script src="js/i18n.js"></script>
</body>
</html>
```

**Key requirements:**
- Include `data-i18n` attributes on all visible text
- Include the language toggle button in the header
- Include the offline banner `<div id="offline-banner">`
- Match the existing dark theme styling

## Step 3: Add i18n Keys

Add translation keys for all page text to `i18n/translations.json` in both `en` and `ml` sections.

## Step 4: Update Navigation (if needed)

If the page should appear in navigation, add links to:
- `templates/partials/header.html` (nav menu)
- `templates/partials/footer.html` (quick links)
- All root-level HTML pages that have inline header/footer (index.html, songs.html, setlist.html, request.html, privacy-policy.html)

Also add the i18n key `nav_<slug>` to translations.json.

## Step 5: Update SEO Files

1. Add the page URL to `sitemap.xml` with appropriate priority and changefreq
2. Check `robots.txt` — no changes needed unless the page should be blocked
3. Add the page to the `sw.js` STATIC_ASSETS array for offline caching

## Step 6: Rebuild

Run `node build.js` to update service worker precache and sitemap if applicable.

## Step 7: Verify

- Page renders with correct styling
- i18n toggle works
- Page appears in navigation (if applicable)
- Sitemap includes the URL
