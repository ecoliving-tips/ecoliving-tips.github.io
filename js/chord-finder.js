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
const MAX_DURATION_SEC = 600; // 10 minutes — protects free-tier backend
const API_TIMEOUT_MS = 300_000; // 5 minutes
const SUPABASE_URL = 'https://jfnccekkhffonkjkmxyf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_KJA4VzMAjt2WVEEg0JKMfg_lDrABAZK';
const MODEL_VERSION = 'btc-v1';

// Lazy Supabase singleton — created on first use, reused everywhere
let _supabaseClient = null;
function getSupabase() {
    if (!_supabaseClient && window.supabase) {
        _supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    }
    return _supabaseClient;
}

// ---------------------------------------------------------------------------
// YouTube audio extraction — client-side fallback cascade (Piped → Cobalt)
// Used when server-side extraction fails (e.g., Piped 500 on specific videos).
// Runs from the user's browser IP — avoids cloud IP blocking by YouTube.
// ---------------------------------------------------------------------------
const PIPED_INSTANCES = [
    'https://api.piped.private.coffee', // Only official instance (Apr 2026)
];
const COBALT_INSTANCES = [
    'https://cobalt.tools',
    'https://api.cobalt.tools',
];
const PIPED_CLIENT_MAX_RETRIES = 2;       // Retry transient 500s client-side too
const PIPED_CLIENT_RETRY_DELAY_MS = 2000; // 2s between retries
const METADATA_TIMEOUT_MS = 8_000;        // 8s per instance for metadata API
const AUDIO_DL_TIMEOUT_MS = 60_000;       // 60s for audio blob download
const MIN_AUDIO_BYTES = 10_000;           // 10 KB — skip suspiciously small responses

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
let youtubeVideoId = null;   // Extracted YouTube video ID (when using URL input)
let ytPlayer = null;         // YouTube IFrame Player instance
let ytSyncInterval = null;   // Interval ID for YouTube chord sync

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

    // YouTube URL input
    const ytInput = document.getElementById('youtube-url');
    if (ytInput) {
        ytInput.addEventListener('input', handleYouTubeUrlInput);
        ytInput.addEventListener('paste', () => setTimeout(handleYouTubeUrlInput, 0));
    }
    const ytClear = document.getElementById('youtube-url-clear');
    if (ytClear) ytClear.addEventListener('click', clearYouTubeUrl);

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
    // Clear YouTube URL when file is selected (mutual exclusivity)
    clearYouTubeUrl();
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
// YouTube URL handling
// ---------------------------------------------------------------------------
function extractVideoId(url) {
    if (!url) return null;
    const patterns = [
        /(?:youtube\.com\/watch\?.*v=)([A-Za-z0-9_-]{11})/,
        /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/,
        /(?:youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/,
        /(?:youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/,
    ];
    for (const p of patterns) {
        const m = url.match(p);
        if (m) return m[1];
    }
    return null;
}

function handleYouTubeUrlInput() {
    const input = document.getElementById('youtube-url');
    if (!input) return;
    const url = input.value.trim();
    const clearBtn = document.getElementById('youtube-url-clear');
    if (clearBtn) clearBtn.style.display = url ? '' : 'none';
    // If valid YouTube URL, clear file selection (mutual exclusivity)
    if (url && extractVideoId(url)) {
        clearSelectedFile();
    }
}

function clearYouTubeUrl() {
    const input = document.getElementById('youtube-url');
    if (input) input.value = '';
    const clearBtn = document.getElementById('youtube-url-clear');
    if (clearBtn) clearBtn.style.display = 'none';
    const status = document.getElementById('youtube-fetch-status');
    if (status) { status.style.display = 'none'; status.classList.remove('error'); }
    youtubeVideoId = null;
}

/**
 * Download an audio blob from a URL with timeout and size validation.
 * Returns the Blob, or throws on failure.
 */
async function _downloadAudioBlob(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AUDIO_DL_TIMEOUT_MS);
    try {
        const resp = await fetch(url, { signal: controller.signal });
        if (!resp.ok) throw new Error(`Audio download HTTP ${resp.status}`);
        const blob = await resp.blob();
        if (blob.size < MIN_AUDIO_BYTES) throw new Error(`Audio too small (${blob.size} bytes)`);
        return blob;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Duration guard — throws a _noRetry error if duration exceeds limit.
 */
function _checkDuration(durationSec) {
    if (durationSec && durationSec > MAX_DURATION_SEC) {
        const mins = Math.floor(MAX_DURATION_SEC / 60);
        const err = new Error(
            t('gen_url_too_long') ||
            `This video is too long. Please use videos under ${mins} minutes for best results.`
        );
        err._noRetry = true;
        throw err;
    }
}

// -- Tier 1: Piped API (with retry for transient 500s) -----------------------
async function _tryPiped(videoId) {
    for (let i = 0; i < PIPED_INSTANCES.length; i++) {
        const instance = PIPED_INSTANCES[i];
        for (let attempt = 1; attempt <= PIPED_CLIENT_MAX_RETRIES; attempt++) {
            try {
                console.log(`[Piped] Trying ${instance} (attempt ${attempt}/${PIPED_CLIENT_MAX_RETRIES})...`);
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS);
                const resp = await fetch(`${instance}/streams/${videoId}`, { signal: controller.signal });
                clearTimeout(timer);

                if (resp.status === 500 && attempt < PIPED_CLIENT_MAX_RETRIES) {
                    console.warn(`[Piped] ${instance} returned 500, retrying in ${PIPED_CLIENT_RETRY_DELAY_MS}ms...`);
                    await new Promise(r => setTimeout(r, PIPED_CLIENT_RETRY_DELAY_MS));
                    continue;
                }
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const data = await resp.json();

                if (!data.audioStreams?.length) throw new Error('No audio streams');
                _checkDuration(data.duration);

                // Prefer itag 140 (M4A 128kbps), fallback to highest bitrate ≤160kbps
                let stream = data.audioStreams.find(s => s.itag === 140);
                if (!stream) {
                    const candidates = data.audioStreams
                        .filter(s => s.bitrate && s.bitrate < 170000)
                        .sort((a, b) => b.bitrate - a.bitrate);
                    stream = candidates[0] || data.audioStreams[0];
                }

                const blob = await _downloadAudioBlob(stream.url);
                let ext = '.m4a';
                if (stream.mimeType?.includes('webm') || stream.format === 'WEBMA_OPUS') ext = '.webm';

                console.log(`[Piped] Success via ${instance} (attempt ${attempt}, ${(blob.size / 1024 / 1024).toFixed(1)} MB)`);
                return { blob, title: data.title || videoId, ext };
            } catch (err) {
                if (err._noRetry) throw err;
                if (attempt < PIPED_CLIENT_MAX_RETRIES && String(err.message).includes('500')) {
                    console.warn(`[Piped] ${instance} attempt ${attempt} failed:`, err.message, '— retrying...');
                    await new Promise(r => setTimeout(r, PIPED_CLIENT_RETRY_DELAY_MS));
                    continue;
                }
                console.warn(`[Piped] ${instance} failed after ${attempt} attempts:`, err.message);
                break; // Move to next instance
            }
        }
    }
    return null; // All instances failed — fall through to next tier
}

// -- Tier 2: Cobalt API (v10 + v7 payloads) ----------------------------------
async function _tryCobalt(videoId) {
    const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;

    for (let i = 0; i < COBALT_INSTANCES.length; i++) {
        const instance = COBALT_INSTANCES[i];

        // Try v10 payload first, then v7 fallback
        const payloads = [
            { endpoint: '/',         body: { url: ytUrl, downloadMode: 'audio', audioFormat: 'mp3', audioBitrate: '128' } },
            { endpoint: '/api/json', body: { url: ytUrl, isAudioOnly: true, aFormat: 'mp3' } },
        ];

        for (const { endpoint, body } of payloads) {
            try {
                console.log(`[Cobalt] Trying ${instance}${endpoint} (${i + 1}/${COBALT_INSTANCES.length})...`);
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS);
                const resp = await fetch(`${instance}${endpoint}`, {
                    method: 'POST',
                    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                    signal: controller.signal,
                });
                clearTimeout(timer);

                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const data = await resp.json();

                // Cobalt returns status: "error" for auth-required instances
                if (data.status === 'error') throw new Error(data.error?.code || 'Cobalt error');

                const audioUrl = data.url || data.stream;
                if (!audioUrl) throw new Error('No audio URL in response');

                const blob = await _downloadAudioBlob(audioUrl);
                console.log(`[Cobalt] Success via ${instance} (${(blob.size / 1024 / 1024).toFixed(1)} MB)`);
                return { blob, title: videoId, ext: '.mp3' };
            } catch (err) {
                if (err._noRetry) throw err;
                console.warn(`[Cobalt] ${instance}${endpoint} failed:`, err.message);
            }
        }
    }
    return null;
}

/**
 * Fetch audio from YouTube via 2-tier client-side cascade (Piped → Cobalt).
 * Runs from user's browser — their IP is not blocked by YouTube.
 * Returns: { blob: Blob, title: string, ext: string }
 */
async function fetchYouTubeAudio(videoId) {
    // Tier 1: Piped (with retry for transient 500s)
    const piped = await _tryPiped(videoId);
    if (piped) return piped;

    // Tier 2: Cobalt
    const cobalt = await _tryCobalt(videoId);
    if (cobalt) return cobalt;

    // All tiers exhausted
    throw new Error(
        t('gen_url_error') || 'Could not fetch audio from YouTube. Please upload the audio file instead.'
    );
}

// ---------------------------------------------------------------------------
// Audio duration check (client-side, via HTML5 Audio)
// ---------------------------------------------------------------------------
function getAudioDuration(file) {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const audio = new Audio();
        audio.preload = 'metadata';
        const cleanup = () => { URL.revokeObjectURL(url); audio.src = ''; };
        audio.onloadedmetadata = () => { resolve(audio.duration); cleanup(); };
        audio.onerror = () => { resolve(null); cleanup(); };
        // Safety timeout — some formats may not fire events
        setTimeout(() => { resolve(null); cleanup(); }, 5000);
        audio.src = url;
    });
}

// ---------------------------------------------------------------------------
// Main generate flow
// ---------------------------------------------------------------------------
async function handleGenerate() {
    const ytUrl = document.getElementById('youtube-url')?.value.trim();
    const videoId = ytUrl ? extractVideoId(ytUrl) : null;

    if (!selectedFile && !videoId) {
        showError(t('gen_error_no_input') || 'Please upload an audio file or paste a YouTube link.');
        return;
    }

    // Duration check for uploaded files — don't waste time uploading overly long audio
    if (selectedFile && !videoId) {
        try {
            const dur = await getAudioDuration(selectedFile);
            if (dur && dur > MAX_DURATION_SEC) {
                const mins = Math.floor(MAX_DURATION_SEC / 60);
                showError(
                    t('gen_error_too_long') ||
                    `This audio is too long. Please use files under ${mins} minutes for best results.`
                );
                return;
            }
        } catch { /* can't read duration — let backend handle it */ }
    }

    // Reset UI
    hideError();
    hideResults();
    showProgress();
    disableGenerateBtn(true);

    try {
        let fileToUpload = selectedFile;
        let result;
        youtubeVideoId = videoId;

        // Cache check — YouTube URLs only
        if (videoId) {
            const cached = await checkChordCache(videoId);
            if (cached) {
                chordData = cached;
                currentTranspose = 0;
                setProgressStep('done');
                showResults();
                return;
            }
        }

        // If YouTube URL provided, send to backend (server-side extraction).
        // Falls back to client-side extraction if server returns 502.
        if (!fileToUpload && videoId) {
            setProgressStep('analyze');

            let warmupTimer = null;
            if (!serverWarm) {
                warmupTimer = setTimeout(() => {
                    const hint = document.getElementById('warmup-hint');
                    if (hint) hint.style.display = '';
                }, 15000);
            }

            try {
                result = await callBackendAPI(null, ytUrl);
                serverWarm = true;
            } catch (serverErr) {
                if (serverErr._youtubeExtractionFailed) {
                    // Server couldn't reach YouTube — fall back to client-side extraction
                    // This runs from the user's browser IP (not blocked by YouTube)
                    console.log('[YouTube] Server-side failed, trying client-side...');
                    const ytStep = document.getElementById('step-youtube-fetch');
                    if (ytStep) ytStep.style.display = '';
                    setProgressStep('youtube-fetch');

                    const status = document.getElementById('youtube-fetch-status');
                    if (status) {
                        status.style.display = '';
                        status.textContent = t('gen_server_yt_fallback') || 'Fetching audio from your browser (this may take a moment)...';
                        status.classList.remove('error');
                    }

                    try {
                        const { blob, title, ext } = await fetchYouTubeAudio(videoId);
                        fileToUpload = new File([blob], `${title}${ext}`, { type: blob.type });
                        if (status) status.style.display = 'none';
                    } catch (clientErr) {
                        // Both server and client failed — show helpful error
                        if (status) {
                            status.textContent = t('gen_url_error') || 'Could not fetch audio from YouTube. Please download the audio and upload it instead.';
                            status.classList.add('error');
                        }
                        throw clientErr;
                    }

                    // Now send the downloaded file to backend for analysis
                    setProgressStep('analyze');
                    result = await callBackendAPI(fileToUpload, null);
                    serverWarm = true;
                } else {
                    throw serverErr;
                }
            } finally {
                if (warmupTimer) clearTimeout(warmupTimer);
                const hint = document.getElementById('warmup-hint');
                if (hint) hint.style.display = 'none';
            }
        }

        // If file uploaded (no YouTube URL), send file to backend
        if (fileToUpload && !result) {
            setProgressStep('analyze');

            let warmupTimer = null;
            if (!serverWarm) {
                warmupTimer = setTimeout(() => {
                    const hint = document.getElementById('warmup-hint');
                    if (hint) hint.style.display = '';
                }, 15000);
            }

            try {
                result = await callBackendAPI(fileToUpload, null);
                serverWarm = true;
            } finally {
                if (warmupTimer) clearTimeout(warmupTimer);
                const hint = document.getElementById('warmup-hint');
                if (hint) hint.style.display = 'none';
            }
        }

        // Store file for audio player (even if from YouTube fetch)
        if (!selectedFile && fileToUpload) {
            selectedFile = fileToUpload;
        }

        chordData = result;
        currentTranspose = 0;

        // Cache store — YouTube URLs only (fire-and-forget)
        if (videoId) storeChordCache(videoId, result);

        setProgressStep('done');
        showResults();

        // Silent analytics
        logChordFinderUsage(fileToUpload, result);

    } catch (err) {
        console.error('Generate failed:', err);
        hideProgress();
        showError(err.message || 'An error occurred while generating chords.');
    } finally {
        disableGenerateBtn(false);
        // Hide YouTube fetch step for next run
        const ytStep = document.getElementById('step-youtube-fetch');
        if (ytStep) ytStep.style.display = 'none';
    }
}

// ---------------------------------------------------------------------------
// Backend API call
// ---------------------------------------------------------------------------
async function callBackendAPI(file, youtubeUrl) {
    const formData = new FormData();
    if (file) formData.append('file', file);
    if (youtubeUrl) formData.append('youtube_url', youtubeUrl);

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
            const err = new Error(`Server error (${resp.status}): ${errText}`);
            // Detect server-side YouTube extraction failure → enables client-side fallback
            if (resp.status === 502) {
                try {
                    const body = JSON.parse(errText);
                    if (body.detail === 'youtube_extraction_failed') {
                        err._youtubeExtractionFailed = true;
                    }
                } catch { /* not JSON */ }
            }
            throw err;
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

    // Set up playback: YouTube embed or HTML5 audio player
    if (youtubeVideoId) {
        initYouTubePlayer(youtubeVideoId);
    } else if (selectedFile) {
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
    // Clean up YouTube player
    destroyYouTubePlayer();
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
// YouTube IFrame Player
// ---------------------------------------------------------------------------
let ytApiReady = false;

function loadYouTubeIFrameAPI() {
    if (ytApiReady || document.getElementById('yt-iframe-api')) return;
    const tag = document.createElement('script');
    tag.id = 'yt-iframe-api';
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
}

// YouTube IFrame API calls this global function when ready
window.onYouTubeIframeAPIReady = function () {
    ytApiReady = true;
};

function initYouTubePlayer(videoId) {
    // Hide HTML5 audio player, show YouTube embed
    const audioContainer = document.getElementById('audio-player-container');
    if (audioContainer) audioContainer.style.display = 'none';
    const ytContainer = document.getElementById('youtube-player-container');
    if (ytContainer) ytContainer.style.display = '';

    // Load API if not already loaded
    loadYouTubeIFrameAPI();

    function createPlayer() {
        // Destroy previous if any
        if (ytPlayer && typeof ytPlayer.destroy === 'function') {
            ytPlayer.destroy();
            ytPlayer = null;
        }
        ytPlayer = new YT.Player('youtube-player', {
            videoId: videoId,
            playerVars: { autoplay: 0, modestbranding: 1, rel: 0 },
            events: {
                onStateChange: onYTStateChange,
            },
        });
    }

    if (ytApiReady && window.YT?.Player) {
        createPlayer();
    } else {
        // Wait for API to load
        const check = setInterval(() => {
            if (window.YT?.Player) {
                clearInterval(check);
                ytApiReady = true;
                createPlayer();
            }
        }, 200);
        // Safety timeout
        setTimeout(() => clearInterval(check), 10000);
    }
}

function onYTStateChange(event) {
    // YT.PlayerState: PLAYING=1, PAUSED=2, ENDED=0
    if (event.data === 1) {
        // Playing — start chord sync via polling (YouTube API has no timeupdate event)
        startYTSync();
    } else {
        stopYTSync();
    }
    if (event.data === 0) {
        // Ended
        lastActiveIdx = -1;
        if (cachedCurrentChordEl) cachedCurrentChordEl.textContent = '-';
        if (cachedBlocks) {
            for (let i = 0; i < cachedBlocks.length; i++) {
                cachedBlocks[i].classList.remove('active', 'past');
            }
        }
    }
}

function startYTSync() {
    stopYTSync();
    ytSyncInterval = setInterval(updateChordSync, 100); // Poll at 10Hz
}

function stopYTSync() {
    if (ytSyncInterval) {
        clearInterval(ytSyncInterval);
        ytSyncInterval = null;
    }
}

function destroyYouTubePlayer() {
    stopYTSync();
    if (ytPlayer && typeof ytPlayer.destroy === 'function') {
        ytPlayer.destroy();
        ytPlayer = null;
    }
    youtubeVideoId = null;
    const ytContainer = document.getElementById('youtube-player-container');
    if (ytContainer) {
        ytContainer.style.display = 'none';
        // Recreate the div (YouTube API replaces it with an iframe)
        ytContainer.innerHTML = '<div id="youtube-player"></div>';
    }
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
    if (!chordData?.chords?.length) return;
    let time;
    if (ytPlayer && typeof ytPlayer.getCurrentTime === 'function') {
        time = ytPlayer.getCurrentTime();
    } else if (audioPlayer) {
        time = audioPlayer.currentTime;
    } else {
        return;
    }

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
    if (ytPlayer && typeof ytPlayer.seekTo === 'function') {
        ytPlayer.seekTo(time, true);
        lastActiveIdx = -1;
        updateChordSync();
        if (ytPlayer.getPlayerState() !== 1) ytPlayer.playVideo();
        return;
    }
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

const STEP_PROGRESS = { 'youtube-fetch': 20, analyze: 60, done: 100 };

function setProgressStep(step) {
    const steps = ['youtube-fetch', 'analyze', 'done'];
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
    clearYouTubeUrl();
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
        const sb = getSupabase();
        if (!sb || !file) return;
        sb.from('chord_finder_logs').insert([{
            file_name: file.name,
            file_size_kb: Math.round(file.size / 1024),
            detected_key: result.key || null,
            chord_count: result.chords?.length || 0,
            processing_time_ms: result.processing_time_ms || null,
        }]).then(() => {}).catch(() => {});
    } catch { /* never disrupt user flow */ }
}

// ---------------------------------------------------------------------------
// Chord cache — Supabase-backed, keyed by YouTube video_id
// ---------------------------------------------------------------------------
async function checkChordCache(videoId) {
    try {
        const sb = getSupabase();
        if (!sb) return null;
        const { data, error } = await sb
            .from('generated_chords')
            .select('chords')
            .eq('video_id', videoId)
            .maybeSingle();
        if (error || !data?.chords?.chords?.length) return null;
        console.log(`[Cache] Hit for ${videoId}`);
        return data.chords;
    } catch {
        return null;
    }
}

function storeChordCache(videoId, result) {
    try {
        const sb = getSupabase();
        if (!sb) return;
        sb.from('generated_chords')
            .upsert({
                video_id: videoId,
                chords: result,
                model_version: MODEL_VERSION,
                processing_time_ms: result.processing_time_ms || null,
            }, { onConflict: 'video_id' })
            .then(() => console.log(`[Cache] Stored for ${videoId}`))
            .catch(() => {});
    } catch { /* never disrupt user flow */ }
}
