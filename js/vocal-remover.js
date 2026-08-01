// Swaram Vocal Remover — js/vocal-remover.js
// Phase cancellation: vocals = (L+R)/2, instrumental = stereo side channels

const MAX_FILE_SIZE = 30 * 1024 * 1024;
const MAX_DURATION_SEC = 600;
const MIN_AUDIO_BYTES = 1024;

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
// Blob URLs are revoked on each new run to prevent memory leaks
let prevBlobUrls = [];

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
    document.getElementById('remove-btn')?.addEventListener('click', handleRemove);
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
async function handleRemove() {
    if (!selectedFile) {
        showError('Please upload an audio file first.');
        return;
    }
    hideError();
    showSection('progress-section');
    hideSection('results-section');
    setProgressBar(10);
    setStep('step-reading', 'active');

    try {
        const arrayBuffer = await selectedFile.arrayBuffer();
        setProgressBar(35);

        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        let audioBuffer;
        try {
            audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        } catch {
            throw new Error('Could not decode audio. Please try a different file format.');
        }

        if (audioBuffer.numberOfChannels < 2) {
            throw new Error('Stereo audio required. This file appears to be mono — vocal removal needs separate left and right channels.');
        }
        if (audioBuffer.duration > MAX_DURATION_SEC) {
            throw new Error('Audio too long. Please use files under 10 minutes.');
        }

        setStep('step-reading', 'done');
        setStep('step-separating', 'active');
        setProgressBar(60);

        const { vocalsBuffer, instrumentalBuffer } = separateStems(audioBuffer);

        setProgressBar(85);

        // Revoke previous blob URLs before creating new ones
        prevBlobUrls.forEach(u => URL.revokeObjectURL(u));
        prevBlobUrls = [];

        const vocalsBlob = audioBufferToWav(vocalsBuffer);
        const instrumentalBlob = audioBufferToWav(instrumentalBuffer);
        const vocalsUrl = URL.createObjectURL(vocalsBlob);
        const instrumentalUrl = URL.createObjectURL(instrumentalBlob);
        prevBlobUrls.push(vocalsUrl, instrumentalUrl);

        wireResults(vocalsUrl, instrumentalUrl, selectedFile.name);

        setStep('step-separating', 'done');
        setStep('step-done', 'done');
        setProgressBar(100);

        await audioCtx.close();

        setTimeout(() => {
            hideSection('progress-section');
            showSection('results-section');
        }, 400);

    } catch (err) {
        hideSection('progress-section');
        showError(err.message || 'Something went wrong. Please try a different file.');
    }
}

// ---------------------------------------------------------------------------
// Phase cancellation
// ---------------------------------------------------------------------------
function separateStems(audioBuffer) {
    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.getChannelData(1);
    const len = audioBuffer.length;
    const sr = audioBuffer.sampleRate;

    const vocalsData = new Float32Array(len);
    const instrL = new Float32Array(len);
    const instrR = new Float32Array(len);

    for (let i = 0; i < len; i++) {
        const center = (left[i] + right[i]) * 0.5;
        vocalsData[i] = center;
        instrL[i] = left[i] - center;
        instrR[i] = right[i] - center;
    }

    const offlineCtx = new OfflineAudioContext(1, len, sr);
    const vocalsBuffer = offlineCtx.createBuffer(1, len, sr);
    vocalsBuffer.copyToChannel(vocalsData, 0);

    const offlineCtx2 = new OfflineAudioContext(2, len, sr);
    const instrumentalBuffer = offlineCtx2.createBuffer(2, len, sr);
    instrumentalBuffer.copyToChannel(instrL, 0);
    instrumentalBuffer.copyToChannel(instrR, 1);

    return { vocalsBuffer, instrumentalBuffer };
}

// ---------------------------------------------------------------------------
// WAV encoder — pure DataView, no dependencies
// ---------------------------------------------------------------------------
function audioBufferToWav(buffer) {
    const numCh = buffer.numberOfChannels;
    const numSamples = buffer.length;
    const sampleRate = buffer.sampleRate;
    const byteCount = 44 + numSamples * numCh * 2;
    const ab = new ArrayBuffer(byteCount);
    const view = new DataView(ab);

    function writeStr(offset, str) {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }

    writeStr(0, 'RIFF');
    view.setUint32(4, byteCount - 8, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);        // PCM chunk size
    view.setUint16(20, 1, true);         // PCM format
    view.setUint16(22, numCh, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numCh * 2, true); // byte rate
    view.setUint16(32, numCh * 2, true); // block align
    view.setUint16(34, 16, true);        // bits per sample
    writeStr(36, 'data');
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
function wireResults(vocalsUrl, instrumentalUrl, originalName) {
    const base = originalName.replace(/\.[^.]+$/, '');

    const audioVocals = document.getElementById('audio-vocals');
    const dlVocals = document.getElementById('download-vocals');
    if (audioVocals) audioVocals.src = vocalsUrl;
    if (dlVocals) { dlVocals.href = vocalsUrl; dlVocals.download = base + '-vocals.wav'; }

    const audioInstr = document.getElementById('audio-instrumental');
    const dlInstr = document.getElementById('download-instrumental');
    if (audioInstr) audioInstr.src = instrumentalUrl;
    if (dlInstr) { dlInstr.href = instrumentalUrl; dlInstr.download = base + '-instrumental.wav'; }
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

function showSection(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
}

function hideSection(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
}

function showError(msg) {
    const errorSection = document.getElementById('error-section');
    const errorMsg = document.getElementById('error-message');
    if (errorMsg) errorMsg.textContent = msg;
    if (errorSection) errorSection.style.display = '';
}

function hideError() {
    hideSection('error-section');
}

function resetVocalRemover() {
    clearSelectedFile();
    hideSection('progress-section');
    hideSection('results-section');
    hideSection('error-section');
    setProgressBar(0);
    ['step-reading', 'step-separating', 'step-done'].forEach(id => setStep(id, ''));
    prevBlobUrls.forEach(u => URL.revokeObjectURL(u));
    prevBlobUrls = [];
    const audioVocals = document.getElementById('audio-vocals');
    const audioInstr = document.getElementById('audio-instrumental');
    if (audioVocals) audioVocals.src = '';
    if (audioInstr) audioInstr.src = '';
}
