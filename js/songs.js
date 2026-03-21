// Swaram - Song Chords Website
const UPI_ID = '7306025928@upi';
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_MAP = { 'Db': 'C#', 'Eb': 'D#', 'Fb': 'E', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#', 'Cb': 'B' };

let songsList = [];
let currentTranspose = 0;
let originalKey = '';
let autoScrollInterval = null;
let autoScrollSpeed = 1.5;
let searchQuery = '';
let activeCategory = '';
let activeKey = '';
let activeSort = 'default';

document.addEventListener('DOMContentLoaded', function () {
    loadSongsIndex();

    const songContent = document.getElementById('song-content');
    const isStaticPage = songContent && songContent.hasAttribute('data-static');

    if (isStaticPage) {
        // Pre-rendered static page: setup interactive features only
        originalKey = songContent.getAttribute('data-original-key') || 'C';
        currentTranspose = 0;
        setupTransposeControls();
    } else {
        const urlParams = new URLSearchParams(window.location.search);
        const songFile = urlParams.get('file');
        if (songFile && songContent) {
            loadSong(songFile);
        }
    }

    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', handleSearch);
    }
});

async function loadSongsIndex() {
    try {
        const response = await fetch('/songs/index.json');
        songsList = await response.json();

        const songsGrid = document.getElementById('songs-grid');
        if (songsGrid) {
            populateFilters(songsList);
            applyFilters();
        }

        const songCount = document.getElementById('song-count');
        if (songCount) {
            songCount.textContent = songsList.length;
        }

        // Populate browse-by-category and browse-by-artist tags
        populateBrowseTags(songsList);
    } catch (error) {
        console.error('Error loading songs:', error);
    }
}

function displaySongs(songs) {
    const songsGrid = document.getElementById('songs-grid');
    if (!songsGrid) return;

    songsGrid.innerHTML = '';
    songs.forEach(song => {
        const card = document.createElement('div');
        card.className = 'song-card';
        const titleMl = song.title_ml || '';
        const artistMl = song.artist_ml || '';
        card.innerHTML = `
            <h3><span class="lang-en">${song.title}</span>${titleMl ? `<span class="lang-ml">${titleMl}</span>` : ''}</h3>
            <p class="artist"><span class="lang-en">${song.artist || 'Unknown Artist'}</span>${artistMl ? `<span class="lang-ml">${artistMl}</span>` : ''}</p>
            <div class="song-card-meta">
                <span class="meta-badge">${song.category || 'General'}</span>
                ${song.key ? `<span class="meta-badge meta-key">Key: ${song.key}</span>` : ''}
                ${song.time ? `<span class="meta-badge meta-time">${song.time}</span>` : ''}
            </div>
            <div class="song-card-actions">
                <a href="/songs/${song.id}/" class="btn" data-i18n="view_chords_btn">View Chords</a>
                <a href="/lyrics/${song.id}/" class="btn btn-secondary" data-i18n="lyrics_btn">Lyrics</a>
            </div>
        `;
        songsGrid.appendChild(card);
    });
}

function handleSearch(event) {
    searchQuery = event.target.value.toLowerCase();
    applyFilters();
}

function populateFilters(songs) {
    const chipsContainer = document.getElementById('category-chips');
    const keyFilter = document.getElementById('key-filter');
    const sortSelect = document.getElementById('sort-select');
    if (!chipsContainer) return;

    // Category chips
    const categories = [...new Set(songs.map(s => s.category).filter(Boolean))];
    chipsContainer.innerHTML = '';

    const allChip = document.createElement('span');
    allChip.className = 'filter-chip active';
    allChip.textContent = 'All';
    allChip.setAttribute('data-i18n', 'filter_all');
    allChip.addEventListener('click', () => {
        activeCategory = '';
        chipsContainer.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        allChip.classList.add('active');
        applyFilters();
    });
    chipsContainer.appendChild(allChip);

    categories.forEach(cat => {
        const chip = document.createElement('span');
        chip.className = 'filter-chip';
        chip.textContent = cat;
        chip.addEventListener('click', () => {
            activeCategory = cat;
            chipsContainer.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            applyFilters();
        });
        chipsContainer.appendChild(chip);
    });

    // Key dropdown
    if (keyFilter) {
        const keys = [...new Set(songs.map(s => s.key).filter(Boolean))].sort();
        keys.forEach(key => {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = key;
            keyFilter.appendChild(opt);
        });
        keyFilter.addEventListener('change', () => {
            activeKey = keyFilter.value;
            applyFilters();
        });
    }

    // Sort dropdown
    if (sortSelect) {
        sortSelect.addEventListener('change', () => {
            activeSort = sortSelect.value;
            applyFilters();
        });
    }

    // Show filter bar now that it's populated
    const filterBar = document.getElementById('filter-bar');
    if (filterBar) filterBar.style.display = '';
}

function applyFilters() {
    let result = [...songsList];

    // Category filter
    if (activeCategory) {
        result = result.filter(s => s.category === activeCategory);
    }

    // Key filter
    if (activeKey) {
        result = result.filter(s => s.key === activeKey);
    }

    // Text search
    if (searchQuery) {
        result = result.filter(s =>
            s.title.toLowerCase().includes(searchQuery) ||
            (s.title_ml && s.title_ml.includes(searchQuery)) ||
            (s.artist && s.artist.toLowerCase().includes(searchQuery)) ||
            (s.artist_ml && s.artist_ml.includes(searchQuery)) ||
            (s.category && s.category.toLowerCase().includes(searchQuery)) ||
            (s.category_ml && s.category_ml.includes(searchQuery))
        );
    }

    // Sort
    if (activeSort === 'title-asc') {
        result.sort((a, b) => a.title.localeCompare(b.title));
    } else if (activeSort === 'title-desc') {
        result.sort((a, b) => b.title.localeCompare(a.title));
    } else if (activeSort === 'artist-asc') {
        result.sort((a, b) => (a.artist || '').localeCompare(b.artist || ''));
    }

    displaySongs(result);

    // Update count and no-results
    const songCount = document.getElementById('song-count');
    if (songCount) songCount.textContent = result.length;

    const noResults = document.getElementById('no-results');
    if (noResults) noResults.style.display = result.length === 0 ? 'block' : 'none';
}

async function loadSong(file) {
    try {
        const response = await fetch('/songs/' + file);
        if (!response.ok) {
            document.getElementById('song-content').innerHTML = '<p>Song not found. Please check back later or <a href="request.html">request this song</a>.</p>';
            return;
        }
        let content = await response.text();
        content = content.replace(/\r\n/g, '\n');
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        let metadata = {};

        if (frontmatterMatch) {
            const frontmatter = frontmatterMatch[1];
            content = frontmatterMatch[2];
            frontmatter.split('\n').forEach(line => {
                const [key, ...valueParts] = line.split(':');
                if (key && valueParts.length) {
                    metadata[key.trim()] = valueParts.join(':').trim();
                }
            });
        }

        originalKey = metadata.key || 'C';
        currentTranspose = 0;

        // Update page title and SEO meta tags dynamically
        if (metadata.title) {
            const songTitle = metadata.title;
            const artist = metadata.artist || 'Traditional';
            const category = metadata.category || '';
            const pageTitle = `${songTitle} Chords for Keyboard & Guitar - ${artist} | Swaram`;
            const pageDesc = `Free ${songTitle} keyboard and guitar chord chart. ${artist} - Malayalam Christian ${category ? category + ' ' : ''}song with chord progression, lyrics, and video tutorial.`;
            const pageUrl = `https://ecoliving-tips.github.io/songs/${file.replace('.md', '')}/`;

            document.getElementById('song-title').textContent = songTitle;
            document.title = pageTitle;

            const metaDesc = document.getElementById('meta-description');
            if (metaDesc) metaDesc.setAttribute('content', pageDesc);
            const metaKeywords = document.querySelector('meta[name="keywords"]');
            if (metaKeywords) metaKeywords.setAttribute('content', `${songTitle} chords, ${songTitle} keyboard chords, ${songTitle} guitar chords, ${artist} chords, Malayalam Christian song chords, ${category} song chords`);
            const ogTitle = document.getElementById('og-title');
            if (ogTitle) ogTitle.setAttribute('content', pageTitle);
            const ogDesc = document.getElementById('og-description');
            if (ogDesc) ogDesc.setAttribute('content', pageDesc);
            const ogUrl = document.getElementById('og-url');
            if (ogUrl) ogUrl.setAttribute('content', pageUrl);
            const canonicalUrl = document.getElementById('canonical-url');
            if (canonicalUrl) canonicalUrl.setAttribute('href', pageUrl);
            const twTitle = document.getElementById('twitter-title');
            if (twTitle) twTitle.setAttribute('content', pageTitle);
            const twDesc = document.getElementById('twitter-description');
            if (twDesc) twDesc.setAttribute('content', pageDesc);

            const structuredData = document.getElementById('song-structured-data');
            if (structuredData) {
                structuredData.textContent = JSON.stringify({
                    "@context": "https://schema.org",
                    "@type": "MusicComposition",
                    "name": songTitle,
                    "composer": { "@type": "Person", "name": artist },
                    "musicalKey": metadata.key || 'C',
                    "url": pageUrl,
                    "description": pageDesc,
                    "isPartOf": {
                        "@type": "WebSite",
                        "name": "Swaram",
                        "url": "https://ecoliving-tips.github.io/"
                    }
                });
            }
        }

        if (metadata.artist) {
            document.getElementById('song-artist').textContent = metadata.artist;
        }

        // Render metadata bar
        renderMetadataBar(metadata);

        // Render song content
        document.getElementById('song-content').innerHTML = formatChordContent(content);

        // Setup transpose controls
        setupTransposeControls();

        if (metadata.youtube) {
            const videoId = extractYouTubeId(metadata.youtube);
            if (videoId) {
                document.getElementById('youtube-embed').innerHTML = `
                    <iframe width="100%" height="315"
                        src="https://www.youtube.com/embed/${videoId}"
                        frameborder="0" allowfullscreen loading="lazy"
                        title="${metadata.title || 'Song'} - Video Tutorial">
                    </iframe>
                `;
            }
        }
    } catch (error) {
        console.error('Error loading song:', error);
        document.getElementById('song-content').innerHTML = '<p>Error loading song. Please try again or <a href="songs.html">browse all songs</a>.</p>';
    }
}

function renderMetadataBar(metadata) {
    const bar = document.getElementById('song-meta-bar');
    if (!bar) return;

    bar.innerHTML = '';
    if (metadata.key) {
        bar.innerHTML += `<span class="meta-pill meta-pill-key"><span class="meta-label">Key</span> <span id="current-key">${metadata.key}</span></span>`;
    }
    if (metadata.time) {
        bar.innerHTML += `<span class="meta-pill meta-pill-time"><span class="meta-label">Time</span> ${metadata.time}</span>`;
    }
    if (metadata.category) {
        bar.innerHTML += `<span class="meta-pill"><span class="meta-label">Genre</span> ${metadata.category}</span>`;
    }
}

// ===== Chord Content Parser =====

function formatChordContent(content) {
    let html = '';
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Empty line = spacing
        if (!line) {
            html += '<div class="song-spacer"></div>';
            continue;
        }

        // Section header: {Verse 1}, {Chorus}, etc.
        const sectionMatch = line.match(/^\{(.+)\}$/);
        if (sectionMatch) {
            html += `<h3 class="section-label">${sectionMatch[1]}</h3>`;
            continue;
        }

        // Legacy markdown headings (backwards compat)
        if (line.startsWith('# ')) { continue; } // skip song title (already in header)
        if (line.startsWith('## ')) { continue; } // skip "Chord Progression" etc.
        if (line.startsWith('### ')) {
            html += `<h3 class="section-label">${line.substring(4)}</h3>`;
            continue;
        }

        // Chord-only progression: || C | Am | G ||
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
                            html += `<span class="chord" data-original="${chord}">${chord}</span>`;
                        });
                        html += '</span>';
                    } else {
                        html += `<span class="chord" data-original="${bar}">${bar}</span>`;
                    }
                });
                html += '</div></div>';
            }
            continue;
        }

        // Chord+lyric line: [C]Anna pesa[Am]ha
        if (line.includes('[') && line.includes(']')) {
            html += parseChordLyricLine(line);
            continue;
        }

        // Plain lyric line
        html += `<div class="lyric-only-line">${line}</div>`;
    }

    return html;
}

function parseChordLyricLine(line) {
    let html = '<div class="chord-lyric-line">';
    const regex = /\[([^\]]+)\]([^\[]*)/g;
    let match;

    // Text before first chord
    const firstBracket = line.indexOf('[');
    if (firstBracket > 0) {
        const textBefore = line.substring(0, firstBracket);
        if (textBefore.trim()) {
            html += `<span class="chord-lyric-pair"><span class="chord-name empty"></span><span class="lyric-text">${textBefore}</span></span>`;
        }
    }

    while ((match = regex.exec(line)) !== null) {
        const chord = match[1];
        const text = match[2];
        html += `<span class="chord-lyric-pair"><span class="chord-name" data-original="${chord}">${chord}</span><span class="lyric-text">${text || '&nbsp;'}</span></span>`;
    }

    html += '</div>';
    return html;
}

// ===== Transpose =====

function setupTransposeControls() {
    const transposeDown = document.getElementById('transpose-down');
    const transposeUp = document.getElementById('transpose-up');
    const transposeReset = document.getElementById('transpose-reset');

    if (!transposeDown) return;

    transposeDown.addEventListener('click', () => doTranspose(-1));
    transposeUp.addEventListener('click', () => doTranspose(1));
    transposeReset.addEventListener('click', () => {
        currentTranspose = 0;
        applyTranspose();
    });
}

function doTranspose(delta) {
    currentTranspose = ((currentTranspose + delta) % 12 + 12) % 12;
    applyTranspose();
}

function applyTranspose() {
    // Update all chord elements
    document.querySelectorAll('[data-original]').forEach(el => {
        const original = el.getAttribute('data-original');
        el.textContent = transposeChord(original, currentTranspose);
    });

    // Update key display
    const keyEl = document.getElementById('current-key');
    if (keyEl) {
        keyEl.textContent = transposeChord(originalKey, currentTranspose);
    }

    // Update transpose indicator
    const transposeValue = document.getElementById('transpose-value');
    if (transposeValue) {
        const display = currentTranspose === 0 ? '0' : (currentTranspose <= 6 ? `+${currentTranspose}` : `${currentTranspose - 12}`);
        transposeValue.textContent = display;
    }
}

function transposeChord(chord, semitones) {
    if (semitones === 0) return chord;

    // Handle slash chords like Am/E
    if (chord.includes('/')) {
        const parts = chord.split('/');
        return transposeChord(parts[0], semitones) + '/' + transposeChord(parts[1], semitones);
    }

    // Handle dot notation like Am.E
    if (chord.includes('.')) {
        const parts = chord.split('.');
        return transposeChord(parts[0], semitones) + '/' + transposeChord(parts[1], semitones);
    }

    // Extract root note and quality
    const match = chord.match(/^([A-G][#b]?)(.*)/);
    if (!match) return chord;

    let root = match[1];
    const quality = match[2]; // m, 7, sus4, dim, aug, etc.

    // Normalize flats to sharps
    if (FLAT_MAP[root]) root = FLAT_MAP[root];

    const rootIndex = NOTES.indexOf(root);
    if (rootIndex === -1) return chord;

    const newIndex = (rootIndex + semitones + 12) % 12;
    return NOTES[newIndex] + quality;
}

// ===== Auto-Scroll =====

function toggleAutoScroll() {
    const btn = document.getElementById('auto-scroll-btn');
    const controls = document.getElementById('scroll-speed-controls');

    if (autoScrollInterval) {
        clearInterval(autoScrollInterval);
        autoScrollInterval = null;
        btn.textContent = 'Auto Scroll';
        btn.classList.remove('active');
        if (controls) controls.classList.remove('visible');
    } else {
        autoScrollInterval = setInterval(() => {
            window.scrollBy({ top: autoScrollSpeed, behavior: 'auto' });
            // Stop at bottom
            if ((window.innerHeight + window.scrollY) >= document.body.scrollHeight - 10) {
                toggleAutoScroll();
            }
        }, 30);
        btn.textContent = 'Stop Scroll';
        btn.classList.add('active');
        if (controls) controls.classList.add('visible');
    }
}

function setScrollSpeed(speed, el) {
    autoScrollSpeed = speed;
    document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');
}

// ===== Utilities =====

function extractYouTubeId(url) {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
    return match ? match[1] : null;
}

function openUPI() {
    window.open(`upi://pay?pa=${UPI_ID}&pn=Swaram`, '_blank');
}

function slugify(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function populateBrowseTags(songs) {
    const categoryContainer = document.getElementById('category-tags');
    const artistContainer = document.getElementById('artist-tags');
    if (!categoryContainer && !artistContainer) return;

    const categories = new Set();
    const artists = new Set();
    songs.forEach(s => {
        if (s.category) categories.add(s.category);
        if (s.artist) artists.add(s.artist);
    });

    if (categoryContainer) {
        categoryContainer.innerHTML = [...categories].map(c =>
            `<a href="/category/${slugify(c)}/" class="browse-tag">${c}</a>`
        ).join('');
    }
    if (artistContainer) {
        artistContainer.innerHTML = [...artists].map(a =>
            `<a href="/artist/${slugify(a)}/" class="browse-tag">${a}</a>`
        ).join('');
    }
}
