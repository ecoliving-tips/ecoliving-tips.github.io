/**
 * Swaram - Static Site Generator (build.js)
 *
 * Reads songs/index.json and song .md files, generates:
 *   - Static song pages at /songs/<id>/index.html
 *   - Lyrics-only pages at /lyrics/<id>/index.html
 *   - Category landing pages at /category/<slug>/index.html
 *   - Artist landing pages at /artist/<slug>/index.html
 *   - Updated sitemap.xml
 *
 * Run:  node build.js
 * No npm dependencies — uses only Node.js built-ins.
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://ecoliving-tips.github.io';
const ROOT = __dirname;
const today = new Date().toISOString().split('T')[0];

// ===== Utilities =====

function slugify(text) {
    return text.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function mkdirp(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

// ===== Frontmatter Parser =====

function parseFrontmatter(content) {
    // Normalize Windows \r\n to \n
    content = content.replace(/\r\n/g, '\n');
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return { metadata: {}, body: content };

    const metadata = {};
    match[1].split('\n').forEach(line => {
        const [key, ...valueParts] = line.split(':');
        if (key && valueParts.length) {
            metadata[key.trim()] = valueParts.join(':').trim();
        }
    });
    return { metadata, body: match[2] };
}

// ===== Chord Content Renderers (exact port from songs.js) =====

function formatChordContentHTML(content) {
    let html = '';
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (!line) {
            html += '<div class="song-spacer"></div>\n';
            continue;
        }

        const sectionMatch = line.match(/^\{(.+)\}$/);
        if (sectionMatch) {
            html += `<h3 class="section-label">${escapeHtml(sectionMatch[1])}</h3>\n`;
            continue;
        }

        if (line.startsWith('# ')) continue;
        if (line.startsWith('## ')) continue;
        if (line.startsWith('### ')) {
            html += `<h3 class="section-label">${escapeHtml(line.substring(4))}</h3>\n`;
            continue;
        }

        if (line.startsWith('||') && line.endsWith('||')) {
            const chordsLine = line.replace(/^\|\||\|\|$/g, '').trim();
            const chords = chordsLine.split('|').map(c => c.trim()).filter(c => c);
            if (chords.length > 0) {
                html += '<div class="chord-progression"><div class="chord-line">';
                chords.forEach(chord => {
                    html += `<span class="chord" data-original="${escapeHtml(chord)}">${escapeHtml(chord)}</span>`;
                });
                html += '</div></div>\n';
            }
            continue;
        }

        if (line.includes('[') && line.includes(']')) {
            html += parseChordLyricLineHTML(line) + '\n';
            continue;
        }

        html += `<div class="lyric-only-line">${escapeHtml(line)}</div>\n`;
    }

    return html;
}

function parseChordLyricLineHTML(line) {
    let html = '<div class="chord-lyric-line">';
    const regex = /\[([^\]]+)\]([^\[]*)/g;
    let match;

    const firstBracket = line.indexOf('[');
    if (firstBracket > 0) {
        const textBefore = line.substring(0, firstBracket);
        if (textBefore.trim()) {
            html += `<span class="chord-lyric-pair"><span class="chord-name empty"></span><span class="lyric-text">${escapeHtml(textBefore)}</span></span>`;
        }
    }

    while ((match = regex.exec(line)) !== null) {
        const chord = match[1];
        const text = match[2];
        html += `<span class="chord-lyric-pair"><span class="chord-name" data-original="${escapeHtml(chord)}">${escapeHtml(chord)}</span><span class="lyric-text">${text ? escapeHtml(text) : '&nbsp;'}</span></span>`;
    }

    html += '</div>';
    return html;
}

// ===== Lyrics Stripper =====

function stripChordsFromContent(content) {
    let html = '';
    const lines = content.split('\n');

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (!line) {
            html += '<div class="song-spacer"></div>\n';
            continue;
        }

        const sectionMatch = line.match(/^\{(.+)\}$/);
        if (sectionMatch) {
            html += `<h3 class="section-label">${escapeHtml(sectionMatch[1])}</h3>\n`;
            continue;
        }

        if (line.startsWith('# ') || line.startsWith('## ')) continue;
        if (line.startsWith('### ')) {
            html += `<h3 class="section-label">${escapeHtml(line.substring(4))}</h3>\n`;
            continue;
        }

        // Skip chord-only progression lines
        if (line.startsWith('||') && line.endsWith('||')) continue;

        // Strip [Chord] notation from chord+lyric lines
        if (line.includes('[') && line.includes(']')) {
            const stripped = line.replace(/\[([^\]]+)\]/g, '');
            if (stripped.trim()) {
                html += `<div class="lyric-line">${escapeHtml(stripped)}</div>\n`;
            }
            continue;
        }

        html += `<div class="lyric-line">${escapeHtml(line)}</div>\n`;
    }

    return html;
}

// ===== YouTube Helper =====

function extractYouTubeId(url) {
    if (!url) return null;
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
    return match ? match[1] : null;
}

function renderYouTubeEmbed(url, title) {
    const videoId = extractYouTubeId(url);
    if (!videoId) return '';
    return `<div id="youtube-embed" class="video-container">
                    <iframe width="100%" height="315"
                        src="https://www.youtube.com/embed/${videoId}"
                        frameborder="0" allowfullscreen loading="lazy"
                        title="${escapeHtml(title || 'Song')} - Video Tutorial">
                    </iframe>
                </div>`;
}

// ===== Song Card Generator =====

function renderSongCard(song) {
    return `<div class="song-card">
                    <h3>${escapeHtml(song.title)}</h3>
                    <p class="artist">${escapeHtml(song.artist || 'Unknown Artist')}</p>
                    <div class="song-card-meta">
                        <span class="meta-badge">${escapeHtml(song.category || 'General')}</span>
                        ${song.key ? `<span class="meta-badge meta-key">Key: ${escapeHtml(song.key)}</span>` : ''}
                        ${song.time ? `<span class="meta-badge meta-time">${escapeHtml(song.time)}</span>` : ''}
                    </div>
                    <a href="/songs/${song.id}/" class="btn">View Chords</a>
                </div>`;
}

// ===== Template Loader =====

function loadTemplates() {
    const read = (relPath) => fs.readFileSync(path.join(ROOT, 'templates', relPath), 'utf-8');
    return {
        partials: {
            head: read('partials/head.html'),
            header: read('partials/header.html'),
            footer: read('partials/footer.html'),
            donate: read('partials/donate.html'),
        },
        songPage: read('song-page.html'),
        lyricsPage: read('lyrics-page.html'),
        categoryPage: read('category-page.html'),
        artistPage: read('artist-page.html'),
    };
}

function fillPartials(template, partials) {
    return template
        .replace('{{HEADER}}', partials.header)
        .replace('{{FOOTER}}', partials.footer)
        .replace('{{DONATE}}', partials.donate);
}

function fillHead(template, partials, headVars) {
    let head = partials.head;
    for (const [key, value] of Object.entries(headVars)) {
        head = head.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    return template.replace('{{HEAD}}', head);
}

// ===== Song Page Generator =====

function generateSongPage(song, body, templates) {
    const { partials, songPage } = templates;
    const songTitle = song.title;
    const artist = song.artist || 'Traditional';
    const category = song.category || '';
    const key = song.key || 'C';
    const time = song.time || '4/4';
    const canonicalUrl = `${BASE_URL}/songs/${song.id}/`;

    const pageTitle = `${songTitle} Chords for Keyboard & Guitar - ${artist} | Swaram`;
    const pageDesc = `Free ${songTitle} keyboard and guitar chord chart. ${artist} - Malayalam Christian ${category ? category + ' ' : ''}song with chord progression, lyrics, and video tutorial.`;
    const keywords = `${songTitle} chords, ${songTitle} keyboard chords, ${songTitle} guitar chords, ${artist} chords, Malayalam Christian song chords, ${category} song chords`;

    const structuredData = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "MusicComposition",
        "name": songTitle,
        "composer": { "@type": artist.toLowerCase().includes('traditional') ? "Organization" : "Person", "name": artist },
        "musicalKey": key,
        "url": canonicalUrl,
        "description": pageDesc,
        "genre": category,
        "isPartOf": {
            "@type": "WebSite",
            "name": "Swaram",
            "url": `${BASE_URL}/`
        }
    }, null, 2);

    // Build meta bar
    let metaBar = '';
    if (key) metaBar += `<span class="meta-pill meta-pill-key"><span class="meta-label">Key</span> <span id="current-key">${escapeHtml(key)}</span></span>`;
    if (time) metaBar += `<span class="meta-pill meta-pill-time"><span class="meta-label">Time</span> ${escapeHtml(time)}</span>`;
    if (category) metaBar += `<span class="meta-pill"><span class="meta-label">Genre</span> ${escapeHtml(category)}</span>`;

    // YouTube embed
    const youtubeEmbed = song.youtube ? renderYouTubeEmbed(song.youtube, songTitle) : '';

    // Category & artist links
    const categorySlug = category ? slugify(category) : '';
    const artistSlug = slugify(artist);
    const categoryLink = categorySlug ? `<a href="/category/${categorySlug}/" class="song-nav-tag">More ${escapeHtml(category)} songs</a>` : '';
    const artistLink = `<a href="/artist/${artistSlug}/" class="song-nav-tag">More by ${escapeHtml(artist)}</a>`;

    // Chord content
    const chordContent = formatChordContentHTML(body);

    // Assemble
    let page = songPage;
    page = fillHead(page, partials, {
        TITLE: escapeHtml(pageTitle),
        DESCRIPTION: escapeHtml(pageDesc),
        KEYWORDS: escapeHtml(keywords),
        CANONICAL_URL: canonicalUrl,
        OG_TITLE: escapeHtml(pageTitle),
        OG_DESCRIPTION: escapeHtml(pageDesc),
        OG_URL: canonicalUrl,
        TWITTER_TITLE: escapeHtml(pageTitle),
        TWITTER_DESCRIPTION: escapeHtml(pageDesc),
        EXTRA_HEAD: '',
    });
    page = fillPartials(page, partials);
    page = page
        .replace(/\{\{SONG_TITLE\}\}/g, escapeHtml(songTitle))
        .replace(/\{\{ARTIST\}\}/g, escapeHtml(artist))
        .replace(/\{\{KEY\}\}/g, escapeHtml(key))
        .replace(/\{\{TIME\}\}/g, escapeHtml(time))
        .replace('{{META_BAR}}', metaBar)
        .replace('{{CHORD_CONTENT}}', chordContent)
        .replace('{{YOUTUBE_EMBED}}', youtubeEmbed)
        .replace('{{CATEGORY_LINK}}', categoryLink)
        .replace('{{ARTIST_LINK}}', artistLink)
        .replace('{{STRUCTURED_DATA}}', structuredData)
        .replace(/\{\{SONG_ID\}\}/g, song.id);

    const outDir = path.join(ROOT, 'songs', song.id);
    mkdirp(outDir);
    fs.writeFileSync(path.join(outDir, 'index.html'), page);
}

// ===== Lyrics Page Generator =====

function generateLyricsPage(song, body, templates) {
    const { partials, lyricsPage } = templates;
    const songTitle = song.title;
    const artist = song.artist || 'Traditional';
    const category = song.category || '';
    const canonicalUrl = `${BASE_URL}/lyrics/${song.id}/`;

    const pageTitle = `${songTitle} Lyrics - Malayalam Christian Song | Swaram`;
    const pageDesc = `Read the lyrics of ${songTitle} by ${artist}. Malayalam Christian ${category ? category + ' ' : ''}song lyrics.`;
    const keywords = `${songTitle} lyrics, ${songTitle} Malayalam lyrics, ${artist} song lyrics, Malayalam Christian song lyrics`;

    const structuredData = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "CreativeWork",
        "name": `${songTitle} - Lyrics`,
        "author": { "@type": "Person", "name": artist },
        "inLanguage": "ml",
        "url": canonicalUrl,
        "description": pageDesc,
        "isPartOf": {
            "@type": "WebSite",
            "name": "Swaram",
            "url": `${BASE_URL}/`
        }
    }, null, 2);

    const lyricsContent = stripChordsFromContent(body);
    const youtubeEmbed = song.youtube ? renderYouTubeEmbed(song.youtube, songTitle) : '';

    let page = lyricsPage;
    page = fillHead(page, partials, {
        TITLE: escapeHtml(pageTitle),
        DESCRIPTION: escapeHtml(pageDesc),
        KEYWORDS: escapeHtml(keywords),
        CANONICAL_URL: canonicalUrl,
        OG_TITLE: escapeHtml(pageTitle),
        OG_DESCRIPTION: escapeHtml(pageDesc),
        OG_URL: canonicalUrl,
        TWITTER_TITLE: escapeHtml(pageTitle),
        TWITTER_DESCRIPTION: escapeHtml(pageDesc),
        EXTRA_HEAD: '',
    });
    page = fillPartials(page, partials);
    page = page
        .replace(/\{\{SONG_TITLE\}\}/g, escapeHtml(songTitle))
        .replace(/\{\{ARTIST\}\}/g, escapeHtml(artist))
        .replace(/\{\{SONG_ID\}\}/g, song.id)
        .replace('{{LYRICS_CONTENT}}', lyricsContent)
        .replace('{{YOUTUBE_EMBED}}', youtubeEmbed)
        .replace('{{STRUCTURED_DATA}}', structuredData);

    const outDir = path.join(ROOT, 'lyrics', song.id);
    mkdirp(outDir);
    fs.writeFileSync(path.join(outDir, 'index.html'), page);
}

// ===== Category Page Generator =====

function generateCategoryPage(categoryName, songs, allCategories, templates) {
    const { partials, categoryPage } = templates;
    const slug = slugify(categoryName);
    const canonicalUrl = `${BASE_URL}/category/${slug}/`;

    const pageTitle = `${categoryName} Song Chords - Malayalam Christian Songs | Swaram`;
    const pageDesc = `Browse chord charts for Malayalam Christian ${categoryName} songs. Free keyboard and guitar chords for ${categoryName} songs with video tutorials.`;
    const keywords = `${categoryName} chords, Malayalam ${categoryName} song chords, Christian ${categoryName} songs keyboard, ${categoryName} guitar chords`;

    const structuredData = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "name": pageTitle,
        "description": pageDesc,
        "url": canonicalUrl,
        "numberOfItems": songs.length,
        "isPartOf": {
            "@type": "WebSite",
            "name": "Swaram",
            "url": `${BASE_URL}/`
        }
    }, null, 2);

    const songCards = songs.map(renderSongCard).join('\n');

    // Other category links
    const otherCategories = allCategories
        .filter(c => c !== categoryName)
        .map(c => `<a href="/category/${slugify(c)}/" class="category-tag">${escapeHtml(c)}</a>`)
        .join('\n');

    let page = categoryPage;
    page = fillHead(page, partials, {
        TITLE: escapeHtml(pageTitle),
        DESCRIPTION: escapeHtml(pageDesc),
        KEYWORDS: escapeHtml(keywords),
        CANONICAL_URL: canonicalUrl,
        OG_TITLE: escapeHtml(pageTitle),
        OG_DESCRIPTION: escapeHtml(pageDesc),
        OG_URL: canonicalUrl,
        TWITTER_TITLE: escapeHtml(pageTitle),
        TWITTER_DESCRIPTION: escapeHtml(pageDesc),
        EXTRA_HEAD: '',
    });
    page = fillPartials(page, partials);
    page = page
        .replace(/\{\{CATEGORY_NAME\}\}/g, escapeHtml(categoryName))
        .replace('{{SONG_CARDS}}', songCards)
        .replace('{{OTHER_CATEGORIES}}', otherCategories)
        .replace('{{STRUCTURED_DATA}}', structuredData);

    const outDir = path.join(ROOT, 'category', slug);
    mkdirp(outDir);
    fs.writeFileSync(path.join(outDir, 'index.html'), page);
}

// ===== Artist Page Generator =====

function generateArtistPage(artistName, songs, templates) {
    const { partials, artistPage } = templates;
    const slug = slugify(artistName);
    const canonicalUrl = `${BASE_URL}/artist/${slug}/`;

    const pageTitle = `${artistName} - Malayalam Christian Song Chords | Swaram`;
    const pageDesc = `Chord charts for songs by ${artistName}. Free keyboard and guitar chords for Malayalam Christian devotional songs.`;
    const keywords = `${artistName} chords, ${artistName} songs chords, ${artistName} Malayalam Christian songs`;

    const structuredData = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "MusicGroup",
        "name": artistName,
        "url": canonicalUrl,
        "description": pageDesc
    }, null, 2);

    const songCards = songs.map(renderSongCard).join('\n');

    let page = artistPage;
    page = fillHead(page, partials, {
        TITLE: escapeHtml(pageTitle),
        DESCRIPTION: escapeHtml(pageDesc),
        KEYWORDS: escapeHtml(keywords),
        CANONICAL_URL: canonicalUrl,
        OG_TITLE: escapeHtml(pageTitle),
        OG_DESCRIPTION: escapeHtml(pageDesc),
        OG_URL: canonicalUrl,
        TWITTER_TITLE: escapeHtml(pageTitle),
        TWITTER_DESCRIPTION: escapeHtml(pageDesc),
        EXTRA_HEAD: '',
    });
    page = fillPartials(page, partials);
    page = page
        .replace(/\{\{ARTIST_NAME\}\}/g, escapeHtml(artistName))
        .replace('{{SONG_CARDS}}', songCards)
        .replace('{{STRUCTURED_DATA}}', structuredData);

    const outDir = path.join(ROOT, 'artist', slug);
    mkdirp(outDir);
    fs.writeFileSync(path.join(outDir, 'index.html'), page);
}

// ===== Sitemap Generator =====

function generateSitemap(songs, categories, artists) {
    const staticPages = [
        { loc: '/', changefreq: 'weekly', priority: '1.0' },
        { loc: '/songs.html', changefreq: 'weekly', priority: '0.9' },
        { loc: '/request.html', changefreq: 'monthly', priority: '0.7' },
        { loc: '/privacy-policy.html', changefreq: 'yearly', priority: '0.3' },
    ];

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    // Static pages
    for (const page of staticPages) {
        xml += `  <url>\n`;
        xml += `    <loc>${BASE_URL}${page.loc}</loc>\n`;
        xml += `    <lastmod>${today}</lastmod>\n`;
        xml += `    <changefreq>${page.changefreq}</changefreq>\n`;
        xml += `    <priority>${page.priority}</priority>\n`;
        xml += `  </url>\n\n`;
    }

    // Song pages
    for (const song of songs) {
        xml += `  <url>\n`;
        xml += `    <loc>${BASE_URL}/songs/${song.id}/</loc>\n`;
        xml += `    <lastmod>${today}</lastmod>\n`;
        xml += `    <changefreq>monthly</changefreq>\n`;
        xml += `    <priority>0.8</priority>\n`;
        xml += `  </url>\n\n`;
    }

    // Lyrics pages
    for (const song of songs) {
        xml += `  <url>\n`;
        xml += `    <loc>${BASE_URL}/lyrics/${song.id}/</loc>\n`;
        xml += `    <lastmod>${today}</lastmod>\n`;
        xml += `    <changefreq>monthly</changefreq>\n`;
        xml += `    <priority>0.7</priority>\n`;
        xml += `  </url>\n\n`;
    }

    // Category pages
    for (const cat of categories) {
        xml += `  <url>\n`;
        xml += `    <loc>${BASE_URL}/category/${slugify(cat)}/</loc>\n`;
        xml += `    <lastmod>${today}</lastmod>\n`;
        xml += `    <changefreq>weekly</changefreq>\n`;
        xml += `    <priority>0.7</priority>\n`;
        xml += `  </url>\n\n`;
    }

    // Artist pages
    for (const artist of artists) {
        xml += `  <url>\n`;
        xml += `    <loc>${BASE_URL}/artist/${slugify(artist)}/</loc>\n`;
        xml += `    <lastmod>${today}</lastmod>\n`;
        xml += `    <changefreq>weekly</changefreq>\n`;
        xml += `    <priority>0.6</priority>\n`;
        xml += `  </url>\n\n`;
    }

    xml += '</urlset>\n';
    fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), xml);
}

// ===== Main =====

function main() {
    console.log('Swaram Build - Starting...\n');

    // Load templates
    const templates = loadTemplates();
    console.log('Templates loaded.');

    // Load songs index
    const indexPath = path.join(ROOT, 'songs', 'index.json');
    const songsIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    console.log(`Found ${songsIndex.length} songs in index.json`);

    // Parse each song's .md file
    const songs = songsIndex.map(songMeta => {
        const mdPath = path.join(ROOT, 'songs', songMeta.file);
        const raw = fs.readFileSync(mdPath, 'utf-8');
        const { metadata, body } = parseFrontmatter(raw);
        return {
            ...songMeta,
            ...metadata,
            body,
        };
    });

    // Collect categories and artists
    const categoriesMap = {};
    const artistsMap = {};
    for (const song of songs) {
        const cat = song.category || 'General';
        if (!categoriesMap[cat]) categoriesMap[cat] = [];
        categoriesMap[cat].push(song);

        const artist = song.artist || 'Unknown';
        if (!artistsMap[artist]) artistsMap[artist] = [];
        artistsMap[artist].push(song);
    }

    const allCategories = Object.keys(categoriesMap);
    const allArtists = Object.keys(artistsMap);

    // Generate song pages
    let songPagesCount = 0;
    for (const song of songs) {
        generateSongPage(song, song.body, templates);
        songPagesCount++;
    }
    console.log(`Generated ${songPagesCount} song pages.`);

    // Generate lyrics pages
    let lyricsPagesCount = 0;
    for (const song of songs) {
        generateLyricsPage(song, song.body, templates);
        lyricsPagesCount++;
    }
    console.log(`Generated ${lyricsPagesCount} lyrics pages.`);

    // Generate category pages
    for (const [categoryName, categorySongs] of Object.entries(categoriesMap)) {
        generateCategoryPage(categoryName, categorySongs, allCategories, templates);
    }
    console.log(`Generated ${allCategories.length} category pages: ${allCategories.join(', ')}`);

    // Generate artist pages
    for (const [artistName, artistSongs] of Object.entries(artistsMap)) {
        generateArtistPage(artistName, artistSongs, templates);
    }
    console.log(`Generated ${allArtists.length} artist pages: ${allArtists.join(', ')}`);

    // Generate sitemap
    generateSitemap(songs, allCategories, allArtists);
    const totalUrls = 4 + songs.length * 2 + allCategories.length + allArtists.length;
    console.log(`Sitemap generated with ${totalUrls} URLs.`);

    // Summary
    console.log('\n--- Build Summary ---');
    console.log(`Song pages:     ${songPagesCount}`);
    console.log(`Lyrics pages:   ${lyricsPagesCount}`);
    console.log(`Category pages: ${allCategories.length}`);
    console.log(`Artist pages:   ${allArtists.length}`);
    console.log(`Sitemap URLs:   ${totalUrls}`);
    console.log('Build complete!');
}

main();
