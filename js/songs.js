// Song Chords Website - JavaScript
const UPI_ID = '7306025928@upi';

let songsList = [];

document.addEventListener('DOMContentLoaded', function() {
    loadSongsIndex();

    const urlParams = new URLSearchParams(window.location.search);
    const songFile = urlParams.get('file');
    if (songFile && document.getElementById('song-content')) {
        loadSong(songFile);
    }

    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', handleSearch);
    }
});

async function loadSongsIndex() {
    try {
        const response = await fetch('songs/index.json');
        songsList = await response.json();

        const songsGrid = document.getElementById('songs-grid');
        if (songsGrid) {
            displaySongs(songsList);
        }

        const songCount = document.getElementById('song-count');
        if (songCount) {
            songCount.textContent = songsList.length;
        }
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
        card.innerHTML = `
            <h3>${song.title}</h3>
            <p class="artist">${song.artist || 'Unknown Artist'}</p>
            <p class="category">${song.category || 'General'}</p>
            <a href="song.html?file=${song.file}" class="btn">View Chords</a>
        `;
        songsGrid.appendChild(card);
    });
}

function handleSearch(event) {
    const query = event.target.value.toLowerCase();
    const filtered = songsList.filter(song =>
        song.title.toLowerCase().includes(query) ||
        (song.artist && song.artist.toLowerCase().includes(query)) ||
        (song.category && song.category.toLowerCase().includes(query))
    );
    displaySongs(filtered);
}

async function loadSong(file) {
    try {
        const response = await fetch('songs/' + file);
        if (!response.ok) {
            document.getElementById('song-content').innerHTML = '<p>Song not found. Please check back later or <a href="request.html">request this song</a>.</p>';
            return;
        }
        let content = await response.text();
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

        // Update page title and SEO meta tags dynamically
        if (metadata.title) {
            const songTitle = metadata.title;
            const artist = metadata.artist || 'Traditional';
            const pageTitle = `${songTitle} Chords - ${artist} | Swaram`;
            const pageDesc = `Free ${songTitle} chord chart for keyboard and guitar. ${artist} - Malayalam Christian devotional song chord progression with easy notation.`;
            const pageUrl = `https://ecoliving-tips.github.io/song.html?file=${file}`;

            document.getElementById('song-title').textContent = songTitle;
            document.title = pageTitle;

            // Update meta description
            const metaDesc = document.getElementById('meta-description');
            if (metaDesc) metaDesc.setAttribute('content', pageDesc);

            // Update Open Graph
            const ogTitle = document.getElementById('og-title');
            if (ogTitle) ogTitle.setAttribute('content', pageTitle);
            const ogDesc = document.getElementById('og-description');
            if (ogDesc) ogDesc.setAttribute('content', pageDesc);
            const ogUrl = document.getElementById('og-url');
            if (ogUrl) ogUrl.setAttribute('content', pageUrl);

            // Update Twitter
            const twTitle = document.getElementById('twitter-title');
            if (twTitle) twTitle.setAttribute('content', pageTitle);
            const twDesc = document.getElementById('twitter-description');
            if (twDesc) twDesc.setAttribute('content', pageDesc);

            // Update structured data
            const structuredData = document.getElementById('song-structured-data');
            if (structuredData) {
                structuredData.textContent = JSON.stringify({
                    "@context": "https://schema.org",
                    "@type": "MusicComposition",
                    "name": songTitle,
                    "composer": { "@type": "Person", "name": artist },
                    "musicalKey": "C",
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

        document.getElementById('song-content').innerHTML = formatChordContent(content);

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

function formatChordContent(content) {
    let html = '';
    const lines = content.split('\n');

    lines.forEach(line => {
        line = line.trim();
        if (!line) { html += '<br>'; return; }
        if (line.startsWith('# ')) { html += `<h2>${line.substring(2)}</h2>`; return; }
        if (line.startsWith('## ')) { html += `<h3>${line.substring(3)}</h3>`; return; }
        if (line.startsWith('### ')) { html += `<h4>${line.substring(4)}</h4>`; return; }

        if (line.startsWith('||') && line.endsWith('||')) {
            const chordsLine = line.replace(/^\|\||\|\|$/g, '').trim();
            const chords = chordsLine.split('|').map(c => c.trim()).filter(c => c);
            if (chords.length > 0) {
                html += '<div class="chord-progression"><div class="chord-line">';
                chords.forEach(chord => { html += `<span class="chord">${chord}</span>`; });
                html += '</div></div>';
            }
            return;
        }

        html += `<p>${line}</p>`;
    });

    return html;
}

function extractYouTubeId(url) {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
    return match ? match[1] : null;
}

function copyChords() {
    const songContent = document.getElementById('song-content');
    const text = songContent.innerText;
    navigator.clipboard.writeText(text).then(() => {
        showToast('Chords copied to clipboard!');
    });
}

function showToast(message) {
    let toast = document.querySelector('.copy-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'copy-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
}

function openUPI() {
    window.open(`upi://pay?pa=${UPI_ID}&pn=Swaram`, '_blank');
}
