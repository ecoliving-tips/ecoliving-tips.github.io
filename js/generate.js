/**
 * Swaram Chord Finder — js/generate.js
 *
 * Handles: file upload, backend API call (HuggingFace Spaces),
 * chord display, HTML5 audio playback sync, and transpose.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const API_ENDPOINT = 'https://vineethwilson-swaram-chord-service.hf.space/analyze';
const MAX_FILE_SIZE = 30 * 1024 * 1024; // 30 MB
const API_TIMEOUT_MS = 300_000; // 5 minutes

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let chordData = null;        // Full response from backend
let currentTranspose = 0;
let selectedFile = null;     // Uploaded File object
let syncInterval = null;     // setInterval ID for chord sync
let audioPlayer = null;      // HTML5 Audio element
let audioObjectUrl = null;   // Blob URL for uploaded file
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
// Initialization
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', function () {
    setupEventListeners();
    warmUpServer();
});

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
// Main generate flow
// ---------------------------------------------------------------------------
async function handleGenerate() {
    if (!selectedFile) {
        showError(t('gen_error_no_input') || 'Please upload an audio file to find chords.');
        return;
    }

    // Reset UI
    hideError();
    hideResults();
    showProgress();
    disableGenerateBtn(true);

    try {
        // Send to backend for analysis
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
            result = await callBackendAPI(selectedFile);
            serverWarm = true;
        } finally {
            if (warmupTimer) clearTimeout(warmupTimer);
            const hint = document.getElementById('warmup-hint');
            if (hint) hint.style.display = 'none';
        }

        chordData = result;
        currentTranspose = 0;

        setProgressStep('done');
        showResults();

    } catch (err) {
        console.error('Generate failed:', err);
        hideProgress();
        showError(err.message || 'An error occurred while generating chords.');
    } finally {
        disableGenerateBtn(false);
    }
}

// ---------------------------------------------------------------------------
// Backend API call
// ---------------------------------------------------------------------------
async function callBackendAPI(file) {
    const formData = new FormData();
    formData.append('file', file);

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
// Display results
// ---------------------------------------------------------------------------
function showResults() {
    hideProgress();
    const section = document.getElementById('results-section');
    if (section) section.style.display = '';

    // Reset transpose display
    document.getElementById('transpose-value').textContent = '0';

    // Render chord timeline
    renderChordTimeline();

    // Set up audio player for playback sync
    if (selectedFile) {
        initAudioPlayer();
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
// HTML5 audio player
// ---------------------------------------------------------------------------
function initAudioPlayer() {
    const container = document.getElementById('audio-player-container');
    if (container) container.style.display = '';

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
    if (!audioPlayer || !chordData?.chords) return;
    const time = audioPlayer.currentTime;

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

function seekTo(time) {
    if (!audioPlayer) return;
    audioPlayer.currentTime = time;
    if (audioPlayer.paused) audioPlayer.play();
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
    renderChordTimeline();
}

// ---------------------------------------------------------------------------
// Progress UI
// ---------------------------------------------------------------------------
function showProgress() {
    const section = document.getElementById('progress-section');
    if (section) section.style.display = '';
    ['step-analyze', 'step-done'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active', 'completed');
    });
    const bar = document.getElementById('progress-bar');
    if (bar) bar.style.width = '0%';
}

function hideProgress() {
    const section = document.getElementById('progress-section');
    if (section) section.style.display = 'none';
}

const STEP_PROGRESS = { analyze: 50, done: 100 };

function setProgressStep(step) {
    const steps = ['analyze', 'done'];
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

function resetGenerator() {
    hideError();
    hideResults();
    hideProgress();
    chordData = null;
    currentTranspose = 0;
    clearSelectedFile();
    document.getElementById('current-chord').textContent = '-';
    stopSync();
}
