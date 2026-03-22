/**
 * Swaram Chord Generator — js/generate.js
 *
 * Handles: YouTube URL parsing, audio extraction (Piped/Invidious fallback),
 * file upload, Supabase caching, backend API calls, chord display, YouTube
 * playback sync, transpose, and sharing.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const API_ENDPOINT = 'https://vineethwilson-swaram-chord-service.hf.space/analyze';
const SUPABASE_URL = 'https://jfnccekkhffonkjkmxyf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_KJA4VzMAjt2WVEEg0JKMfg_lDrABAZK';
const MAX_FILE_SIZE = 30 * 1024 * 1024; // 30 MB
const API_TIMEOUT_MS = 300_000; // 5 minutes
const USE_MOCK_DATA = false;

// Piped API instances for YouTube audio extraction (tried in order)
const PIPED_INSTANCES = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.r4fo.com',
    'https://pipedapi.adminforge.de',
    'https://api.piped.projectsegfau.lt',
];

// Invidious API instances (fallback)
const INVIDIOUS_INSTANCES = [
    'https://inv.nadeko.net',
    'https://invidious.privacyredirect.com',
    'https://invidious.nerdvpn.de',
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let chordData = null;        // Full response from backend
let currentTranspose = 0;
let selectedFile = null;     // Uploaded File object
let syncInterval = null;     // setInterval ID for chord sync
let ytPlayer = null;         // YouTube IFrame player
let audioPlayer = null;      // HTML5 Audio element
let audioObjectUrl = null;   // Blob URL for uploaded file
let supabaseClient = null;   // Supabase client instance
let currentVideoId = null;
let serverWarm = false;      // Whether the HF Space is awake

// Note and chord constants (matching songs.js)
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_MAP = { 'Db': 'C#', 'Eb': 'D#', 'Fb': 'E', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#', 'Cb': 'B' };

// ---------------------------------------------------------------------------
// i18n helper (safe access before i18n.js loads)
// ---------------------------------------------------------------------------
function t(key) {
    try {
        if (typeof translations !== 'undefined' && typeof currentLang !== 'undefined') {
            return translations[currentLang]?.[key] || key;
        }
    } catch { /* ignore */ }
    return key;
}

// ---------------------------------------------------------------------------
// Mock data for testing (removed when backend is deployed)
// ---------------------------------------------------------------------------
const MOCK_CHORD_DATA = {
    video_id: 'mock_test',
    key: 'Am',
    bpm: 120,
    time_signature: '4/4',
    chords: [
        { time: 0.0, duration: 2.0, chord: 'Am' },
        { time: 2.0, duration: 2.0, chord: 'F' },
        { time: 4.0, duration: 2.0, chord: 'C' },
        { time: 6.0, duration: 2.0, chord: 'G' },
        { time: 8.0, duration: 2.0, chord: 'Am' },
        { time: 10.0, duration: 2.0, chord: 'F' },
        { time: 12.0, duration: 2.0, chord: 'C' },
        { time: 14.0, duration: 2.0, chord: 'G' },
        { time: 16.0, duration: 4.0, chord: 'Dm' },
        { time: 20.0, duration: 4.0, chord: 'E7' },
        { time: 24.0, duration: 2.0, chord: 'Am' },
        { time: 26.0, duration: 2.0, chord: 'G' },
        { time: 28.0, duration: 4.0, chord: 'F' },
        { time: 32.0, duration: 2.0, chord: 'C' },
        { time: 34.0, duration: 2.0, chord: 'G' },
        { time: 36.0, duration: 4.0, chord: 'Am' },
    ],
    processing_time_ms: 1200,
};

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', function () {
    initSupabase();
    setupEventListeners();
    warmUpServer();
    checkUrlParams();
});

function initSupabase() {
    try {
        if (typeof window.supabase !== 'undefined') {
            supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        }
    } catch (e) {
        console.warn('Supabase init failed:', e);
    }
}

/**
 * Fire-and-forget ping to wake up the HF Space container.
 * Any response (even 404/405) means the container is alive.
 */
function warmUpServer() {
    const baseUrl = API_ENDPOINT.replace(/\/analyze$/, '');
    fetch(baseUrl + '/health', { method: 'GET', mode: 'no-cors' })
        .then(() => { serverWarm = true; })
        .catch(() => { /* ignore — container may still be booting */ });
}

function setupEventListeners() {
    // Generate button
    const genBtn = document.getElementById('generate-btn');
    if (genBtn) genBtn.addEventListener('click', handleGenerate);

    // File upload — drag & drop
    const uploadArea = document.getElementById('upload-area');
    if (uploadArea) {
        uploadArea.addEventListener('click', () => document.getElementById('file-input')?.click());
        uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
        uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
        uploadArea.addEventListener('drop', handleFileDrop);
    }

    // File input change
    const fileInput = document.getElementById('file-input');
    if (fileInput) fileInput.addEventListener('change', handleFileSelect);

    // File remove
    const removeBtn = document.getElementById('file-remove');
    if (removeBtn) removeBtn.addEventListener('click', clearSelectedFile);

    // Transpose controls
    document.getElementById('transpose-up')?.addEventListener('click', () => applyTranspose(1));
    document.getElementById('transpose-down')?.addEventListener('click', () => applyTranspose(-1));
    document.getElementById('transpose-reset')?.addEventListener('click', () => applyTranspose(-currentTranspose));

    // Audio player controls
    const playBtn = document.getElementById('audio-play-btn');
    if (playBtn) playBtn.addEventListener('click', toggleAudioPlayback);

    const seekBar = document.getElementById('audio-seek');
    if (seekBar) seekBar.addEventListener('input', handleAudioSeek);
}

function checkUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const videoId = params.get('v');
    if (videoId) {
        document.getElementById('youtube-url').value = `https://www.youtube.com/watch?v=${videoId}`;
        // Auto-trigger if cache might have results
        handleGenerate();
    }
}

// ---------------------------------------------------------------------------
// File handling
// ---------------------------------------------------------------------------
function handleFileDrop(e) {
    e.preventDefault();
    document.getElementById('upload-area')?.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) setSelectedFile(file);
}

function handleFileSelect(e) {
    const file = e.target?.files?.[0];
    if (file) setSelectedFile(file);
}

function setSelectedFile(file) {
    if (file.size > MAX_FILE_SIZE) {
        showError(t('gen_error_file_size') || `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max: 30MB.`);
        return;
    }
    selectedFile = file;
    const nameEl = document.getElementById('file-name');
    const selectedEl = document.getElementById('selected-file');
    if (nameEl) nameEl.textContent = file.name;
    if (selectedEl) selectedEl.style.display = 'flex';
    document.getElementById('upload-area').style.display = 'none';
}

function clearSelectedFile() {
    selectedFile = null;
    const selectedEl = document.getElementById('selected-file');
    if (selectedEl) selectedEl.style.display = 'none';
    document.getElementById('upload-area').style.display = '';
    const fileInput = document.getElementById('file-input');
    if (fileInput) fileInput.value = '';
}

// ---------------------------------------------------------------------------
// YouTube URL parsing
// ---------------------------------------------------------------------------
function extractVideoId(url) {
    if (!url) return null;
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
        /^([a-zA-Z0-9_-]{11})$/,
    ];
    for (const p of patterns) {
        const m = url.match(p);
        if (m) return m[1];
    }
    return null;
}

// ---------------------------------------------------------------------------
// Main generate flow
// ---------------------------------------------------------------------------
async function handleGenerate() {
    const urlInput = document.getElementById('youtube-url')?.value?.trim();
    const videoId = extractVideoId(urlInput);

    // Must have either a YouTube URL or an uploaded file
    if (!videoId && !selectedFile) {
        showError(t('gen_error_no_input') || 'Please enter a YouTube URL or upload an audio file.');
        return;
    }

    currentVideoId = videoId;

    // Reset UI
    hideError();
    hideResults();
    showProgress();
    disableGenerateBtn(true);

    try {
        // Step 1: Check Supabase cache
        setProgressStep('cache');
        if (videoId) {
            const cached = await checkCache(videoId);
            if (cached) {
                chordData = cached;
                currentTranspose = 0;
                setProgressStep('done');
                await showResults(videoId);
                return;
            }
        }

        // Step 2: Get audio blob (extract from YouTube or use uploaded file)
        setProgressStep('extract');
        let audioBlob = null;

        if (selectedFile) {
            // User uploaded a file directly
            audioBlob = selectedFile;
        } else if (videoId) {
            // Try extracting audio from YouTube via proxy APIs
            audioBlob = await extractYouTubeAudio(videoId);

            if (!audioBlob) {
                // All extraction methods failed — show file upload prompt
                hideProgress();
                disableGenerateBtn(false);
                showExtractionFailed();
                return;
            }
        }

        // Step 3: Send to backend for analysis
        setProgressStep('analyze');

        let result;
        // Show warmup hint after 15s if server wasn't already warm
        let warmupTimer = null;
        if (!serverWarm) {
            warmupTimer = setTimeout(() => {
                const hint = document.getElementById('warmup-hint');
                if (hint) hint.style.display = '';
            }, 15000);
        }

        try {
            if (USE_MOCK_DATA) {
                await delay(1500);
                result = { ...MOCK_CHORD_DATA, video_id: videoId || 'upload' };
            } else {
                result = await callBackendAPI(audioBlob, videoId);
            }
            serverWarm = true;
        } finally {
            if (warmupTimer) clearTimeout(warmupTimer);
            const hint = document.getElementById('warmup-hint');
            if (hint) hint.style.display = 'none';
        }

        chordData = result;
        currentTranspose = 0;

        // Step 4: Cache the result
        if (videoId && supabaseClient) {
            await saveToCache(videoId, result);
        }

        setProgressStep('done');
        await showResults(videoId);

    } catch (err) {
        console.error('Generate failed:', err);
        hideProgress();
        showError(err.message || 'An error occurred while generating chords.');
    } finally {
        disableGenerateBtn(false);
    }
}

// ---------------------------------------------------------------------------
// YouTube audio extraction (client-side via proxy APIs)
// ---------------------------------------------------------------------------
async function extractYouTubeAudio(videoId) {
    // Try Piped instances first
    for (const instance of PIPED_INSTANCES) {
        try {
            const audioBlob = await tryPipedExtraction(instance, videoId);
            if (audioBlob) return audioBlob;
        } catch (e) {
            console.warn(`Piped ${instance} failed:`, e.message);
        }
    }

    // Try Invidious instances
    for (const instance of INVIDIOUS_INSTANCES) {
        try {
            const audioBlob = await tryInvidiousExtraction(instance, videoId);
            if (audioBlob) return audioBlob;
        } catch (e) {
            console.warn(`Invidious ${instance} failed:`, e.message);
        }
    }

    return null; // All methods failed
}

async function tryPipedExtraction(baseUrl, videoId) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const resp = await fetch(`${baseUrl}/streams/${videoId}`, { signal: controller.signal });
        if (!resp.ok) return null;

        const data = await resp.json();
        if (!data.audioStreams?.length) return null;

        // Pick highest bitrate audio stream
        const best = data.audioStreams
            .filter(s => s.mimeType?.startsWith('audio/'))
            .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

        if (!best?.url) return null;

        // Download the audio via Piped's proxy
        const audioResp = await fetch(best.url, {
            signal: AbortSignal.timeout(60000),
        });
        if (!audioResp.ok) return null;

        return await audioResp.blob();
    } finally {
        clearTimeout(timeout);
    }
}

async function tryInvidiousExtraction(baseUrl, videoId) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const resp = await fetch(`${baseUrl}/api/v1/videos/${videoId}`, { signal: controller.signal });
        if (!resp.ok) return null;

        const data = await resp.json();
        const audioFormats = (data.adaptiveFormats || [])
            .filter(f => f.type?.startsWith('audio/'))
            .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

        if (!audioFormats.length) return null;

        const audioUrl = audioFormats[0].url;
        if (!audioUrl) return null;

        const audioResp = await fetch(audioUrl, {
            signal: AbortSignal.timeout(60000),
        });
        if (!audioResp.ok) return null;

        return await audioResp.blob();
    } finally {
        clearTimeout(timeout);
    }
}

function showExtractionFailed() {
    // Highlight the upload area and show a message
    const uploadArea = document.getElementById('upload-area');
    if (uploadArea) {
        uploadArea.style.display = '';
        uploadArea.classList.add('upload-highlight');
    }
    showError(
        t('gen_error_extraction') ||
        'Could not extract audio automatically. Please upload the audio file instead.'
    );
}

// ---------------------------------------------------------------------------
// Backend API call
// ---------------------------------------------------------------------------
async function callBackendAPI(audioBlob, videoId) {
    const formData = new FormData();

    if (audioBlob instanceof File) {
        formData.append('file', audioBlob);
    } else {
        // Blob from extraction — need to give it a filename
        formData.append('file', audioBlob, 'audio.webm');
    }

    if (videoId) {
        formData.append('video_id', videoId);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
        const resp = await fetch(API_ENDPOINT, {
            method: 'POST',
            body: formData,
            signal: controller.signal,
        });

        if (!resp.ok) {
            const errText = await resp.text().catch(() => '');
            throw new Error(`Server error (${resp.status}): ${errText}`);
        }

        return await resp.json();
    } finally {
        clearTimeout(timeout);
    }
}

// ---------------------------------------------------------------------------
// Supabase cache
// ---------------------------------------------------------------------------
async function checkCache(videoId) {
    if (!supabaseClient) return null;
    try {
        const { data, error } = await supabaseClient
            .from('generated_chords')
            .select('*')
            .eq('video_id', videoId)
            .single();

        if (error || !data) return null;

        // Reshape to match API response format
        return {
            video_id: data.video_id,
            chords: data.chords || [],
            processing_time_ms: 0, // cached
        };
    } catch {
        return null;
    }
}

async function saveToCache(videoId, result) {
    if (!supabaseClient) return;
    try {
        await supabaseClient.from('generated_chords').upsert({
            video_id: videoId,
            chords: result.chords,
            model_version: 'btc-v1',
            processing_time_ms: result.processing_time_ms,
        }, { onConflict: 'video_id' });
    } catch (e) {
        console.warn('Cache save failed:', e);
    }
}

// ---------------------------------------------------------------------------
// Display results
// ---------------------------------------------------------------------------
async function showResults(videoId) {
    hideProgress();
    const section = document.getElementById('results-section');
    if (section) section.style.display = '';

    // Reset transpose display
    document.getElementById('transpose-value').textContent = '0';

    // Render chord timeline
    renderChordTimeline();

    // Set up player
    if (videoId) {
        initYouTubePlayer(videoId);
    } else if (selectedFile) {
        initAudioPlayer();
    }

    // Update URL
    if (videoId) {
        history.replaceState(null, '', `?v=${videoId}`);
    }
}

function hideResults() {
    const section = document.getElementById('results-section');
    if (section) section.style.display = 'none';
    stopSync();
    if (audioObjectUrl) {
        URL.revokeObjectURL(audioObjectUrl);
        audioObjectUrl = null;
    }
}

// ---------------------------------------------------------------------------
// Chord timeline rendering
// ---------------------------------------------------------------------------
function renderChordTimeline() {
    const container = document.getElementById('chord-timeline');
    if (!container || !chordData?.chords) return;

    container.innerHTML = '';

    chordData.chords.forEach((event, idx) => {
        const block = document.createElement('div');
        block.className = 'chord-block';
        block.dataset.index = idx;
        block.dataset.time = event.time;
        block.dataset.duration = event.duration;

        // Width proportional to duration (min 60px, max 200px)
        const width = Math.max(60, Math.min(200, event.duration * 50));
        block.style.minWidth = `${width}px`;

        const chordName = transposeChord(event.chord, currentTranspose);

        block.innerHTML = `
            <span class="chord-block-name chord-name">${chordName}</span>
            <span class="chord-block-time">${formatTime(event.time)}</span>
        `;

        // Click block to seek
        block.addEventListener('click', (e) => {
            // Don't seek if clicking on chord name (that opens diagram)
            if (e.target.classList.contains('chord-name')) return;
            seekTo(event.time);
        });

        container.appendChild(block);
    });
}

// ---------------------------------------------------------------------------
// YouTube player
// ---------------------------------------------------------------------------
function initYouTubePlayer(videoId) {
    const container = document.getElementById('youtube-player-container');
    if (container) container.style.display = '';

    // Hide audio player
    const audioContainer = document.getElementById('audio-player-container');
    if (audioContainer) audioContainer.style.display = 'none';

    // Load YouTube IFrame API if not already loaded
    if (!window.YT) {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);

        window.onYouTubeIframeAPIReady = () => createYTPlayer(videoId);
    } else {
        createYTPlayer(videoId);
    }
}

function createYTPlayer(videoId) {
    // Destroy existing player
    if (ytPlayer?.destroy) {
        try { ytPlayer.destroy(); } catch { /* ignore */ }
    }

    ytPlayer = new YT.Player('youtube-player', {
        height: '360',
        width: '100%',
        videoId: videoId,
        playerVars: { autoplay: 0, rel: 0, modestbranding: 1 },
        events: {
            onReady: () => startSync(),
            onStateChange: (e) => {
                if (e.data === YT.PlayerState.PLAYING) startSync();
                else if (e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.ENDED) stopSync();
            },
        },
    });
}

// ---------------------------------------------------------------------------
// HTML5 audio player
// ---------------------------------------------------------------------------
function initAudioPlayer() {
    const container = document.getElementById('audio-player-container');
    if (container) container.style.display = '';

    // Hide YouTube player
    const ytContainer = document.getElementById('youtube-player-container');
    if (ytContainer) ytContainer.style.display = 'none';

    audioPlayer = document.getElementById('audio-player');
    if (!audioPlayer || !selectedFile) return;

    // Revoke previous URL
    if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);

    audioObjectUrl = URL.createObjectURL(selectedFile);
    audioPlayer.src = audioObjectUrl;

    audioPlayer.onloadedmetadata = () => {
        document.getElementById('audio-duration').textContent = formatTime(audioPlayer.duration);
    };

    audioPlayer.ontimeupdate = () => {
        const cur = audioPlayer.currentTime;
        const dur = audioPlayer.duration || 1;
        document.getElementById('audio-current-time').textContent = formatTime(cur);
        document.getElementById('audio-seek').value = (cur / dur) * 100;
    };

    audioPlayer.onplay = () => {
        startSync();
        document.getElementById('play-icon').style.display = 'none';
        document.getElementById('pause-icon').style.display = '';
    };

    audioPlayer.onpause = () => {
        stopSync();
        document.getElementById('play-icon').style.display = '';
        document.getElementById('pause-icon').style.display = 'none';
    };
}

function toggleAudioPlayback() {
    if (!audioPlayer) return;
    if (audioPlayer.paused) audioPlayer.play();
    else audioPlayer.pause();
}

function handleAudioSeek(e) {
    if (!audioPlayer?.duration) return;
    audioPlayer.currentTime = (e.target.value / 100) * audioPlayer.duration;
}

// ---------------------------------------------------------------------------
// Chord sync (real-time highlight during playback)
// ---------------------------------------------------------------------------
function startSync() {
    stopSync();
    syncInterval = setInterval(updateChordSync, 100);
}

function stopSync() {
    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
    }
}

function updateChordSync() {
    const time = getCurrentTime();
    if (time < 0 || !chordData?.chords) return;

    // Find active chord (exact match within time+duration)
    let activeIdx = -1;
    for (let i = 0; i < chordData.chords.length; i++) {
        const c = chordData.chords[i];
        if (time >= c.time && time < c.time + c.duration) {
            activeIdx = i;
            break;
        }
    }

    // If in a gap between chords, keep showing the last played chord
    if (activeIdx < 0) {
        for (let i = chordData.chords.length - 1; i >= 0; i--) {
            if (time >= chordData.chords[i].time) {
                activeIdx = i;
                break;
            }
        }
    }

    // Update current chord display
    const currentChordEl = document.getElementById('current-chord');
    if (currentChordEl && activeIdx >= 0) {
        const chord = transposeChord(chordData.chords[activeIdx].chord, currentTranspose);
        currentChordEl.textContent = chord;
    }

    // Highlight active block in timeline
    const blocks = document.querySelectorAll('.chord-block');
    blocks.forEach((block, idx) => {
        block.classList.toggle('active', idx === activeIdx);
        block.classList.toggle('past', idx < activeIdx);
    });

    // Auto-scroll active block into view
    if (activeIdx >= 0 && blocks[activeIdx]) {
        blocks[activeIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
}

function getCurrentTime() {
    if (audioPlayer && !audioPlayer.paused) return audioPlayer.currentTime;
    if (ytPlayer?.getCurrentTime) {
        try { return ytPlayer.getCurrentTime(); } catch { return -1; }
    }
    return -1;
}

function seekTo(time) {
    if (audioPlayer) {
        audioPlayer.currentTime = time;
        if (audioPlayer.paused) audioPlayer.play();
    } else if (ytPlayer?.seekTo) {
        ytPlayer.seekTo(time, true);
    }
}

// ---------------------------------------------------------------------------
// Transpose
// ---------------------------------------------------------------------------
function transposeChord(chord, semitones) {
    if (!chord || semitones === 0) return chord;

    // Handle slash chords: Cm/G
    if (chord.includes('/')) {
        const parts = chord.split('/');
        return transposeChord(parts[0], semitones) + '/' + transposeChord(parts[1], semitones);
    }

    const match = chord.match(/^([A-G][#b]?)(.*)/);
    if (!match) return chord;

    let root = match[1];
    const quality = match[2];

    if (FLAT_MAP[root]) root = FLAT_MAP[root];

    const rootIndex = NOTES.indexOf(root);
    if (rootIndex < 0) return chord;

    const newIndex = ((rootIndex + semitones) % 12 + 12) % 12;
    return NOTES[newIndex] + quality;
}

function applyTranspose(delta) {
    currentTranspose += delta;

    document.getElementById('transpose-value').textContent = currentTranspose.toString();

    // Re-render chord timeline
    renderChordTimeline();

    // Update current chord display
    const currentChordEl = document.getElementById('current-chord');
    if (currentChordEl && currentChordEl.textContent !== '-') {
        // Will be updated by next sync tick
    }
}

// ---------------------------------------------------------------------------
// Progress UI
// ---------------------------------------------------------------------------
function showProgress() {
    const section = document.getElementById('progress-section');
    if (section) section.style.display = '';
    // Reset all steps
    ['step-cache', 'step-extract', 'step-analyze', 'step-done'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.remove('active', 'completed');
        }
    });
    const bar = document.getElementById('progress-bar');
    if (bar) bar.style.width = '0%';
}

function hideProgress() {
    const section = document.getElementById('progress-section');
    if (section) section.style.display = 'none';
}

const STEP_PROGRESS = { cache: 10, extract: 40, analyze: 80, done: 100 };

function setProgressStep(step) {
    const steps = ['cache', 'extract', 'analyze', 'done'];
    const stepIdx = steps.indexOf(step);

    steps.forEach((s, idx) => {
        const el = document.getElementById(`step-${s}`);
        if (!el) return;
        if (idx < stepIdx) {
            el.classList.add('completed');
            el.classList.remove('active');
        } else if (idx === stepIdx) {
            el.classList.add('active');
            el.classList.remove('completed');
        } else {
            el.classList.remove('active', 'completed');
        }
    });

    const bar = document.getElementById('progress-bar');
    if (bar) bar.style.width = `${STEP_PROGRESS[step] || 0}%`;
}

// ---------------------------------------------------------------------------
// Error UI
// ---------------------------------------------------------------------------
function showError(msg) {
    const section = document.getElementById('error-section');
    const msgEl = document.getElementById('error-message');
    if (section) section.style.display = '';
    if (msgEl) msgEl.textContent = msg;
}

function hideError() {
    const section = document.getElementById('error-section');
    if (section) section.style.display = 'none';
}

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------
function disableGenerateBtn(disabled) {
    const btn = document.getElementById('generate-btn');
    if (btn) {
        btn.disabled = disabled;
        btn.textContent = disabled
            ? (t('gen_generating') || 'Listening...')
            : (t('gen_button') || 'Find Chords');
    }
}

function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function resetGenerator() {
    hideError();
    hideResults();
    hideProgress();
    chordData = null;
    currentTranspose = 0;
    currentVideoId = null;
    clearSelectedFile();
    document.getElementById('youtube-url').value = '';
    document.getElementById('current-chord').textContent = '-';
    stopSync();
    history.replaceState(null, '', window.location.pathname);
}
