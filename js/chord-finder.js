/**
 * Swaram Chord Finder — js/chord-finder.js
 *
 * Handles: file upload, backend API call (HuggingFace Spaces),
 * chord display, HTML5 audio playback sync, and transpose.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const API_ENDPOINT = window.SWARAM_API_ENDPOINT || 'https://vineethwilson-swaram-chord-service.hf.space/analyze';
const MAX_FILE_SIZE = 30 * 1024 * 1024; // 30 MB
const MAX_DURATION_SEC = 300; // 5 minutes — must match backend guardrail
const API_TIMEOUT_MS = 300_000; // 5 minutes
const API_RETRY_MAX = 2;
const SUPABASE_URL = 'https://jfnccekkhffonkjkmxyf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_KJA4VzMAjt2WVEEg0JKMfg_lDrABAZK';
const BASE_URL = 'https://ecoliving-tips.github.io';
const CHORD_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ALLOWED_UPLOAD_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.mp4', '.ogg', '.opus', '.flac', '.aac', '.wma', '.webm']);
const ALLOWED_UPLOAD_CONTENT_TYPES = new Set([
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/mp4',
    'audio/m4a',
    'audio/x-m4a',
    'audio/aac',
    'audio/x-aac',
    'audio/ogg',
    'audio/flac',
    'audio/x-flac',
    'audio/opus',
    'audio/webm',
    'video/mp4',
    'video/webm',
    'application/octet-stream',
]);

// Lazy Supabase singleton — created on first use, reused everywhere
let _supabaseClient = null;
function getSupabase() {
    if (!_supabaseClient && window.supabase) {
        _supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    }
    return _supabaseClient;
}

// ---------------------------------------------------------------------------
// YouTube metadata — oEmbed API (no key needed) for title/artist extraction
// ---------------------------------------------------------------------------

/** Fetch video title & channel name from YouTube oEmbed (free, no API key). */
async function fetchYouTubeMetadata(videoId) {
    try {
        const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const data = await resp.json();
        return { videoTitle: data.title || '', channelName: data.author_name || '' };
    } catch {
        return null;
    }
}

/**
 * Clean a YouTube video title for use as page title.
 * Minimal cleanup only — strip noise like "(Official Video)", hashtags,
 * and pipe-separated tags. Keep the rest as YouTube provides it.
 * Artist is always the channel name (most reliable source).
 */
function parseYouTubeTitle(videoTitle, channelName) {
    let title = videoTitle || '';
    const original = title;

    // Strip common noise suffixes
    const noise = [
        /\s*[\(\[](?:official\s*(?:(?:music|lyric(?:s|al)?)\s*)?video\s*(?:clip)?|official\s*(?:audio|video\s*clip|visuali[sz]er)|lyric(?:s|al)?\s*video|audio|hd|hq|full\s*song|4k|remastered|visuali[sz]er|with\s*lyrics)[\)\]]/gi,
        /\s*\|\s*(?:official\s*(?:(?:music|lyric(?:s|al)?)\s*)?video\s*(?:clip)?|official\s*(?:audio|video\s*clip|visuali[sz]er)|lyric(?:s)?\s*video|audio|hd|hq|full\s*song)\s*$/gi,
        /\s*#\w+/g,
        /\s*[-–—]\s*(?:official\s*(?:(?:music|lyric(?:s|al)?)\s*)?video\s*(?:clip)?|official\s*(?:audio|video\s*clip|visuali[sz]er)|lyric(?:s|al)?\s*video|audio|hd|hq|4k|remastered)\s*$/gi,
        /\s+(?:official\s+(?:(?:music|lyric(?:s|al)?)\s+)?video\s*(?:clip)?|official\s+(?:audio|video\s*clip|visuali[sz]er)|lyric(?:s|al)?\s+video)\s*$/gi,
        /^(?:(?:official\s+(?:(?:music|lyric(?:s|al)?)\s+)?video\s*(?:clip)?\s*[-–—:]\s*)|(?:lyric(?:s|al)?\s+video\s+))/gi,
    ];
    for (const re of noise) title = title.replace(re, '');

    // Strip pipe-separated tags (context, album info, etc.)
    const pipeIdx = title.indexOf(' | ');
    if (pipeIdx > 0) title = title.substring(0, pipeIdx);
    title = title.trim();

    // Second pass: catch noise now exposed at end after pipe stripping
    for (const re of [noise[3], noise[4]]) title = title.replace(re, '');
    title = title.trim();

    // Channel name as artist — strip YouTube's " - Topic" auto-suffix
    const artist = (channelName || 'Unknown Artist').replace(/\s*-\s*Topic$/i, '');

    return { artist, title: title || original };
}

/** Generate a URL-safe slug from title + artist. Falls back to videoId for non-Latin titles. */
function generateSlug(title, artist, videoId) {
    const slugify = (s) => (s || '')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

    let slug = slugify(title);
    const artistSlug = slugify(artist);

    // Append artist if not already part of the title slug (prevents collisions)
    if (slug && artistSlug && !slug.includes(artistSlug)) {
        slug = slug + '-' + artistSlug;
    }

    return slug || videoId || 'unknown';
}

// ---------------------------------------------------------------------------
// YouTube audio extraction — client-side fallback cascade (Piped → Cobalt)
// Used when server-side extraction fails (e.g., Piped 500 on specific videos).
// Runs from the user's browser IP — avoids cloud IP blocking by YouTube.
// ---------------------------------------------------------------------------
const PIPED_INSTANCES = [
    'https://api.piped.private.coffee', // Official instance (Apr 2026)
    'https://pipedapi.wireway.ch',      // Unofficial — may have intermittent audio 502s
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

// Now Playing Panel state (persisted in localStorage)
let nppMode = localStorage.getItem('swaram-npp-mode') || 'diagram';
let nppInstrument = localStorage.getItem('swaram-npp-instrument') || 'guitar';
let youtubeVideoId = null;   // Extracted YouTube video ID (when using URL input)
let ytPlayer = null;         // YouTube IFrame Player instance
let ytSyncInterval = null;   // Interval ID for YouTube chord sync

function trackAnalyticsEvent(name, parameters = {}) {
    if (typeof window.gtag === 'function') {
        window.gtag('event', name, parameters);
    }
}

// Beginner mode state
let beginnerMode = false;
let capoPosition = 0;        // auto-computed capo for beginner mode
let difficultyLevel = '';     // 'easy' | 'moderate' | 'advanced'

// ---------------------------------------------------------------------------
// Beginner mode — delegates to ChordUtils (js/chord-utils.js)
// ---------------------------------------------------------------------------

function simplifyChord(chord) { return ChordUtils.simplifyChord(chord); }
function findOptimalCapo(chords) { return ChordUtils.findOptimalCapo(chords, currentTranspose); }
function computeDifficulty(chords, capo) { return ChordUtils.computeDifficulty(chords, capo, currentTranspose); }
function getDisplayChord(rawChord) { return ChordUtils.getDisplayChord(rawChord, beginnerMode, capoPosition, currentTranspose); }

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
            ? `Capo ${capoPosition}`
            : 'No Capo';
    }

    if (diffEl) {
        const labels = { easy: 'Easy', moderate: 'Moderate', advanced: 'Advanced' };
        diffEl.textContent = labels[difficultyLevel] || difficultyLevel;
        diffEl.className = 'meta-badge beginner-difficulty difficulty-' + difficultyLevel;
    }
}

// Note and chord constants — delegated to ChordUtils
const NOTES = ChordUtils.NOTES;
const FLAT_MAP = ChordUtils.FLAT_MAP;

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', function () {
    setupEventListeners();
    warmUpServer();
    initNowPlayingPanel();
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
    const lowerName = (file.name || '').toLowerCase();
    const extMatch = lowerName.match(/\.[a-z0-9]+$/);
    const ext = extMatch ? extMatch[0] : '';
    const normalizedType = (file.type || '').split(';', 1)[0].trim().toLowerCase();

    if (ext && !ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
        showError('Unsupported file type. Please use MP3, WAV, M4A, MP4, OGG, OPUS, FLAC, AAC, WMA, or WebM.');
        return;
    }

    if (normalizedType && !ALLOWED_UPLOAD_CONTENT_TYPES.has(normalizedType)) {
        showError(`Unsupported media type (${file.type}). Please upload a valid audio file.`);
        return;
    }

    if (file.size < MIN_AUDIO_BYTES) {
        showError('File is too small or incomplete. Please upload a valid audio file.');
        return;
    }

    if (file.size > MAX_FILE_SIZE) {
        showError(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max: 30MB.`);
        return;
    }
    selectedFile = file;
    trackAnalyticsEvent('audio_file_selected', {
        feature: 'chord_finder',
        file_extension: ext || 'unknown',
    });
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
    const raw = url.trim();
    const idRegex = /^[A-Za-z0-9_-]{11}$/;
    if (idRegex.test(raw)) return raw;

    let parsed;
    try {
        parsed = new URL(raw);
    } catch {
        return null;
    }

    const host = parsed.hostname.toLowerCase();
    const isYouTubeHost = host === 'youtube.com'
        || host === 'www.youtube.com'
        || host === 'm.youtube.com'
        || host === 'music.youtube.com'
        || host === 'youtu.be'
        || host === 'www.youtu.be';
    if (!isYouTubeHost) return null;

    let candidate = '';

    if (host === 'youtu.be' || host === 'www.youtu.be') {
        candidate = parsed.pathname.replace(/^\//, '').split('/')[0] || '';
    } else if (parsed.pathname.startsWith('/watch')) {
        candidate = parsed.searchParams.get('v') || '';
    } else if (parsed.pathname.startsWith('/embed/')) {
        candidate = parsed.pathname.split('/')[2] || '';
    } else if (parsed.pathname.startsWith('/shorts/')) {
        candidate = parsed.pathname.split('/')[2] || '';
    }

    return idRegex.test(candidate) ? candidate : null;
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

/**
 * Fetch audio from YouTube via client-side Piped cascade.
 * Runs from user's browser — their IP is not blocked by YouTube.
 * Returns: { blob: Blob, title: string, ext: string }
 */
async function fetchYouTubeAudio(videoId) {
    // Piped (with retry for transient 500s, multiple instances)
    const piped = await _tryPiped(videoId);
    if (piped) return piped;

    // All tiers exhausted
    throw new Error(
        'Could not fetch audio from YouTube. Please upload the audio file instead.'
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
        let settled = false;
        const cleanup = () => {
            URL.revokeObjectURL(url);
            audio.removeAttribute('src');
            audio.load();
        };
        const finish = (duration) => {
            if (settled) return;
            settled = true;
            resolve(Number.isFinite(duration) && duration > 0 ? duration : null);
            cleanup();
        };
        audio.onloadedmetadata = () => {
            // Some formats briefly report Infinity/NaN before settling.
            if (Number.isFinite(audio.duration) && audio.duration > 0) {
                finish(audio.duration);
                return;
            }
            setTimeout(() => finish(audio.duration), 250);
        };
        audio.ondurationchange = () => {
            if (Number.isFinite(audio.duration) && audio.duration > 0) {
                finish(audio.duration);
            }
        };
        audio.onerror = () => { finish(null); };
        // Safety timeout — some formats may not fire events
        setTimeout(() => { finish(null); }, 5000);
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
        showError('Please upload an audio file or paste a YouTube link.');
        return;
    }

    // Reset UI
    hideError();
    hideResults();
    showProgress();
    disableGenerateBtn(true);
    trackAnalyticsEvent('chord_analysis_started', {
        source: videoId ? 'youtube' : 'file',
    });

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
                        status.textContent = 'Fetching audio from your browser (this may take a moment)...';
                        status.classList.remove('error');
                    }

                    try {
                        const { blob, title, ext } = await fetchYouTubeAudio(videoId);
                        fileToUpload = new File([blob], `${title}${ext}`, { type: blob.type });
                        if (status) status.style.display = 'none';
                    } catch (clientErr) {
                        // Both server and client failed — show helpful error
                        if (status) {
                            status.textContent = 'Could not fetch audio from YouTube. Please download the audio and upload it instead.';
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

        // Cache store + metadata enrichment — YouTube URLs only (fire-and-forget)
        if (videoId) {
            // Fetch metadata in parallel — don't block results display
            fetchYouTubeMetadata(videoId).then(meta => {
                let metadata = null;
                if (meta) {
                    const parsed = parseYouTubeTitle(meta.videoTitle, meta.channelName);
                    const slug = generateSlug(parsed.title, parsed.artist, videoId);
                    metadata = {
                        title: parsed.title,
                        artist: parsed.artist,
                        slug,
                        youtubeTitle: meta.videoTitle,
                    };
                }
                storeChordCache(videoId, result, metadata);
            }).catch(() => {
                storeChordCache(videoId, result, null);
            });
        }

        setProgressStep('done');
        showResults();

    } catch (err) {
        console.error('Generate failed:', err);
        trackAnalyticsEvent('chord_analysis_failed', {
            source: videoId ? 'youtube' : 'file',
            error_type: err?._youtubeExtractionFailed ? 'youtube_extraction' : 'analysis',
        });
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

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function parseRetryAfterSeconds(resp) {
        const h = resp.headers.get('Retry-After');
        if (!h) return 0;
        const sec = Number(h);
        if (Number.isFinite(sec) && sec > 0) return sec;
        const at = Date.parse(h);
        if (Number.isFinite(at)) {
            return Math.max(1, Math.ceil((at - Date.now()) / 1000));
        }
        return 0;
    }

    function mapFriendlyError(status, detail, retryAfterSec) {
        if (status === 400) {
            if (detail === 'invalid_audio_file') {
                return 'Invalid audio file. Please upload a valid MP3/WAV/M4A/MP4/OGG/OPUS/FLAC/WebM file.';
            }
            return 'Invalid input. Please check file type, size, duration, or YouTube link and try again.';
        }
        if (status === 429) {
            if (retryAfterSec > 0) {
                return `Too many requests right now. Please wait about ${retryAfterSec} seconds and try again.`;
            }
            return 'Too many requests right now. Please wait a bit and try again.';
        }
        if (status === 502) {
            return 'Could not fetch audio from YouTube right now. Please try again, or upload an audio file directly.';
        }
        if (status === 503) {
            return 'Server is busy at the moment. Please wait and retry shortly.';
        }
        return 'Server error while generating chords. Please try again in a moment.';
    }

    for (let attempt = 0; attempt <= API_RETRY_MAX; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

        try {
            const resp = await fetch(API_ENDPOINT, {
                method: 'POST',
                body: formData,
                signal: controller.signal,
            });

            if (resp.ok) {
                return await resp.json();
            }

            const raw = await resp.text().catch(() => '');
            let body = null;
            try {
                body = raw ? JSON.parse(raw) : null;
            } catch {
                body = null;
            }

            const detail = body && typeof body.detail === 'string' ? body.detail : '';
            const retryAfterSec = parseRetryAfterSeconds(resp);

            // Detect server-side YouTube extraction failure → enables client-side fallback
            if (resp.status === 502 && detail === 'youtube_extraction_failed') {
                const err = new Error('youtube_extraction_failed');
                err._youtubeExtractionFailed = true;
                throw err;
            }

            const retryable = resp.status === 429 || resp.status === 503;
            if (retryable && attempt < API_RETRY_MAX) {
                const baseDelayMs = retryAfterSec > 0
                    ? retryAfterSec * 1000
                    : 1000 * Math.pow(2, attempt);
                await sleep(Math.min(baseDelayMs, 15_000));
                continue;
            }

            throw new Error(mapFriendlyError(resp.status, detail, retryAfterSec));
        } catch (err) {
            if (err && err._youtubeExtractionFailed) {
                throw err;
            }

            if (err && err.name === 'AbortError') {
                if (attempt < API_RETRY_MAX) {
                    await sleep(1000 * Math.pow(2, attempt));
                    continue;
                }
                throw new Error('Request timed out. The server may be busy. Please retry in a moment.');
            }

            // Network errors in browsers are usually TypeError.
            if (err instanceof TypeError && attempt < API_RETRY_MAX) {
                await sleep(1000 * Math.pow(2, attempt));
                continue;
            }

            throw err;
        } finally {
            clearTimeout(timeout);
        }
    }

    throw new Error('Could not reach the chord service. Please try again shortly.');
}

// ---------------------------------------------------------------------------
// Display results
// ---------------------------------------------------------------------------
function showResults() {
    hideProgress();
    const section = document.getElementById('results-section');
    if (section) section.style.display = '';
    trackAnalyticsEvent('chord_analysis_completed', {
        source: youtubeVideoId ? 'youtube' : 'file',
        chord_count: Array.isArray(chordData?.chords) ? chordData.chords.length : 0,
    });

    // Scroll to audio/YouTube player and position below sticky header
    if (section) {
        setTimeout(() => {
            const playerContainer = document.getElementById('audio-player-container') || document.getElementById('youtube-player-container');
            if (playerContainer && playerContainer.offsetParent) {
                playerContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
                section.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 100);
    }

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

        const chordNameEl = document.createElement('span');
        chordNameEl.className = 'chord-block-name';
        chordNameEl.textContent = chordName;
        block.appendChild(chordNameEl);

        if (showOriginal) {
            const originalEl = document.createElement('span');
            originalEl.className = 'chord-block-original';
            originalEl.textContent = originalChord;
            block.appendChild(originalEl);
        }

        const timeEl = document.createElement('span');
        timeEl.className = 'chord-block-time';
        timeEl.textContent = formatTime(event.time);
        block.appendChild(timeEl);

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
    audioPlayer.load(); // iOS Safari requires explicit load() for blob URLs

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
        updateNowPlayingPanel(-3);
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
    if (audioPlayer.paused) {
        const p = audioPlayer.play();
        if (p && p.catch) p.catch(() => {}); // iOS may reject without user gesture
    } else {
        audioPlayer.pause();
    }
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
            playerVars: { autoplay: 0, modestbranding: 1, rel: 0, playsinline: 1, origin: window.location.origin },
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
        updateNowPlayingPanel(-3);
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

// ---------------------------------------------------------------------------
// Now Playing Panel — real-time chord diagrams during playback
// ---------------------------------------------------------------------------
function initNowPlayingPanel() {
    const modeToggle = document.getElementById('npp-mode-toggle');
    const instrToggle = document.getElementById('npp-instrument-toggle');
    applyNppMode(nppMode);
    applyNppInstrument(nppInstrument);

    modeToggle?.addEventListener('click', e => {
        const btn = e.target.closest('[data-mode]');
        if (!btn) return;
        nppMode = btn.dataset.mode;
        localStorage.setItem('swaram-npp-mode', nppMode);
        applyNppMode(nppMode);
        if (lastActiveIdx >= 0) updateNowPlayingPanel(lastActiveIdx);
    });

    instrToggle?.addEventListener('click', e => {
        const btn = e.target.closest('[data-instrument]');
        if (!btn) return;
        nppInstrument = btn.dataset.instrument;
        localStorage.setItem('swaram-npp-instrument', nppInstrument);
        applyNppInstrument(nppInstrument);
        if (lastActiveIdx >= 0) updateNowPlayingPanel(lastActiveIdx);
    });
}

function applyNppMode(mode) {
    const panel = document.getElementById('now-playing-panel');
    if (!panel) return;
    panel.dataset.mode = mode;
    panel.querySelectorAll('#npp-mode-toggle .npp-btn').forEach(btn =>
        btn.classList.toggle('active', btn.dataset.mode === mode));
    const instrToggle = document.getElementById('npp-instrument-toggle');
    if (instrToggle) instrToggle.style.display = mode === 'diagram' ? 'flex' : 'none';
}

function applyNppInstrument(instrument) {
    document.querySelectorAll('#npp-instrument-toggle .npp-btn').forEach(btn =>
        btn.classList.toggle('active', btn.dataset.instrument === instrument));
}

function updateNowPlayingPanel(activeIdx) {
    const panel = document.getElementById('now-playing-panel');
    if (!panel || !chordData?.chords) return;
    const chords = chordData.chords;

    [
        { cls: 'current', offset: 0 },
        { cls: 'next',    offset: 1 },
        { cls: 'next2',   offset: 2 },
    ].forEach(({ cls, offset }) => {
        const idx = activeIdx + offset;
        const card = panel.querySelector(`.npp-card.${cls}`);
        if (!card) return;
        const nameEl = card.querySelector('.npp-chord-name');
        const diagramEl = card.querySelector('.npp-diagram');

        if (idx < 0 || idx >= chords.length) {
            nameEl.textContent = '—';
            if (diagramEl) diagramEl.innerHTML = '';
            return;
        }

        const chord = getDisplayChord(chords[idx].chord);
        nameEl.textContent = chord;

        if (nppMode === 'diagram' && diagramEl) {
            const lookupName = chord.includes('/') ? chord.split('/')[0] : chord;
            const normalized = lookupName.replace(/[()]/g, '').replace(/maj7$/, 'M7');
            const data = CHORD_DIAGRAMS[normalized];
            if (data) {
                diagramEl.innerHTML = nppInstrument === 'keyboard'
                    ? renderKeyboardSVG(data.keys)
                    : renderGuitarSVG(data.guitar);
            } else {
                diagramEl.innerHTML = '<span class="npp-no-diagram">?</span>';
            }
        } else if (diagramEl) {
            diagramEl.innerHTML = '';
        }
    });
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

    // Update now-playing diagram panel
    updateNowPlayingPanel(activeIdx);

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
    if (audioPlayer.paused) {
        const p = audioPlayer.play();
        if (p && p.catch) p.catch(() => {}); // iOS may reject
    }
}

// ---------------------------------------------------------------------------
// Transpose — delegates to ChordUtils
// ---------------------------------------------------------------------------
function transposeChord(chord, semitones) { return ChordUtils.transposeChord(chord, semitones); }

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
    if (section) {
        section.style.display = '';
        // Inject ins element after section is visible — push() on display:none causes availableWidth=0
        const adContainer = section.querySelector('.loading-ad-container');
        if (window.__swaramAdsReady && adContainer && !adContainer.querySelector('ins')) {
            const ins = document.createElement('ins');
            ins.className = 'adsbygoogle';
            ins.style.display = 'block';
            ins.setAttribute('data-ad-client', 'ca-pub-7438590583270235');
            ins.setAttribute('data-ad-slot', '7291819152');
            ins.setAttribute('data-ad-format', 'auto');
            ins.setAttribute('data-full-width-responsive', 'true');
            adContainer.appendChild(ins);
            (window.adsbygoogle = window.adsbygoogle || []).push({});
        }
    }
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
        btn.textContent = disabled ? 'Processing...' : 'Find Chords';
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
// Chord cache — localStorage (zero-egress) + Supabase fallback
// ---------------------------------------------------------------------------
function _lsCacheKey(videoId) { return `swaram-cc-${videoId}`; }

function _lsCacheGet(videoId) {
    try {
        const raw = localStorage.getItem(_lsCacheKey(videoId));
        if (!raw) return null;
        const { ts, data } = JSON.parse(raw);
        if (Date.now() - ts > CHORD_CACHE_TTL_MS) { localStorage.removeItem(_lsCacheKey(videoId)); return null; }
        return data;
    } catch { return null; }
}

function _lsCacheSet(videoId, data) {
    try { localStorage.setItem(_lsCacheKey(videoId), JSON.stringify({ ts: Date.now(), data })); } catch { /* storage full */ }
}

async function checkChordCache(videoId) {
    const local = _lsCacheGet(videoId);
    if (local) { console.log(`[Cache] localStorage hit for ${videoId}`); return local; }
    try {
        const sb = getSupabase();
        if (!sb) return null;
        const { data, error } = await sb
            .from('generated_chords')
            .select('chords')
            .eq('video_id', videoId)
            .maybeSingle();
        if (error || !data?.chords?.chords?.length) return null;
        console.log(`[Cache] Supabase hit for ${videoId}`);
        _lsCacheSet(videoId, data.chords); // warm localStorage so next hit skips Supabase
        return data.chords;
    } catch {
        return null;
    }
}

function storeChordCache(videoId, result, metadata) {
    _lsCacheSet(videoId, result);
    try {
        const sb = getSupabase();
        if (!sb) return;
        // Only store columns the build pipeline reads; skip processing_time_ms / model_version
        const row = { video_id: videoId, chords: result };
        if (metadata) {
            row.title = metadata.title || null;
            row.artist = metadata.artist || null;
            row.slug = metadata.slug || null;
            row.youtube_title = metadata.youtubeTitle || null;
        }
        sb.from('generated_chords')
            .upsert(row, { onConflict: 'video_id' })
            .then(() => console.log(`[Cache] Stored for ${videoId}${metadata?.slug ? ` (slug: ${metadata.slug})` : ''}`))
            .catch(() => {});
    } catch { /* never disrupt user flow */ }
}
