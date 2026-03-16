// Song Chords Website - JavaScript
// Supabase Configuration
const SUPABASE_URL = 'https://jfnccekkhffonkjkmxyf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_KJA4VzMAjt2WVEEg0JKMfg_lDrABAZK';

// UPI Payment
const UPI_ID = '7306025928@upi';

// Load songs index
let songsList = [];
let songsData = {};

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    loadSongsIndex();
    
    // Check if we're on song detail page
    const urlParams = new URLSearchParams(window.location.search);
    const songFile = urlParams.get('file');
    if (songFile && document.getElementById('song-content')) {
        loadSong(songFile);
    }
    
    // Set up search if on songs page
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', handleSearch);
    }
});

// Load songs index.json
async function loadSongsIndex() {
    try {
        const response = await fetch('songs/index.json');
        songsList = await response.json();
        
        // Display songs if on songs page
        const songsGrid = document.getElementById('songs-grid');
        if (songsGrid) {
            displaySongs(songsList);
        }
        
        // Update song count
        const songCount = document.getElementById('song-count');
        if (songCount) {
            songCount.textContent = songsList.length;
        }
    } catch (error) {
        console.error('Error loading songs:', error);
    }
}

// Display songs in grid
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

// Search songs
function handleSearch(event) {
    const query = event.target.value.toLowerCase();
    const filtered = songsList.filter(song => 
        song.title.toLowerCase().includes(query) ||
        (song.artist && song.artist.toLowerCase().includes(query)) ||
        (song.category && song.category.toLowerCase().includes(query))
    );
    displaySongs(filtered);
}

// Load individual song
async function loadSong(file) {
    try {
        const response = await fetch('songs/' + file);
        if (!response.ok) {
            document.getElementById('song-content').innerHTML = '<p>Song not found. Please check back later.</p>';
            return;
        }
        let content = await response.text();
        
        // Parse frontmatter
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        let metadata = {};
        
        if (frontmatterMatch) {
            // Parse YAML-like frontmatter
            const frontmatter = frontmatterMatch[1];
            content = frontmatterMatch[2];
            
            frontmatter.split('\n').forEach(line => {
                const [key, ...valueParts] = line.split(':');
                if (key && valueParts.length) {
                    metadata[key.trim()] = valueParts.join(':').trim();
                }
            });
        }
        
        // Update page title
        if (metadata.title) {
            document.getElementById('song-title').textContent = metadata.title;
            document.title = metadata.title + ' - Chord Chords';
        }
        
        // Update artist
        if (metadata.artist) {
            document.getElementById('song-artist').textContent = metadata.artist;
        }
        
        // Format and display content
        const formattedContent = formatChordContent(content);
        document.getElementById('song-content').innerHTML = formattedContent;
        
        // YouTube embed
        if (metadata.youtube) {
            const videoId = extractYouTubeId(metadata.youtube);
            if (videoId) {
                document.getElementById('youtube-embed').innerHTML = `
                    <iframe width="100%" height="315" 
                        src="https://www.youtube.com/embed/${videoId}" 
                        frameborder="0" allowfullscreen>
                    </iframe>
                `;
            }
        }
        
    } catch (error) {
        console.error('Error loading song:', error);
        document.getElementById('song-content').innerHTML = '<p>Error loading song. Please try again.</p>';
    }
}

// Format chord content nicely - handles user's format
function formatChordContent(content) {
    let html = '';
    const lines = content.split('\n');
    let inSection = false;
    let currentSectionTitle = '';
    
    lines.forEach(line => {
        line = line.trim();
        
        if (!line) {
            html += '<br>';
            return;
        }
        
        // Main section header (# Title)
        if (line.startsWith('# ')) {
            html += `<h2>${line.substring(2)}</h2>`;
            return;
        }
        
        // Subsection header (## Title)
        if (line.startsWith('## ')) {
            html += `<h3>${line.substring(3)}</h3>`;
            return;
        }
        
        // Subsection header (### Title)
        if (line.startsWith('### ')) {
            html += `<h4>${line.substring(4)}</h4>`;
            return;
        }
        
        // Chord progression pattern: || C | C | Am | Am ||
        if (line.startsWith('||') && line.endsWith('||')) {
            // Remove || and split by |
            const chordsLine = line.replace(/^\|\||\|\|$/g, '').trim();
            const chords = chordsLine.split('|').map(c => c.trim()).filter(c => c);
            
            if (chords.length > 0) {
                html += '<div class="chord-progression">';
                html += '<div class="chord-line">';
                chords.forEach(chord => {
                    html += `<span class="chord">${chord}</span>`;
                });
                html += '</div></div>';
            }
            return;
        }
        
        // Regular lyrics/text
        html += `<p>${line}</p>`;
    });
    
    return html;
}

// Extract YouTube video ID
function extractYouTubeId(url) {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
    return match ? match[1] : null;
}

// Copy chords to clipboard
function copyChords() {
    const songContent = document.getElementById('song-content');
    const text = songContent.innerText;
    navigator.clipboard.writeText(text).then(() => {
        alert('Chords copied to clipboard!');
    });
}

// Open UPI payment
function openUPI() {
    const upiLink = `upi://pay?pa=${UPI_ID}&pn=Malayalam%20Chord%20Chords`;
    window.open(upiLink, '_blank');
}
