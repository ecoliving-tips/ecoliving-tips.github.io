/**
 * Swaram Chord Finder — js/chord-finder.js
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
const SUPABASE_URL = 'https://jfnccekkhffonkjkmxyf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_KJA4VzMAjt2WVEEg0JKMfg_lDrABAZK';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let chordData = null;        // Full response from backend
let currentTranspose = 0;
let selectedFile = null;     // Uploaded File object
let syncRafId = null;        // requestAnimationFrame ID for chord sync
let lastActiveIdx = -1;      // Last highlighted chord index (avoids redundant DOM updates)
let cachedBlocks = null;     // Cached NodeList of .chord-block elements
let cachedCurrentChordEl = null; // Cached #current-chord element
let audioPlayer = null;      // HTML5 Audio element
let audioObjectUrl = null;   // Blob URL for uploaded file
let serverWarm = false;      // Whether the HF Space is awake

// Beginner mode state
let beginnerMode = false;
let capoPosition = 0;        // auto-computed capo for beginner mode
let difficultyLevel = '';     // 'easy' | 'moderate' | 'advanced'

// ---------------------------------------------------------------------------
// Beginner mode — chord simplification & capo optimization
// ---------------------------------------------------------------------------

/** Chords playable in open position without barre */
const BEGINNER_CHORDS = new Set([
    'C', 'D', 'E', 'F', 'G', 'A',
    'Am', 'Dm', 'Em',
    'A7', 'B7', 'D7', 'E7', 'G7'
]);

/** Common beginner 7th chords that should keep their quality */
const BEGINNER_7THS = new Set(['A7', 'B7', 'D7', 'E7', 'G7']);

/**
 * Simplify a chord name to its beginner-friendly equivalent.
 * Rules applied in order:
 * 1. Slash chords → root only (C/G → C)
 * 2. 9th → triad (C9 → C, Cm9 → Cm)
 * 3. m7b5 → minor
 * 4. dim → minor
 * 5. aug → major
 * 6. 6th → triad
 * 7. sus → major
 * 8. M7/maj7 → major
 * 9. m7 → minor
 * 10. 7th → keep if beginner 7th, else strip
 */
function simplifyChord(chord) {
    if (!chord) return chord;

    // Strip slash chords → root only
    if (chord.includes('/')) {
        chord = chord.split('/')[0];
    }

    const match = chord.match(/^([A-G][#b]?)(.*)/);
    if (!match) return chord;

    let root = match[1];
    let quality = match[2];

    // Normalize flats for consistent lookup
    if (FLAT_MAP[root]) root = FLAT_MAP[root];

    // Power chord → major
    if (quality === '5') return root;
    // 11th/13th → triad
    if (/^m?1[13]/.test(quality)) return root + (quality.startsWith('m') ? 'm' : '');
    // 9th chords (including add9, madd9, 7#9) → triad
    if (/m?.*9/.test(quality)) {
        const isMinor = quality.startsWith('m') && !quality.startsWith('maj');
        return root + (isMinor ? 'm' : '');
    }
    // 7sus4 → major
    if (quality === '7sus4') return root;
    // m7b5 → minor
    if (quality === 'm7b5') return root + 'm';
    // dim → minor
    if (quality === 'dim') return root + 'm';
    // aug → major
    if (quality === 'aug') return root;
    // 6th chords → triad
    if (quality === '6') return root;
    if (quality === 'm6') return root + 'm';
    // sus → major
    if (quality === 'sus4' || quality === 'sus2') return root;
    // add2 → major
    if (quality === 'add2') return root;
    // M7/maj7 → major
    if (quality === 'M7' || quality === 'maj7') return root;
    // m7 → minor
    if (quality === 'm7') return root + 'm';
    // 7th variants (7, 7#5, 7b5, etc.) → keep if beginner 7th, else strip
    if (quality.startsWith('7')) {
        return BEGINNER_7THS.has(root + '7') ? root + '7' : root;
    }

    return root + quality;
}

/**
 * Find the capo position (0–7) that maximizes beginner-friendly chords.
 * Returns { capo, displayChords: Map<originalChord, displayChord> }
 */
function findOptimalCapo(chords) {
    if (!chords?.length) return { capo: 0 };

    // Get unique simplified chords
    const uniqueSimplified = [...new Set(chords.map(e => simplifyChord(e.chord)))];

    let bestCapo = 0;
    let bestScore = -1;

    for (let capo = 0; capo <= 7; capo++) {
        let score = 0;
        const transposed = uniqueSimplified.map(c => transposeChord(c, -capo + currentTranspose));
        for (const c of transposed) {
            if (BEGINNER_CHORDS.has(c)) score++;
        }
        if (score > bestScore) {
            bestScore = score;
            bestCapo = capo;
        }
    }

    return { capo: bestCapo };
}

/**
 * Compute difficulty level based on how many unique result chords
 * fall in the beginner set after simplification + capo transpose.
 */
function computeDifficulty(chords, capo) {
    if (!chords?.length) return 'easy';
    const unique = [...new Set(chords.map(e => {
        const simplified = simplifyChord(e.chord);
        return transposeChord(simplified, -capo + currentTranspose);
    }))];
    const beginnerCount = unique.filter(c => BEGINNER_CHORDS.has(c)).length;
    const ratio = beginnerCount / unique.length;
    if (ratio >= 1) return 'easy';
    if (ratio >= 0.7) return 'moderate';
    return 'advanced';
}

/**
 * Get the display chord for a given raw chord, applying beginner
 * simplification + capo + user transpose as needed.
 */
function getDisplayChord(rawChord) {
    let chord = rawChord;
    if (beginnerMode) {
        chord = simplifyChord(chord);
        chord = transposeChord(chord, -capoPosition + currentTranspose);
    } else {
        chord = transposeChord(chord, currentTranspose);
    }
    return chord;
}

/** Toggle beginner mode on/off and re-render */
function toggleBeginnerMode(enabled) {
    beginnerMode = enabled;

    // Update toggle buttons
    document.getElementById('mode-original')?.classList.toggle('active', !enabled);
    document.getElementById('mode-beginner')?.classList.toggle('active', enabled);

    if (enabled && chordData?.chords) {
        const result = findOptimalCapo(chordData.chords);
        capoPosition = result.capo;
        difficultyLevel = computeDifficulty(chordData.chords, capoPosition);
        updateBeginnerInfo();
    }

    // Show/hide beginner info bar
    const infoBar = document.getElementById('beginner-info');
    if (infoBar) infoBar.style.display = enabled ? '' : 'none';

    renderChordTimeline();
    lastActiveIdx = -1;
    updateChordSync();
}

/** Update the capo and difficulty badges */
function updateBeginnerInfo() {
    const capoEl = document.getElementById('capo-display');
    const diffEl = document.getElementById('difficulty-display');

    if (capoEl) {
        capoEl.textContent = capoPosition > 0
            ? `${t('gen_capo_prefix')} ${capoPosition}`
            : t('gen_no_capo');
    }

    if (diffEl) {
        const labels = { easy: t('gen_difficulty_easy'), moderate: t('gen_difficulty_moderate'), advanced: t('gen_difficulty_advanced') };
        diffEl.textContent = labels[difficultyLevel] || difficultyLevel;
        diffEl.className = 'meta-badge beginner-difficulty difficulty-' + difficultyLevel;
    }
}

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

    // Beginner mode toggle
    document.getElementById('mode-original')?.addEventListener('click', () => toggleBeginnerMode(false));
    document.getElementById('mode-beginner')?.addEventListener('click', () => toggleBeginnerMode(true));
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

        // Silent analytics — never affects user flow
        logChordFinderUsage(selectedFile, result);

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

        const chordName = getDisplayChord(event.chord);
        const originalChord = transposeChord(event.chord, currentTranspose);

        // Show original chord as subtitle when beginner mode changes the chord
        const showOriginal = beginnerMode && chordName !== originalChord;

        block.innerHTML = `
            <span class="chord-block-name">${chordName}</span>
            ${showOriginal ? `<span class="chord-block-original">${originalChord}</span>` : ''}
            <span class="chord-block-time">${formatTime(event.time)}</span>
        `;

        // Click block to seek to this chord's position
        block.addEventListener('click', () => {
            seekTo(event.time);
        });

        container.appendChild(block);
    });

    // Cache DOM references for sync loop
    cachedBlocks = container.querySelectorAll('.chord-block');
    cachedCurrentChordEl = document.getElementById('current-chord');
    lastActiveIdx = -1;
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

    audioPlayer.onended = () => {
        stopSync();
        lastActiveIdx = -1;
        document.getElementById('play-icon').style.display = '';
        document.getElementById('pause-icon').style.display = 'none';
        if (cachedCurrentChordEl) cachedCurrentChordEl.textContent = '-';
        // Clear active/past highlights
        if (cachedBlocks) {
            for (let i = 0; i < cachedBlocks.length; i++) {
                cachedBlocks[i].classList.remove('active', 'past');
            }
        }
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
    lastActiveIdx = -1; // Force sync update
    updateChordSync();  // Immediate visual feedback
}

// ---------------------------------------------------------------------------
// Chord sync (real-time highlight during playback)
// ---------------------------------------------------------------------------
function startSync() {
    stopSync();
    lastActiveIdx = -1;
    function tick() {
        updateChordSync();
        syncRafId = requestAnimationFrame(tick);
    }
    syncRafId = requestAnimationFrame(tick);
}

function stopSync() {
    if (syncRafId) {
        cancelAnimationFrame(syncRafId);
        syncRafId = null;
    }
}

/**
 * Binary search: find the last chord whose start time <= given time.
 */
function findActiveChordIndex(time) {
    const chords = chordData.chords;
    let lo = 0, hi = chords.length - 1, result = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (chords[mid].time <= time) {
            result = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    // Check if time falls within the found chord's duration
    if (result >= 0) {
        const c = chords[result];
        if (time < c.time + c.duration) return result;
        // In a gap — keep showing last played chord
        return result;
    }
    return -1;
}

function updateChordSync() {
    if (!audioPlayer || !chordData?.chords?.length) return;
    const time = audioPlayer.currentTime;

    const activeIdx = findActiveChordIndex(time);

    // Skip DOM updates if nothing changed
    if (activeIdx === lastActiveIdx) return;
    lastActiveIdx = activeIdx;

    // Update current chord display
    if (cachedCurrentChordEl && activeIdx >= 0) {
        const chord = getDisplayChord(chordData.chords[activeIdx].chord);
        cachedCurrentChordEl.textContent = chord;
    }

    // Highlight active block in timeline
    if (cachedBlocks) {
        for (let i = 0; i < cachedBlocks.length; i++) {
            cachedBlocks[i].classList.toggle('active', i === activeIdx);
            cachedBlocks[i].classList.toggle('past', i < activeIdx);
        }
    }

    // Auto-scroll active block into view
    if (activeIdx >= 0 && cachedBlocks?.[activeIdx]) {
        cachedBlocks[activeIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
}

function seekTo(time) {
    if (!audioPlayer) return;
    audioPlayer.currentTime = time;
    lastActiveIdx = -1; // Force sync update
    updateChordSync();  // Immediate visual feedback
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
    const next = currentTranspose + delta;
    if (next < -11 || next > 11) return;
    currentTranspose = next;
    document.getElementById('transpose-value').textContent = currentTranspose.toString();

    // Recalculate capo & difficulty for the new key
    if (beginnerMode && chordData?.chords) {
        capoPosition = findOptimalCapo(chordData.chords).capo;
        difficultyLevel = computeDifficulty(chordData.chords, capoPosition);
        updateBeginnerInfo();
    }

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
    beginnerMode = false;
    capoPosition = 0;
    difficultyLevel = '';
    clearSelectedFile();
    document.getElementById('current-chord').textContent = '-';
    document.getElementById('mode-original')?.classList.add('active');
    document.getElementById('mode-beginner')?.classList.remove('active');
    const infoBar = document.getElementById('beginner-info');
    if (infoBar) infoBar.style.display = 'none';
    stopSync();
    cachedBlocks = null;
    cachedCurrentChordEl = null;
    lastActiveIdx = -1;
}

// ---------------------------------------------------------------------------
// Analytics — silent fire-and-forget logging to Supabase
// ---------------------------------------------------------------------------
function logChordFinderUsage(file, result) {
    try {
        if (!window.supabase) return;
        const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        sb.from('chord_finder_logs').insert([{
            file_name: file.name,
            file_size_kb: Math.round(file.size / 1024),
            detected_key: result.key || null,
            chord_count: result.chords?.length || 0,
            processing_time_ms: result.processing_time_ms || null,
        }]).then(() => {}).catch(() => {});
    } catch { /* never disrupt user flow */ }
}
