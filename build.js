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
const https = require('https');

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
                chords.forEach(bar => {
                    const subChords = bar.split(/\s+/).filter(c => c);
                    if (subChords.length > 1) {
                        html += '<span class="bar-group">';
                        subChords.forEach(chord => {
                            html += `<span class="chord" data-original="${escapeHtml(chord)}">${escapeHtml(chord)}</span>`;
                        });
                        html += '</span>';
                    } else {
                        html += `<span class="chord" data-original="${escapeHtml(bar)}">${escapeHtml(bar)}</span>`;
                    }
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

/**
 * Reads <songId>.ml.txt and generates Malayalam lyrics HTML.
 * Plain Malayalam lyrics — one line per lyric line, blank lines as spacers.
 * Returns empty string if no .ml.txt file exists.
 */
function formatMalayalamLyrics(songId) {
    const mlPath = path.join(ROOT, 'songs', `${songId}.ml.txt`);
    if (!fs.existsSync(mlPath)) return '';

    let content = fs.readFileSync(mlPath, 'utf-8').replace(/\r\n/g, '\n');
    let html = '';
    const lines = content.split('\n');

    let consecutiveBlanks = 0;

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (!line) {
            consecutiveBlanks++;
            continue;
        }

        // Flush accumulated blank lines
        if (consecutiveBlanks === 1) {
            html += '<div class="song-spacer"></div>\n';
        } else if (consecutiveBlanks >= 2) {
            html += '<div class="song-section-break"></div>\n';
        }
        consecutiveBlanks = 0;

        // ----- or more dashes → visual divider
        if (/^-{3,}$/.test(line)) {
            html += '<hr class="song-divider">\n';
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
    const titleMl = song.title_ml ? `<span class="lang-ml">${escapeHtml(song.title_ml)}</span>` : '';
    const artistMl = song.artist_ml ? `<span class="lang-ml">${escapeHtml(song.artist_ml)}</span>` : '';
    return `<div class="song-card">
                    <h3><span class="lang-en">${escapeHtml(song.title)}</span>${titleMl}</h3>
                    <p class="artist"><span class="lang-en">${escapeHtml(song.artist || 'Unknown Artist')}</span>${artistMl}</p>
                    <div class="song-card-meta">
                        <span class="meta-badge">${escapeHtml(song.category || 'General')}</span>
                        ${song.key ? `<span class="meta-badge meta-key">Key: ${escapeHtml(song.key)}</span>` : ''}
                        ${song.time ? `<span class="meta-badge meta-time">${escapeHtml(song.time)}</span>` : ''}
                    </div>
                    <div class="song-card-actions">
                        <a href="/songs/${song.id}/" class="btn">View Chords</a>
                        <a href="/lyrics/${song.id}/" class="btn btn-secondary">Lyrics</a>
                    </div>
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
        progressionPage: read('progression-page.html'),
        chordsPage: read('chords-page.html'),
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

function mlExtraHead(canonicalUrl) {
    return `<meta property="og:locale:alternate" content="ml_IN">`;
}

// ===== Song Page Generator =====

function generateSongPage(song, body, templates) {
    const { partials, songPage } = templates;
    const songTitle = song.fullTitle;
    const artist = song.artist || 'Traditional';
    const category = song.category || '';
    const key = song.key || 'C';
    const time = song.time || '4/4';
    const canonicalUrl = `${BASE_URL}/songs/${song.id}/`;

    const pageTitle = `${songTitle} Chords for Keyboard & Guitar - ${artist} | Swaram`;
    const pageDesc = `Free ${songTitle} keyboard and guitar chord chart. ${artist} - Malayalam Christian ${category ? category + ' ' : ''}song with chord progression, lyrics, and video tutorial.`;
    const titleMl = song.title_ml || '';
    const mlKw = titleMl ? `, ${titleMl}, ${titleMl} കോർഡ്, ${titleMl} ഗിറ്റാർ, ${titleMl} കീബോർഡ്` : '';
    const keywords = `${songTitle} chords, ${songTitle} keyboard chords, ${songTitle} guitar chords, ${artist} chords, Malayalam Christian song chords, ${category} song chords${mlKw}`;

    const sdObj = {
        "@context": "https://schema.org",
        "@type": "MusicComposition",
        "name": songTitle,
        "composer": { "@type": artist.toLowerCase().includes('traditional') ? "Organization" : "Person", "name": artist },
        "musicalKey": key,
        "inLanguage": ["en", "ml"],
        "url": canonicalUrl,
        "description": pageDesc,
        "genre": category,
        "isPartOf": {
            "@type": "WebSite",
            "name": "Swaram",
            "url": `${BASE_URL}/`
        }
    };
    if (song.title_ml) sdObj.alternateName = song.title_ml;
    if (song.artist_ml) sdObj.composer.alternateName = song.artist_ml;

    const breadcrumbObj = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            { "@type": "ListItem", "position": 1, "name": "Home", "item": `${BASE_URL}/` },
            { "@type": "ListItem", "position": 2, "name": "Songs", "item": `${BASE_URL}/songs.html` },
            { "@type": "ListItem", "position": 3, "name": songTitle, "item": canonicalUrl }
        ]
    };

    // VideoObject for YouTube embeds (helps Google index video rich results)
    const videoId = extractYouTubeId(song.youtube);
    let videoSd = '';
    if (videoId) {
        const videoObj = {
            "@context": "https://schema.org",
            "@type": "VideoObject",
            "name": `${songTitle} - Chords & Tutorial`,
            "description": `Watch and play along with chords for ${songTitle} by ${artist}. Guitar and keyboard chord chart.`,
            "thumbnailUrl": `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
            "embedUrl": `https://www.youtube.com/embed/${videoId}`,
            "uploadDate": "2026-01-01T00:00:00+05:30",
            "publisher": { "@type": "Organization", "name": "Swaram", "url": `${BASE_URL}/` }
        };
        videoSd = '\n    </script>\n\n    <script type="application/ld+json">\n    ' + JSON.stringify(videoObj, null, 2);
    }

    const structuredData = JSON.stringify(sdObj, null, 2) + '\n    </script>\n\n    <script type="application/ld+json">\n    ' + JSON.stringify(breadcrumbObj, null, 2) + videoSd;

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
    const lyricsLink = `<a href="/lyrics/${song.id}/" class="song-nav-tag">View Lyrics Only</a>`;

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
        EXTRA_HEAD: mlExtraHead(canonicalUrl),
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
        .replace('{{LYRICS_LINK}}', lyricsLink)
        .replace('{{STRUCTURED_DATA}}', structuredData)
        .replace(/\{\{SONG_ID\}\}/g, song.id);

    const outDir = path.join(ROOT, 'songs', song.id);
    mkdirp(outDir);
    fs.writeFileSync(path.join(outDir, 'index.html'), page);
}

// ===== Lyrics Page Generator =====

function generateLyricsPage(song, body, templates) {
    const { partials, lyricsPage } = templates;
    const songTitle = song.fullTitle;
    const artist = song.artist || 'Traditional';
    const category = song.category || '';
    const canonicalUrl = `${BASE_URL}/lyrics/${song.id}/`;

    const pageTitle = `${songTitle} Lyrics - Malayalam Christian Song | Swaram`;
    const pageDesc = `Read the lyrics of ${songTitle} by ${artist}. Malayalam Christian ${category ? category + ' ' : ''}song lyrics.`;
    const titleMl = song.title_ml || '';
    const mlKw = titleMl ? `, ${titleMl}, ${titleMl} വരികൾ` : '';
    const keywords = `${songTitle} lyrics, ${songTitle} Malayalam lyrics, ${artist} song lyrics, Malayalam Christian song lyrics${mlKw}`;

    const sdObj = {
        "@context": "https://schema.org",
        "@type": "CreativeWork",
        "name": `${songTitle} - Lyrics`,
        "author": { "@type": artist.toLowerCase().includes('traditional') ? "Organization" : "Person", "name": artist },
        "inLanguage": ["en", "ml"],
        "url": canonicalUrl,
        "description": pageDesc,
        "isPartOf": {
            "@type": "WebSite",
            "name": "Swaram",
            "url": `${BASE_URL}/`
        }
    };
    if (song.title_ml) sdObj.alternateName = `${song.title_ml} - വരികൾ`;
    if (song.artist_ml) sdObj.author.alternateName = song.artist_ml;

    const breadcrumbObj = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            { "@type": "ListItem", "position": 1, "name": "Home", "item": `${BASE_URL}/` },
            { "@type": "ListItem", "position": 2, "name": "Songs", "item": `${BASE_URL}/songs.html` },
            { "@type": "ListItem", "position": 3, "name": `${songTitle} Lyrics`, "item": canonicalUrl }
        ]
    };

    const structuredData = JSON.stringify(sdObj, null, 2) + '\n    </script>\n\n    <script type="application/ld+json">\n    ' + JSON.stringify(breadcrumbObj, null, 2);

    const enLyrics = stripChordsFromContent(body);
    const mlLyrics = formatMalayalamLyrics(song.id);

    // If Malayalam lyrics exist, wrap both in language containers
    let lyricsContent;
    if (mlLyrics) {
        lyricsContent = `<div class="lang-en">\n${enLyrics}</div>\n<div class="lang-ml">\n${mlLyrics}</div>`;
    } else {
        lyricsContent = enLyrics;
    }

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
        EXTRA_HEAD: mlExtraHead(canonicalUrl),
    });
    page = fillPartials(page, partials);
    page = page
        .replace(/\{\{SONG_TITLE\}\}/g, escapeHtml(songTitle))
        .replace(/\{\{SONG_TITLE_ML\}\}/g, song.title_ml ? escapeHtml(song.title_ml) : '')
        .replace(/\{\{ARTIST\}\}/g, escapeHtml(artist))
        .replace(/\{\{ARTIST_ML\}\}/g, song.artist_ml ? escapeHtml(song.artist_ml) : '')
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
    const categoryMl = songs[0]?.category_ml || '';
    const mlKw = categoryMl ? `, ${categoryMl}, ${categoryMl} കോർഡ്, ${categoryMl} ഗാനങ്ങൾ` : '';
    const keywords = `${categoryName} chords, Malayalam ${categoryName} song chords, Christian ${categoryName} songs keyboard, ${categoryName} guitar chords${mlKw}`;

    const sdObj = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "name": pageTitle,
        "description": pageDesc,
        "url": canonicalUrl,
        "inLanguage": ["en", "ml"],
        "numberOfItems": songs.length,
        "isPartOf": {
            "@type": "WebSite",
            "name": "Swaram",
            "url": `${BASE_URL}/`
        }
    };
    if (categoryMl) sdObj.alternateName = `${categoryMl} ഗാന കോർഡുകൾ`;

    const breadcrumbObj = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            { "@type": "ListItem", "position": 1, "name": "Home", "item": `${BASE_URL}/` },
            { "@type": "ListItem", "position": 2, "name": "Songs", "item": `${BASE_URL}/songs.html` },
            { "@type": "ListItem", "position": 3, "name": categoryName, "item": canonicalUrl }
        ]
    };

    const structuredData = JSON.stringify(sdObj, null, 2) + '\n    </script>\n\n    <script type="application/ld+json">\n    ' + JSON.stringify(breadcrumbObj, null, 2);

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
        EXTRA_HEAD: mlExtraHead(canonicalUrl),
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
    const artistMl = songs[0]?.artist_ml || '';
    const mlKw = artistMl ? `, ${artistMl}, ${artistMl} കോർഡ്` : '';
    const keywords = `${artistName} chords, ${artistName} songs chords, ${artistName} Malayalam Christian songs${mlKw}`;

    const sdObj = {
        "@context": "https://schema.org",
        "@type": "MusicGroup",
        "name": artistName,
        "url": canonicalUrl,
        "description": pageDesc
    };
    if (artistMl) sdObj.alternateName = artistMl;

    const breadcrumbObj = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            { "@type": "ListItem", "position": 1, "name": "Home", "item": `${BASE_URL}/` },
            { "@type": "ListItem", "position": 2, "name": artistName, "item": canonicalUrl }
        ]
    };

    const structuredData = JSON.stringify(sdObj, null, 2) + '\n    </script>\n\n    <script type="application/ld+json">\n    ' + JSON.stringify(breadcrumbObj, null, 2);

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
        EXTRA_HEAD: mlExtraHead(canonicalUrl),
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

// ===== Chord Progression Page Generator =====

const PROG_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PROG_FLAT_DISPLAY = { 'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb' };
const PROG_INTERVALS = {
    '':     [0, 4, 7],
    'm':    [0, 3, 7],
    'dim':  [0, 3, 6],
};
const PROG_MAJOR = [
    { semitones: 0,  quality: '',    label: 'I' },
    { semitones: 2,  quality: 'm',   label: 'ii' },
    { semitones: 4,  quality: 'm',   label: 'iii' },
    { semitones: 5,  quality: '',    label: 'IV' },
    { semitones: 7,  quality: '',    label: 'V' },
    { semitones: 9,  quality: 'm',   label: 'vi' },
    { semitones: 11, quality: 'dim', label: 'vii\u00B0' },
];
const PROG_MINOR = [
    { semitones: 0,  quality: 'm',   label: 'i' },
    { semitones: 2,  quality: 'dim', label: 'ii\u00B0' },
    { semitones: 3,  quality: '',    label: 'III' },
    { semitones: 5,  quality: 'm',   label: 'iv' },
    { semitones: 7,  quality: 'm',   label: 'v' },
    { semitones: 8,  quality: '',    label: 'VI' },
    { semitones: 10, quality: '',    label: 'VII' },
];
const PROG_PRESETS_MAJOR = [
    { name: 'Pop',          degrees: [0, 4, 5, 3], label: 'I \u2013 V \u2013 vi \u2013 IV' },
    { name: 'Rock',         degrees: [0, 3, 4],    label: 'I \u2013 IV \u2013 V' },
    { name: '50s',          degrees: [0, 5, 3, 4], label: 'I \u2013 vi \u2013 IV \u2013 V' },
    { name: 'Axis',         degrees: [5, 3, 0, 4], label: 'vi \u2013 IV \u2013 I \u2013 V' },
    { name: 'Jazz ii-V-I',  degrees: [1, 4, 0],    label: 'ii \u2013 V \u2013 I' },
];
const PROG_PRESETS_MINOR = [
    { name: 'Minor Pop',    degrees: [0, 5, 2, 6], label: 'i \u2013 VI \u2013 III \u2013 VII' },
    { name: 'Andalusian',   degrees: [0, 6, 5, 4], label: 'i \u2013 VII \u2013 VI \u2013 V' },
    { name: 'Minor Blues',  degrees: [0, 3, 4],    label: 'i \u2013 iv \u2013 v' },
];

function progGetDiatonic(rootNote, mode) {
    const scale = mode === 'minor' ? PROG_MINOR : PROG_MAJOR;
    const rootIdx = PROG_NOTES.indexOf(rootNote);
    return scale.map(deg => {
        const noteIdx = (rootIdx + deg.semitones) % 12;
        const note = PROG_NOTES[noteIdx];
        const displayNote = PROG_FLAT_DISPLAY[note] || note;
        return {
            name: note + deg.quality,
            displayName: displayNote + deg.quality,
            degree: deg.label,
        };
    });
}

function progKeySlug(root, mode) {
    let display = PROG_FLAT_DISPLAY[root] || root;
    display = display.toLowerCase().replace('#', '-sharp');
    return 'key-of-' + display + (mode === 'minor' ? '-minor' : '');
}

function progKeyDisplay(root, mode) {
    const display = PROG_FLAT_DISPLAY[root] || root;
    return display + (mode === 'minor' ? ' Minor' : ' Major');
}

function generateProgressionPages(templates) {
    const { partials, progressionPage } = templates;

    // Build list of all 24 keys
    const allKeys = [];
    for (const note of PROG_NOTES) {
        allKeys.push({ root: note, mode: 'major' });
    }
    for (const note of PROG_NOTES) {
        allKeys.push({ root: note, mode: 'minor' });
    }

    for (const keyInfo of allKeys) {
        const { root, mode } = keyInfo;
        const keyDisplay = progKeyDisplay(root, mode);
        const keySlug = progKeySlug(root, mode);
        const canonicalUrl = `${BASE_URL}/chord-progressions/${keySlug}/`;

        const pageTitle = `Chord Progressions in ${keyDisplay} \u2014 Diatonic Chords & Common Patterns | Swaram`;
        const pageDesc = `All diatonic chords and common chord progressions in the key of ${keyDisplay}. Free guitar and keyboard chord diagrams for songwriting and practice.`;
        const keywords = `chord progressions in ${keyDisplay}, ${keyDisplay} chords, diatonic chords ${keyDisplay}, chords in key of ${PROG_FLAT_DISPLAY[root] || root}, ${keyDisplay} chord chart, songwriting chords ${keyDisplay}`;

        // Schema.org
        const diatonic = progGetDiatonic(root, mode);
        const sdObj = {
            "@context": "https://schema.org",
            "@type": "WebPage",
            "name": `Chord Progressions in ${keyDisplay}`,
            "description": pageDesc,
            "url": canonicalUrl,
            "isPartOf": {
                "@type": "WebSite",
                "name": "Swaram",
                "url": `${BASE_URL}/`
            }
        };
        const breadcrumbObj = {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
                { "@type": "ListItem", "position": 1, "name": "Home", "item": `${BASE_URL}/` },
                { "@type": "ListItem", "position": 2, "name": "Chord Progressions", "item": `${BASE_URL}/chord-progressions.html` },
                { "@type": "ListItem", "position": 3, "name": keyDisplay, "item": canonicalUrl }
            ]
        };
        const structuredData = JSON.stringify(sdObj, null, 2) + '\n    </script>\n\n    <script type="application/ld+json">\n    ' + JSON.stringify(breadcrumbObj, null, 2);

        // Diatonic chord cards
        const diatonicHtml = diatonic.map(chord =>
            `<div class="diatonic-card">` +
            `<span class="diatonic-degree">${chord.degree}</span>` +
            `<span class="diatonic-name">${escapeHtml(chord.displayName)}</span>` +
            `</div>`
        ).join('\n                    ');

        // Preset progressions
        const presets = mode === 'minor' ? PROG_PRESETS_MINOR : PROG_PRESETS_MAJOR;
        const presetsHtml = presets.map(preset => {
            const chordNames = preset.degrees.map(idx => diatonic[idx].displayName).join(' \u2192 ');
            return `<div class="preset-card">` +
                `<span class="preset-card-name">${escapeHtml(preset.name)}</span>` +
                `<span class="preset-card-chords">${preset.label} (${escapeHtml(chordNames)})</span>` +
                `</div>`;
        }).join('\n                    ');

        // Other key links
        const otherKeysHtml = allKeys
            .filter(k => !(k.root === root && k.mode === mode))
            .map(k => {
                const d = progKeyDisplay(k.root, k.mode);
                const s = progKeySlug(k.root, k.mode);
                return `<a href="/chord-progressions/${s}/">${escapeHtml(d)}</a>`;
            })
            .join('\n                    ');

        let page = progressionPage;
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
            .replace(/\{\{KEY_DISPLAY\}\}/g, escapeHtml(keyDisplay))
            .replace('{{DIATONIC_CHORDS}}', diatonicHtml)
            .replace('{{COMMON_PROGRESSIONS}}', presetsHtml)
            .replace('{{OTHER_KEYS}}', otherKeysHtml)
            .replace('{{STRUCTURED_DATA}}', structuredData);

        const outDir = path.join(ROOT, 'chord-progressions', keySlug);
        mkdirp(outDir);
        fs.writeFileSync(path.join(outDir, 'index.html'), page);
    }

    return allKeys;
}

// ===== Sitemap Generator =====

function buildUrlset(entries) {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    for (const e of entries) {
        xml += `  <url>\n`;
        xml += `    <loc>${e.loc}</loc>\n`;
        xml += `    <lastmod>${e.lastmod}</lastmod>\n`;
        xml += `    <changefreq>${e.changefreq}</changefreq>\n`;
        xml += `    <priority>${e.priority}</priority>\n`;
        xml += `  </url>\n`;
    }
    xml += '</urlset>\n';
    return xml;
}

function generateSitemap(songs, categories, artists, progressionKeys, aiChordPages) {
    function getLastmod(filePath) {
        try {
            const stat = fs.statSync(path.join(ROOT, filePath));
            return stat.mtime.toISOString().split('T')[0];
        } catch {
            return today;
        }
    }

    // --- Segment: static pages ---
    const pagesEntries = [
        { loc: '/', changefreq: 'weekly', priority: '1.0', file: 'index.html' },
        { loc: '/songs.html', changefreq: 'weekly', priority: '0.9', file: 'songs.html' },
        { loc: '/chord-finder.html', changefreq: 'weekly', priority: '0.95', file: 'chord-finder.html' },
        { loc: '/chord-identifier.html', changefreq: 'monthly', priority: '0.90', file: 'chord-identifier.html' },
        { loc: '/chord-progressions.html', changefreq: 'monthly', priority: '0.90', file: 'chord-progressions.html' },
        { loc: '/request.html', changefreq: 'monthly', priority: '0.7', file: 'request.html' },
        { loc: '/privacy-policy.html', changefreq: 'yearly', priority: '0.3', file: 'privacy-policy.html' },
    ].map(p => ({
        loc: `${BASE_URL}${p.loc}`,
        lastmod: getLastmod(p.file),
        changefreq: p.changefreq,
        priority: p.priority,
    }));

    // --- Segment: song pages ---
    const songsEntries = songs.map(song => ({
        loc: `${BASE_URL}/songs/${song.id}/`,
        lastmod: getLastmod(`songs/${song.file || song.id + '.md'}`),
        changefreq: 'monthly',
        priority: '0.8',
    }));

    // --- Segment: lyrics pages ---
    const lyricsEntries = songs.map(song => ({
        loc: `${BASE_URL}/lyrics/${song.id}/`,
        lastmod: getLastmod(`songs/${song.file || song.id + '.md'}`),
        changefreq: 'monthly',
        priority: '0.7',
    }));

    // --- Segment: category pages ---
    const categoryEntries = categories.map(cat => ({
        loc: `${BASE_URL}/category/${slugify(cat)}/`,
        lastmod: today,
        changefreq: 'weekly',
        priority: '0.7',
    }));

    // --- Segment: artist pages ---
    const artistEntries = artists.map(artist => ({
        loc: `${BASE_URL}/artist/${slugify(artist)}/`,
        lastmod: today,
        changefreq: 'weekly',
        priority: '0.6',
    }));

    // --- Segment: chord progression pages ---
    const progressionEntries = (progressionKeys || []).map(keyInfo => ({
        loc: `${BASE_URL}/chord-progressions/${progKeySlug(keyInfo.root, keyInfo.mode)}/`,
        lastmod: today,
        changefreq: 'monthly',
        priority: '0.75',
    }));

    // --- Segment: AI chord pages ---
    const chordEntries = (aiChordPages || []).map(entry => ({
        loc: `${BASE_URL}/chords/${entry.slug}/`,
        lastmod: entry.created_at ? entry.created_at.split('T')[0] : today,
        changefreq: 'monthly',
        priority: '0.75',
    }));

    // Write individual sitemap files and collect index entries
    const segments = [
        { file: 'sitemap-pages.xml', entries: pagesEntries },
        { file: 'sitemap-songs.xml', entries: songsEntries },
        { file: 'sitemap-lyrics.xml', entries: lyricsEntries },
        { file: 'sitemap-categories.xml', entries: categoryEntries },
        { file: 'sitemap-artists.xml', entries: artistEntries },
        { file: 'sitemap-progressions.xml', entries: progressionEntries },
        { file: 'sitemap-chords.xml', entries: chordEntries },
    ];

    const indexEntries = [];
    for (const seg of segments) {
        if (seg.entries.length === 0) continue;
        fs.writeFileSync(path.join(ROOT, seg.file), buildUrlset(seg.entries));
        // Use the most recent lastmod from the segment's entries
        const latestMod = seg.entries.reduce((max, e) => e.lastmod > max ? e.lastmod : max, seg.entries[0].lastmod);
        indexEntries.push({ file: seg.file, lastmod: latestMod });
    }

    // Write sitemap index
    let idx = '<?xml version="1.0" encoding="UTF-8"?>\n';
    idx += '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    for (const entry of indexEntries) {
        idx += `  <sitemap>\n`;
        idx += `    <loc>${BASE_URL}/${entry.file}</loc>\n`;
        idx += `    <lastmod>${entry.lastmod}</lastmod>\n`;
        idx += `  </sitemap>\n`;
    }
    idx += '</sitemapindex>\n';
    fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), idx);
}


function generateRSSFeed(songs, aiChordPages) {
    const MAX_ITEMS = 50;
    const items = [];

    // AI chord pages (sorted by created_at desc from Supabase)
    if (aiChordPages) {
        for (const entry of aiChordPages) {
            if (!entry.slug) continue;
            const uniqueChords = extractUniqueChords(entry.chords);
            const chordList = uniqueChords.slice(0, 8).join(', ');
            items.push({
                title: `${entry.title || entry.slug} — ${entry.artist || 'Unknown'} Chords`,
                link: `${BASE_URL}/chords/${entry.slug}/`,
                description: `AI-detected chord progression for ${entry.title || entry.slug} by ${entry.artist || 'Unknown'}. Chords: ${chordList || 'N/A'}`,
                pubDate: entry.created_at ? new Date(entry.created_at).toUTCString() : new Date().toUTCString(),
            });
        }
    }

    // Curated songs
    for (const song of songs) {
        items.push({
            title: `${song.title} — ${song.artist} Chords`,
            link: `${BASE_URL}/songs/${song.id}/`,
            description: `Guitar and keyboard chords for ${song.title} by ${song.artist}. Key: ${song.key || 'N/A'}`,
            pubDate: new Date().toUTCString(),
        });
    }

    // Limit to newest items
    const feed = items.slice(0, MAX_ITEMS);

    const escXml = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    let rss = '<?xml version="1.0" encoding="UTF-8"?>\n';
    rss += '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n';
    rss += '  <channel>\n';
    rss += '    <title>Swaram — AI Chord Finder</title>\n';
    rss += `    <link>${BASE_URL}/</link>\n`;
    rss += '    <description>Free AI-powered chord detection for any song. Latest chord pages and updates.</description>\n';
    rss += '    <language>en</language>\n';
    rss += `    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>\n`;
    rss += `    <atom:link href="${BASE_URL}/feed.xml" rel="self" type="application/rss+xml"/>\n`;
    rss += '    <atom:link href="https://pubsubhubbub.appspot.com/" rel="hub"/>\n';

    for (const item of feed) {
        rss += '    <item>\n';
        rss += `      <title>${escXml(item.title)}</title>\n`;
        rss += `      <link>${item.link}</link>\n`;
        rss += `      <guid>${item.link}</guid>\n`;
        rss += `      <description>${escXml(item.description)}</description>\n`;
        rss += `      <pubDate>${item.pubDate}</pubDate>\n`;
        rss += '    </item>\n';
    }

    rss += '  </channel>\n';
    rss += '</rss>\n';

    fs.writeFileSync(path.join(ROOT, 'feed.xml'), rss);
}

function pingWebSub() {
    const body = 'hub.mode=publish&hub.url=' + encodeURIComponent(BASE_URL + '/feed.xml');
    return new Promise((resolve) => {
        const req = https.request({
            hostname: 'pubsubhubbub.appspot.com',
            path: '/',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body),
            },
        }, (res) => {
            if (res.statusCode === 204 || res.statusCode === 200) {
                console.log('WebSub ping sent — Google notified of feed update.');
            } else {
                console.log('WebSub ping returned HTTP ' + res.statusCode + ' (non-fatal, Google will still crawl naturally).');
            }
            res.resume();
            resolve();
        });
        req.on('error', (err) => {
            console.log('WebSub ping failed: ' + err.message + ' (non-fatal).');
            resolve();
        });
        req.write(body);
        req.end();
    });
}


// ===== Service Worker Precache Updater =====
// NOTE: Song/lyrics/category/artist pages are intentionally NOT precached
// in sw.js to ensure every page visit requires a network request (for ad impressions).
// Only app shell assets (CSS, JS, homepage) are cached by the service worker.

// ===== Songs Page Pre-renderer =====

function generateSongsPage(songs, allCategories, allArtists) {
    const songsHtmlPath = path.join(ROOT, 'songs.html');
    let html = fs.readFileSync(songsHtmlPath, 'utf-8');

    // Pre-render song cards (replace content between songs-grid tags)
    const songCards = songs.map(renderSongCard).join('\n');
    html = html.replace(
        /(<div id="songs-grid" class="songs-grid">)[\s\S]*?(<\/div>\s*<div id="no-results")/,
        `$1${songCards}$2`
    );

    // Pre-render song count
    html = html.replace(
        /(<span id="song-count">)[\s\S]*?(<\/span>)/,
        `$1${songs.length}$2`
    );

    // Pre-render category tags
    const categoryTags = allCategories
        .map(c => `<a href="/category/${slugify(c)}/" class="browse-tag">${escapeHtml(c)}</a>`)
        .join('\n');
    html = html.replace(
        /(<div id="category-tags" class="tag-list">)[\s\S]*?(<\/div>)/,
        `$1${categoryTags}$2`
    );

    // Pre-render artist tags
    const artistTags = allArtists
        .map(a => `<a href="/artist/${slugify(a)}/" class="browse-tag">${escapeHtml(a)}</a>`)
        .join('\n');
    html = html.replace(
        /(<div id="artist-tags" class="tag-list">)[\s\S]*?(<\/div>)/,
        `$1${artistTags}$2`
    );

    fs.writeFileSync(songsHtmlPath, html);
}

// ===== Homepage Featured Songs Pre-renderer =====

function generateHomepageFeaturedSongs(songs) {
    const indexHtmlPath = path.join(ROOT, 'index.html');
    let html = fs.readFileSync(indexHtmlPath, 'utf-8');

    const featured = songs.slice(0, 3);
    const songCards = featured.map(renderSongCard).join('\n');

    html = html.replace(
        /(<div class="songs-grid" id="featured-songs">)[\s\S]*?(<\/div>\s*<div class="songs-cta">)/,
        `$1\n${songCards}\n$2`
    );

    fs.writeFileSync(indexHtmlPath, html);
}

// ===== AI-Generated Chord Pages (Supabase → Static HTML) =====

const SUPABASE_URL = 'https://jfnccekkhffonkjkmxyf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_KJA4VzMAjt2WVEEg0JKMfg_lDrABAZK';

/**
 * Fetch all generated chord entries that have metadata (slug != null) from Supabase.
 * Uses Node 18+ built-in fetch — no npm dependencies.
 */
async function fetchGeneratedChords() {
    // Try fetching with full metadata columns first; fall back to basic columns
    const columns = 'video_id,title,artist,slug,chords,created_at,youtube_title';
    const url = `${SUPABASE_URL}/rest/v1/generated_chords?select=${columns}&slug=not.is.null&order=created_at.desc`;
    const headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
    };
    try {
        const resp = await fetch(url, { headers });
        if (resp.ok) {
            const data = await resp.json();
            console.log(`[Supabase] Fetched ${data.length} generated chord entries with metadata.`);
            return data;
        }
        // If 400 (columns don't exist yet), return empty — user needs to run schema migration
        if (resp.status === 400) {
            console.warn('[Supabase] Metadata columns not found — run the schema migration SQL first.');
            console.warn('[Supabase] Skipping AI chord page generation (0 entries with metadata).');
            return [];
        }
        console.warn(`[Supabase] Failed to fetch generated chords: HTTP ${resp.status}`);
        return [];
    } catch (err) {
        console.warn(`[Supabase] Error fetching generated chords: ${err.message}`);
        return [];
    }
}

/**
 * Deduplicate entries by slug — same song from different YouTube uploads
 * gets one canonical page. Picks the entry with most chord events (better analysis).
 */
function deduplicateBySlug(entries) {
    const SLUG_RE = /^[a-zA-Z0-9_-]+$/;
    const bySlug = {};
    for (const entry of entries) {
        if (!entry.slug || !SLUG_RE.test(entry.slug)) continue; // skip invalid slugs
        const chordCount = entry.chords?.chords?.length || 0;
        const existing = bySlug[entry.slug];
        if (!existing || chordCount > (existing.chords?.chords?.length || 0)) {
            bySlug[entry.slug] = entry;
        }
    }
    return Object.values(bySlug);
}

// ---------------------------------------------------------------------------
// Beginner mode utilities (keep in sync with js/chord-utils.js)
// ---------------------------------------------------------------------------
const B_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const B_FLAT_MAP = { 'Db': 'C#', 'Eb': 'D#', 'Fb': 'E', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#', 'Cb': 'B' };
const B_BEGINNER_CHORDS = new Set(['C','D','E','F','G','A','Am','Dm','Em','A7','B7','D7','E7','G7']);
const B_BEGINNER_7THS = new Set(['A7','B7','D7','E7','G7']);

function bTranspose(chord, semitones) {
    if (!chord || semitones === 0) return chord;
    if (chord.includes('/')) {
        const p = chord.split('/');
        return bTranspose(p[0], semitones) + '/' + bTranspose(p[1], semitones);
    }
    const m = chord.match(/^([A-G][#b]?)(.*)/);
    if (!m) return chord;
    let root = m[1];
    if (B_FLAT_MAP[root]) root = B_FLAT_MAP[root];
    const idx = B_NOTES.indexOf(root);
    if (idx < 0) return chord;
    return B_NOTES[((idx + semitones) % 12 + 12) % 12] + m[2];
}

function bSimplify(chord) {
    if (!chord) return chord;
    if (chord.includes('/')) chord = chord.split('/')[0];
    const m = chord.match(/^([A-G][#b]?)(.*)/);
    if (!m) return chord;
    let root = m[1], q = m[2];
    if (B_FLAT_MAP[root]) root = B_FLAT_MAP[root];
    if (q === '5') return root;
    if (/^m?1[13]/.test(q)) return root + (q.startsWith('m') ? 'm' : '');
    if (/m?.*9/.test(q)) return root + (q.startsWith('m') && !q.startsWith('maj') ? 'm' : '');
    if (q === '7sus4') return root;
    if (q === 'm7b5') return root + 'm';
    if (q === 'dim') return root + 'm';
    if (q === 'aug') return root;
    if (q === '6') return root;
    if (q === 'm6') return root + 'm';
    if (q === 'sus4' || q === 'sus2') return root;
    if (q === 'add2') return root;
    if (q === 'M7' || q === 'maj7') return root;
    if (q === 'm7') return root + 'm';
    if (q.startsWith('7')) return B_BEGINNER_7THS.has(root + '7') ? root + '7' : root;
    return root + q;
}

function bFindOptimalCapo(chordEvents) {
    if (!chordEvents || !chordEvents.length) return 0;
    const seen = new Set();
    for (const e of chordEvents) seen.add(bSimplify(e.chord));
    const unique = [...seen];
    let bestCapo = 0, bestScore = -1;
    for (let capo = 0; capo <= 7; capo++) {
        let score = 0;
        for (const c of unique) {
            if (B_BEGINNER_CHORDS.has(bTranspose(c, -capo))) score++;
        }
        if (score > bestScore) { bestScore = score; bestCapo = capo; }
    }
    return bestCapo;
}

function bComputeDifficulty(chordEvents, capo) {
    if (!chordEvents || !chordEvents.length) return 'easy';
    const seen = new Set();
    for (const e of chordEvents) {
        seen.add(bTranspose(bSimplify(e.chord), -capo));
    }
    const unique = [...seen];
    let bc = 0;
    for (const c of unique) { if (B_BEGINNER_CHORDS.has(c)) bc++; }
    const ratio = bc / unique.length;
    if (ratio >= 1) return 'easy';
    if (ratio >= 0.7) return 'moderate';
    return 'advanced';
}

function extractUniqueChords(chordsData) {
    const events = chordsData?.chords || [];
    const seen = new Set();
    const unique = [];
    for (const evt of events) {
        if (!seen.has(evt.chord)) {
            seen.add(evt.chord);
            unique.push(evt.chord);
        }
    }
    return unique;
}

/**
 * Extract YouTube video ID from a standard YouTube URL.
 */
function extractVideoIdFromEntry(entry) {
    return entry.video_id || '';
}

/**
 * Generate a static AI chord page at /chords/{slug}/index.html
 */
function generateChordsPage(entry, templates) {
    const { partials, chordsPage } = templates;
    const title = entry.title || 'Unknown Song';
    const artist = entry.artist || 'Unknown Artist';
    const slug = entry.slug;
    const videoId = extractVideoIdFromEntry(entry);
    const canonicalUrl = `${BASE_URL}/chords/${slug}/`;
    const chordCount = entry.chords?.chords?.length || 0;

    // Pre-compute beginner mode data for SEO
    const chordEvents = entry.chords?.chords || [];
    const beginnerCapo = bFindOptimalCapo(chordEvents);
    const beginnerDifficulty = bComputeDifficulty(chordEvents, beginnerCapo);
    const diffLabel = { easy: 'Easy', moderate: 'Moderate', advanced: 'Advanced' }[beginnerDifficulty] || 'Easy';

    const pageTitle = `${title} Chords | Swaram`;
    const pageDesc = `Free chords for ${title} by ${artist}. AI-detected chord progression with ${chordCount} chords. ${diffLabel} difficulty. Guitar and keyboard chord chart with video.`;
    const keywords = `${title} chords, ${artist} chords, guitar chords, keyboard chords, chord progression, AI chord detection`;

    // Structured data
    const sdObj = {
        "@context": "https://schema.org",
        "@type": "MusicComposition",
        "name": title,
        "composer": { "@type": "Person", "name": artist },
        "url": canonicalUrl,
        "description": pageDesc,
        "educationalLevel": { easy: 'Beginner', moderate: 'Intermediate', advanced: 'Advanced' }[beginnerDifficulty] || 'Beginner',
    };

    const breadcrumbObj = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            { "@type": "ListItem", "position": 1, "name": "Home", "item": `${BASE_URL}/` },
            { "@type": "ListItem", "position": 2, "name": "Chord Finder", "item": `${BASE_URL}/chord-finder.html` },
            { "@type": "ListItem", "position": 3, "name": `${title} Chords`, "item": canonicalUrl }
        ]
    };

    // VideoObject for YouTube embeds
    let videoSd = '';
    if (videoId) {
        const videoObj = {
            "@context": "https://schema.org",
            "@type": "VideoObject",
            "name": `${title} - AI-Detected Chords`,
            "description": `Watch and play along with AI-detected chords for ${title} by ${artist}. ${chordCount} chords detected.`,
            "thumbnailUrl": `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
            "embedUrl": `https://www.youtube.com/embed/${videoId}`,
            "uploadDate": entry.created_at ? entry.created_at.replace(/ /, 'T').replace(/\+00$/, '+00:00') : "2026-01-01T00:00:00+05:30",
            "publisher": { "@type": "Organization", "name": "Swaram", "url": `${BASE_URL}/` }
        };
        videoSd = '\n    </script>\n\n    <script type="application/ld+json">\n    ' + JSON.stringify(videoObj, null, 2);
    }

    const structuredData = JSON.stringify(sdObj, null, 2) +
        '\n    </script>\n\n    <script type="application/ld+json">\n    ' +
        JSON.stringify(breadcrumbObj, null, 2) + videoSd;

    // Meta bar — only chord count, no key/time since backend doesn't provide them
    const metaBar = `<span class="meta-pill"><span class="meta-label">Chords</span> ${chordCount} detected</span>`;

    // YouTube embed — controllable player container (not static iframe)
    const youtubeEmbed = videoId
        ? `<div id="youtube-player-container" class="youtube-player-container">
                    <div id="youtube-player"></div>
                </div>`
        : '';

    // Unique chords
    const uniqueChords = extractUniqueChords(entry.chords);
    const chordsUsedHtml = uniqueChords
        .map(c => `<span class="chord-badge" data-original="${escapeHtml(c)}">${escapeHtml(c)}</span>`)
        .join('\n                        ');

    // Chord data as JSON for client-side player
    const chordDataJson = JSON.stringify(entry.chords?.chords || []);

    // Assemble
    let page = chordsPage;
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
        .replace(/\{\{SONG_TITLE\}\}/g, escapeHtml(title))
        .replace(/\{\{ARTIST\}\}/g, escapeHtml(artist))
        .replace(/\{\{KEY\}\}/g, '')
        .replace('{{META_BAR}}', metaBar)
        .replace('{{CHORDS_USED}}', chordsUsedHtml)
        .replace('{{YOUTUBE_EMBED}}', youtubeEmbed)
        .replace(/\{\{VIDEO_ID\}\}/g, escapeHtml(videoId))
        .replace('{{CHORD_DATA_JSON}}', chordDataJson)
        .replace('{{BEGINNER_CAPO}}', String(beginnerCapo))
        .replace('{{BEGINNER_DIFFICULTY}}', beginnerDifficulty)
        .replace('{{STRUCTURED_DATA}}', structuredData);

    const outDir = path.join(ROOT, 'chords', slug);
    mkdirp(outDir);
    fs.writeFileSync(path.join(outDir, 'index.html'), page);
}

// ===== Main =====

async function main() {
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
            ...metadata,
            ...songMeta,
            fullTitle: metadata.title || songMeta.title,
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

    // Generate chord progression key pages
    const progressionKeys = generateProgressionPages(templates);
    console.log(`Generated ${progressionKeys.length} chord progression key pages.`);

    // Generate AI chord pages from Supabase
    let aiChordPages = [];
    try {
        const generatedChords = await fetchGeneratedChords();
        aiChordPages = deduplicateBySlug(generatedChords);
        for (const entry of aiChordPages) {
            generateChordsPage(entry, templates);
        }
        console.log(`Generated ${aiChordPages.length} AI chord pages (from ${generatedChords.length} Supabase entries).`);
    } catch (err) {
        console.warn(`[AI Chords] Skipped: ${err.message}`);
    }

    // Generate sitemap
    generateSitemap(songs, allCategories, allArtists, progressionKeys, aiChordPages);
    const totalUrls = 5 + songs.length * 2 + allCategories.length + allArtists.length + progressionKeys.length + aiChordPages.length;
    console.log(`Sitemap generated with ${totalUrls} URLs.`);

    generateRSSFeed(songs, aiChordPages);
    console.log(`RSS feed generated (feed.xml).`);
    await pingWebSub();

    // Pre-render songs.html
    generateSongsPage(songs, allCategories, allArtists);
    console.log('Pre-rendered songs.html with song cards, browse tags, and count.');

    // Pre-render homepage featured songs
    generateHomepageFeaturedSongs(songs);
    console.log(`Pre-rendered index.html with ${Math.min(songs.length, 3)} featured song cards.`);

    // Summary
    console.log('\n--- Build Summary ---');
    console.log(`Song pages:     ${songPagesCount}`);
    console.log(`Lyrics pages:   ${lyricsPagesCount}`);
    console.log(`Category pages: ${allCategories.length}`);
    console.log(`Artist pages:   ${allArtists.length}`);
    console.log(`Progression pages: ${progressionKeys.length}`);
    console.log(`AI chord pages: ${aiChordPages.length}`);
    console.log(`Sitemap URLs:   ${totalUrls}`);
    console.log('Build complete!');
}

main().catch(err => { console.error(err); process.exit(1); });
