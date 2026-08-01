// Swaram Stem Separator & Vocal Remover
// AI mode: POST /separate -> Demucs htdemucs (4 stems + instrumental)
// Fallback: phase cancellation (browser-side, instrumental only)

const SEPARATE_API_ENDPOINT = window.SWARAM_STEM_API_ENDPOINT
    || 'https://vineethwilson-swaram-chord-service.hf.space';
// Demucs on 2-core CPU takes 6-10 min; give generous headroom
const API_TIMEOUT_MS = 1_250_000;

const MAX_FILE_SIZE = 30 * 1024 * 1024;
const MIN_AUDIO_BYTES = 1024;
const MAX_FALLBACK_DURATION_SEC = 600;

const ALLOWED_UPLOAD_EXTENSIONS = new Set([
    '.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac', '.webm',
]);
const ALLOWED_UPLOAD_CONTENT_TYPES = new Set([
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav',
    'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/x-aac',
    'audio/ogg', 'audio/flac', 'audio/x-flac', 'audio/webm',
    'application/octet-stream',
]);

let selectedFile = null;
let prevBlobUrls = [];
let fakeProgressTimer = null;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', function () {
    const uploadArea = document.getElementById('upload-area');
    if (uploadArea) {
        uploadArea.addEventListener('click', () => document.getElementById('file-input')?.click());
        uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
        uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
        uploadArea.addEventListener('drop', handleFileDrop);
    }
    document.getElementById('file-input')?.addEventListener('change', handleFileSelect);
    document.getElementById('file-remove')?.addEventListener('click', clearSelectedFile);
    document.getElementById('remove-btn')?.addEventListener('click', handleSeparate);
});

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
        showError('Unsupported file type. Please use MP3, WAV, M4A, OGG, FLAC, AAC, or WebM.');
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
        showError(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max: 30 MB.`);
        return;
    }
    selectedFile = file;
    const nameEl = document.getElementById('file-name');
    const selectedEl = document.getElementById('selected-file');
    if (nameEl) nameEl.textContent = file.name;
    if (selectedEl) selectedEl.style.display = 'flex';
    document.getElementById('upload-area').style.display = 'none';
    hideError();
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
// Main handler
// ---------------------------------------------------------------------------
async function handleSeparate() {
    if (!selectedFile) { showError('Please upload an audio file first.'); return; }
    hideError();
    showSection('progress-section');
    hideSection('results-section');
    resetStemCards();
    prevBlobUrls.forEach(u => URL.revokeObjectURL(u));
    prevBlobUrls = [];

    setProgressBar(5);
    setStep('step-reading', 'active');
    setStep('step-separating', '');
    setStep('step-done', '');

    try {
        setProgressBar(10);
        setStep('step-reading', 'done');
        setStep('step-separating', 'active');

        // Fake progress from 10->85 over 10 min (typical Demucs CPU time)
        fakeProgressTimer = setInterval(() => {
            const bar = document.getElementById('progress-bar');
            if (!bar) return;
            const cur = parseFloat(bar.style.width) || 10;
            if (cur < 85) bar.style.width = (cur + 0.125) + '%';
        }, 1000);

        let apiData = null;
        let usedFallback = false;

        try {
            apiData = await callSeparateAPI(selectedFile);
        } catch {
            usedFallback = true;
        }

        clearInterval(fakeProgressTimer);
        fakeProgressTimer = null;
        setProgressBar(90);
        setStep('step-separating', 'done');

        const originalUrl = URL.createObjectURL(selectedFile);
        prevBlobUrls.push(originalUrl);
        wireCard('original', originalUrl, selectedFile.name);

        if (apiData) {
            const mime = apiData.mime || 'audio/mpeg';
            const ext = mime.includes('mpeg') ? '.mp3' : '.wav';
            const base = selectedFile.name.replace(/\.[^.]+$/, '');
            for (const key of ['vocals', 'drums', 'bass', 'other', 'instrumental']) {
                const url = b64ToObjectUrl(apiData[key], mime);
                prevBlobUrls.push(url);
                wireCard(key, url, `${base}-${key}${ext}`);
            }
            setQualityNote('ai');
        } else {
            // Phase cancellation fallback — instrumental only
            const instrUrl = await phaseInstrumental(selectedFile);
            if (instrUrl) {
                prevBlobUrls.push(instrUrl);
                const base = selectedFile.name.replace(/\.[^.]+$/, '');
                wireCard('instrumental', instrUrl, `${base}-instrumental.wav`);
            }
            disableStemCards(['vocals', 'drums', 'bass', 'other']);
            setQualityNote('fallback');
        }

        setProgressBar(100);
        setStep('step-done', 'done');

        setTimeout(() => {
            hideSection('progress-section');
            showSection('results-section');
        }, 400);

    } catch (err) {
        clearInterval(fakeProgressTimer);
        fakeProgressTimer = null;
        hideSection('progress-section');
        showError(err.message || 'Something went wrong. Please try a different file.');
    }
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
async function callSeparateAPI(file) {
    const formData = new FormData();
    formData.append('file', file);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    try {
        const resp = await fetch(`${SEPARATE_API_ENDPOINT}/separate`, {
            method: 'POST',
            body: formData,
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json();
    } catch (err) {
        clearTimeout(timeoutId);
        throw err;
    }
}

// ---------------------------------------------------------------------------
// Phase cancellation fallback
// ---------------------------------------------------------------------------
async function phaseInstrumental(file) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        await audioCtx.close();
        if (audioBuffer.numberOfChannels < 2 || audioBuffer.duration > MAX_FALLBACK_DURATION_SEC) return null;

        const left = audioBuffer.getChannelData(0);
        const right = audioBuffer.getChannelData(1);
        const len = audioBuffer.length;
        const sr = audioBuffer.sampleRate;
        const iL = new Float32Array(len);
        const iR = new Float32Array(len);
        for (let i = 0; i < len; i++) {
            const c = (left[i] + right[i]) * 0.5;
            iL[i] = (left[i] - c) * 2;
            iR[i] = (right[i] - c) * 2;
        }
        const ctx = new OfflineAudioContext(2, len, sr);
        const buf = ctx.createBuffer(2, len, sr);
        buf.copyToChannel(iL, 0);
        buf.copyToChannel(iR, 1);
        return URL.createObjectURL(audioBufferToWav(buf));
    } catch { return null; }
}

// ---------------------------------------------------------------------------
// WAV encoder
// ---------------------------------------------------------------------------
function audioBufferToWav(buffer) {
    const numCh = buffer.numberOfChannels;
    const numSamples = buffer.length;
    const sr = buffer.sampleRate;
    const byteCount = 44 + numSamples * numCh * 2;
    const ab = new ArrayBuffer(byteCount);
    const view = new DataView(ab);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); view.setUint32(4, byteCount - 8, true);
    ws(8, 'WAVE'); ws(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, numCh, true); view.setUint32(24, sr, true);
    view.setUint32(28, sr * numCh * 2, true); view.setUint16(32, numCh * 2, true);
    view.setUint16(34, 16, true); ws(36, 'data');
    view.setUint32(40, numSamples * numCh * 2, true);
    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
        for (let ch = 0; ch < numCh; ch++) {
            const s = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            offset += 2;
        }
    }
    return new Blob([ab], { type: 'audio/wav' });
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
function b64ToObjectUrl(b64, mime) {
    const bytes = atob(b64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return URL.createObjectURL(new Blob([arr], { type: mime }));
}

function wireCard(key, url, downloadName) {
    const audio = document.getElementById(`audio-${key}`);
    const dl = document.getElementById(`download-${key}`);
    if (audio) audio.src = url;
    if (dl) { dl.href = url; if (downloadName) dl.download = downloadName; }
}

function resetStemCards() {
    for (const key of ['original', 'vocals', 'drums', 'bass', 'other', 'instrumental']) {
        const audio = document.getElementById(`audio-${key}`);
        const dl = document.getElementById(`download-${key}`);
        const card = document.getElementById(`stem-card-${key}`);
        if (audio) audio.src = '';
        if (dl) dl.href = '';
        if (card) card.classList.remove('stem-card-disabled');
    }
}

function disableStemCards(keys) {
    for (const key of keys) {
        const card = document.getElementById(`stem-card-${key}`);
        if (card) card.classList.add('stem-card-disabled');
    }
}

function setQualityNote(mode) {
    const note = document.getElementById('quality-note');
    if (!note) return;
    if (mode === 'ai') {
        note.textContent = 'AI-powered 4-stem separation using Demucs \u2014 works on any stereo recording.';
    } else {
        note.textContent = 'Browser fallback mode \u2014 AI server unavailable. Drums, bass & other stems require AI processing.';
    }
}

function setStep(id, state) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('active', 'done');
    if (state) el.classList.add(state);
}

function setProgressBar(pct) {
    const bar = document.getElementById('progress-bar');
    if (bar) bar.style.width = pct + '%';
}

function showSection(id) { const el = document.getElementById(id); if (el) el.style.display = ''; }
function hideSection(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }

function showError(msg) {
    const s = document.getElementById('error-section');
    const m = document.getElementById('error-message');
    if (m) m.textContent = msg;
    if (s) s.style.display = '';
}

function hideError() { hideSection('error-section'); }

function resetVocalRemover() {
    clearSelectedFile();
    if (fakeProgressTimer) { clearInterval(fakeProgressTimer); fakeProgressTimer = null; }
    hideSection('progress-section');
    hideSection('results-section');
    hideSection('error-section');
    setProgressBar(0);
    ['step-reading', 'step-separating', 'step-done'].forEach(id => setStep(id, ''));
    prevBlobUrls.forEach(u => URL.revokeObjectURL(u));
    prevBlobUrls = [];
    resetStemCards();
}
