// Karaoke-only AI processing; comparison and trimming stay in the browser.
const KARAOKE_API = window.SWARAM_KARAOKE_API_ENDPOINT
    || window.SWARAM_STEM_API_ENDPOINT
    || 'https://vineethwilson-swaram-chord-service.hf.space';
const API_TIMEOUT_MS = 3_660_000;
const MAX_FILE_SIZE = 30 * 1024 * 1024;
const MAX_DURATION_SEC = 480;
const UPLOAD_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'webm']);
const UPLOAD_TYPES = new Set([
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/mp4',
    'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/x-aac', 'audio/ogg',
    'audio/flac', 'audio/x-flac', 'audio/webm', 'application/octet-stream',
]);
let selectedFile = null;
let requestController = null;
let audioContext = null;
let buffers = null;
let sources = [];
let gains = {};
let playing = false;
let position = 0;
let startedAt = 0;
let duration = 0;
let trimStart = 0;
let trimEnd = 0;
let animationFrame = null;
let elapsedTimer = null;
let downloadUrl = null;
let waveformPeaks = [];

const byId = id => document.getElementById(id);
function trackEvent(name, parameters = {}) {
    if (typeof window.gtag === 'function') {
        window.gtag('event', name, { feature: 'vocal_remover', ...parameters });
    }
}
function formatTime(seconds) {
    return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
function validateUpload(file) {
    const extension = file.name.split('.').pop().toLowerCase();
    if (!UPLOAD_EXTENSIONS.has(extension)) {
        throw new Error('Please choose an MP3, WAV, M4A, OGG, FLAC, AAC, or WebM audio file.');
    }
    const type = file.type.split(';')[0].trim().toLowerCase();
    if (type && !UPLOAD_TYPES.has(type)) throw new Error('Please upload a valid audio file.');
    if (file.size < 1024) throw new Error('This file is too small or incomplete.');
    if (file.size > MAX_FILE_SIZE) throw new Error('The file exceeds 30 MB. Choose a smaller audio file.');
}
function showError(message) {
    byId('error-message').textContent = message;
    byId('error-section').hidden = false;
}
function selectFile(file) {
    if (requestController) return;
    try {
        validateUpload(file);
        selectedFile = file;
        byId('file-name').textContent = file.name;
        byId('selected-file').hidden = false;
        byId('error-section').hidden = true;
        clearResults();
        trackEvent('audio_file_selected', { file_extension: file.name.split('.').pop().toLowerCase() });
    } catch (error) {
        showError(error.message);
    }
}
function clearFile() {
    if (requestController) return;
    selectedFile = null;
    byId('file-input').value = '';
    byId('selected-file').hidden = true;
    clearResults();
}
function releaseDownload() {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = null;
}
function clearResults() {
    pausePlayback();
    buffers = null;
    waveformPeaks = [];
    position = duration = trimStart = trimEnd = 0;
    releaseDownload();
    byId('results-section').hidden = true;
}
function setBusy(busy) {
    for (const id of ['remove-btn', 'file-input', 'file-remove']) byId(id).disabled = busy;
    byId('upload-area').setAttribute('aria-disabled', String(busy));
    byId('progress-section').hidden = !busy;
    byId('cancel-btn').disabled = false;
}

async function requestKaraoke(file, signal) {
    const data = new FormData();
    data.append('file', file);
    const response = await fetch(`${KARAOKE_API}/karaoke`, { method: 'POST', body: data, signal });
    if (!response.ok) {
        const retry = Number(response.headers.get('Retry-After'));
        let detail = '';
        if (response.headers.get('Content-Type')?.includes('application/json')) {
            const body = await response.json();
            detail = typeof body.detail === 'string' ? body.detail : '';
        }
        if (response.status === 429 || detail === 'karaoke_busy') {
            throw new Error(`The free server is busy. Please retry${retry > 0 ? ` in ${retry} seconds` : ' later'}.`);
        }
        if (detail === 'karaoke_timeout') {
            throw new Error('Processing exceeded the server time limit. Try a shorter song.');
        }
        if (response.status === 400) {
            throw new Error(detail || 'The server could not read this audio. Try a valid MP3 or WAV file.');
        }
        throw new Error(`Karaoke processing is unavailable (HTTP ${response.status}). Please try again later.`);
    }
    if (!response.headers.get('Content-Type')?.startsWith('audio/wav')) {
        throw new Error('The server returned an unexpected output instead of a karaoke WAV.');
    }
    const audio = await response.arrayBuffer();
    if (audio.byteLength < 44) throw new Error('The server returned an empty karaoke track.');
    return audio;
}

async function handleRemove() {
    if (requestController) return;
    if (!selectedFile) { showError('Choose an audio file first.'); return; }
    const file = selectedFile;
    clearResults();
    byId('error-section').hidden = true;
    const controller = new AbortController();
    requestController = controller;
    setBusy(true);
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, API_TIMEOUT_MS);
    const start = Date.now();
    byId('progress-status').textContent = 'Reading your audio...';
    byId('sep-timer').textContent = '0:00 elapsed';
    elapsedTimer = setInterval(() => {
        byId('sep-timer').textContent = `${formatTime((Date.now() - start) / 1000)} elapsed`;
    }, 1000);
    trackEvent('vocal_separation_started');
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) throw new Error('Your browser does not support audio processing. Try a current Chrome, Firefox, or Safari browser.');
        if (!audioContext) audioContext = new AudioContextClass();
        const original = await audioContext.decodeAudioData(await file.arrayBuffer());
        if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        if (!Number.isFinite(original.duration) || original.duration <= 0) {
            throw new Error('This audio file has no playable duration.');
        }
        if (original.duration > MAX_DURATION_SEC) throw new Error('Maximum song length is 8 minutes. Choose a shorter file.');
        byId('progress-status').textContent = 'Uploading and removing vocals with AI. Keep this tab open.';
        const wav = await requestKaraoke(file, controller.signal);
        byId('progress-status').textContent = 'Preparing your karaoke player...';
        const instrumental = await audioContext.decodeAudioData(wav);
        if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        if (!instrumental.length || instrumental.numberOfChannels !== 2) {
            throw new Error('The karaoke output is not a valid stereo track. Please retry.');
        }
        if (Math.abs(original.duration - instrumental.duration) > 1) {
            throw new Error('The karaoke track does not match the original duration. Please retry.');
        }
        buffers = { original, instrumental };
        duration = Math.floor(Math.min(original.duration, instrumental.duration) * 100) / 100;
        if (duration < 0.1) throw new Error('This audio is too short to preview or trim.');
        trimStart = position = 0;
        trimEnd = duration;
        byId('seek').max = String(duration);
        byId('trim-start').value = '0';
        byId('trim-end').value = duration.toFixed(2);
        for (const id of ['trim-start', 'trim-end']) byId(id).max = String(duration);
        byId('mute-original').checked = true;
        byId('mute-instrumental').checked = false;
        byId('volume-original').value = byId('volume-instrumental').value = '1';
        waveformPeaks = [original, instrumental].map(buffer => getWaveformPeaks(buffer, 240));
        byId('results-section').hidden = false;
        updateTimeline();
        byId('result-status').textContent = 'Your karaoke track is ready. Preview it or download the full song.';
        trackEvent('vocal_separation_completed', { mode: 'ai', processing_seconds: Math.round((Date.now() - start) / 1000) });
    } catch (error) {
        clearResults();
        if (error.name === 'AbortError' && !timedOut) {
            byId('result-status').textContent = 'Stopped waiting. The server may still finish the current job.';
            trackEvent('karaoke_cancelled');
        } else {
            console.error('[Karaoke]', error);
            showError(timedOut ? 'Processing took too long. Please try a shorter file later.'
                : error.message || 'Could not process this audio. Please try again.');
            trackEvent('vocal_separation_failed', { error_type: timedOut ? 'timeout' : 'processing' });
        }
    } finally {
        clearTimeout(timeout);
        clearInterval(elapsedTimer);
        elapsedTimer = null;
        requestController = null;
        setBusy(false);
    }
}

function currentPosition() {
    return playing ? Math.min(trimEnd, position + audioContext.currentTime - startedAt) : position;
}
function pausePlayback() {
    if (playing) position = currentPosition();
    playing = false;
    for (const source of sources) source.stop();
    sources = [];
    for (const gain of Object.values(gains)) gain.disconnect();
    gains = {};
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
    byId('play-btn').textContent = 'Play comparison';
    byId('player').classList.remove('is-playing');
}
async function startPlayback() {
    if (!buffers || playing) return;
    try {
        await audioContext.resume();
        if (!buffers || playing) return;
        if (position < trimStart || position >= trimEnd) position = trimStart;
        // Both buffers start on the same audio clock, so muting never drifts.
        startedAt = audioContext.currentTime + 0.03;
        for (const key of ['original', 'instrumental']) {
            const source = audioContext.createBufferSource();
            const gain = audioContext.createGain();
            source.buffer = buffers[key];
            source.connect(gain);
            gain.connect(audioContext.destination);
            gains[key] = gain;
            source.start(startedAt, position, trimEnd - position);
            sources.push(source);
        }
        playing = true;
        updateMix();
        byId('play-btn').textContent = 'Pause';
        byId('player').classList.add('is-playing');
        animatePlayback();
        trackEvent('karaoke_preview_played');
    } catch (error) {
        pausePlayback();
        console.error('[Karaoke playback]', error);
        showError('Playback could not start. Please try again.');
    }
}
function updateMix() {
    const levels = {};
    for (const key of ['original', 'instrumental']) {
        levels[key] = byId(`mute-${key}`).checked ? 0 : Number(byId(`volume-${key}`).value);
    }
    // Leave headroom when the original and backing track are audible together.
    const divisor = Math.max(1, levels.original + levels.instrumental);
    for (const key of Object.keys(gains)) {
        gains[key].gain.setTargetAtTime(levels[key] / divisor, audioContext.currentTime, 0.015);
    }
}
function animatePlayback() {
    updateTimeline();
    if (currentPosition() >= trimEnd) {
        pausePlayback();
        position = trimStart;
        updateTimeline();
        return;
    }
    animationFrame = requestAnimationFrame(animatePlayback);
}
function updateTimeline() {
    const time = Math.max(0, currentPosition());
    byId('seek').value = String(time);
    byId('seek').setAttribute('aria-valuetext', `${formatTime(time)} of ${formatTime(duration)}`);
    byId('playback-time').textContent = `${formatTime(time)} / ${formatTime(duration)}`;
    byId('trim-duration').textContent = `Download length: ${(trimEnd - trimStart).toFixed(2)} seconds`;
    drawWaveform(time);
}
function getTrimRange(start, end, total) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > total
        || end <= start || end - start < 0.1) {
        throw new Error('Set a start and end within the song, with at least 0.1 seconds selected.');
    }
    return { start, end };
}
function applyTrim() {
    if (!buffers) return false;
    try {
        if (!byId('trim-start').value.trim() || !byId('trim-end').value.trim()) {
            throw new Error('Enter both a start and an end time.');
        }
        const range = getTrimRange(Number(byId('trim-start').value), Number(byId('trim-end').value), duration);
        const resume = playing;
        pausePlayback();
        trimStart = range.start;
        trimEnd = range.end;
        position = Math.max(trimStart, Math.min(position, trimEnd));
        byId('trim-error').textContent = '';
        releaseDownload();
        updateTimeline();
        if (resume) startPlayback();
        return true;
    } catch (error) {
        byId('trim-error').textContent = error.message;
        return false;
    }
}
function getWaveformPeaks(buffer, count) {
    const data = buffer.getChannelData(0);
    const peaks = [];
    for (let i = 0; i < count; i++) {
        const start = Math.floor(i * data.length / count);
        const end = Math.floor((i + 1) * data.length / count);
        let peak = 0;
        for (let sample = start; sample < end; sample++) peak = Math.max(peak, Math.abs(data[sample]));
        peaks.push(peak);
    }
    return peaks;
}
function drawWaveform(time) {
    if (!buffers) return;
    const canvas = byId('waveform');
    const width = canvas.clientWidth;
    if (!width) return;
    const height = 160;
    const ratio = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== height * ratio) {
        canvas.width = Math.round(width * ratio);
        canvas.height = height * ratio;
    }
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    waveformPeaks.forEach((peaks, row) => {
        context.fillStyle = row === 0 ? '#9AAABD' : '#86D8CA';
        peaks.forEach((peak, i) => {
            const barHeight = Math.max(2, peak * 55);
            context.fillRect(i * width / peaks.length, 42 + row * 78 - barHeight / 2,
                Math.max(1, width / peaks.length - 1), barHeight);
        });
    });
    context.fillStyle = 'rgba(12,17,22,0.75)';
    context.fillRect(0, 0, trimStart / duration * width, height);
    context.fillRect(trimEnd / duration * width, 0, width, height);
    context.strokeStyle = '#F2BD67';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(time / duration * width, 0);
    context.lineTo(time / duration * width, height);
    context.stroke();
}
function encodeTrimmedWav(buffer, start, end) {
    const range = getTrimRange(start, end, buffer.duration);
    const first = Math.floor(range.start * buffer.sampleRate);
    const last = Math.min(buffer.length, Math.floor(range.end * buffer.sampleRate));
    const frames = last - first;
    const channels = buffer.numberOfChannels;
    const bytesPerFrame = channels * 3;
    const dataSize = frames * bytesPerFrame;
    const padding = dataSize % 2;
    const view = new DataView(new ArrayBuffer(44 + dataSize + padding));
    function text(offset, value) {
        for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    }
    text(0, 'RIFF'); view.setUint32(4, 36 + dataSize + padding, true);
    text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, channels, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * bytesPerFrame, true);
    view.setUint16(32, bytesPerFrame, true); view.setUint16(34, 24, true);
    text(36, 'data'); view.setUint32(40, dataSize, true);
    const data = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
    let offset = 44;
    for (let frame = first; frame < last; frame++) {
        for (let channel = 0; channel < channels; channel++) {
            const sample = Math.max(-1, Math.min(1, data[channel][frame]));
            const value = Math.round(sample * (sample < 0 ? 0x800000 : 0x7FFFFF));
            view.setUint8(offset++, value & 0xFF);
            view.setUint8(offset++, (value >> 8) & 0xFF);
            view.setUint8(offset++, (value >> 16) & 0xFF);
        }
    }
    return new Blob([view.buffer], { type: 'audio/wav' });
}
function downloadKaraoke() {
    if (!buffers || !applyTrim()) return;
    try {
        releaseDownload();
        downloadUrl = URL.createObjectURL(encodeTrimmedWav(buffers.instrumental, trimStart, trimEnd));
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = `${selectedFile.name.replace(/\.[^.]+$/, '')}-karaoke.wav`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        trackEvent('karaoke_downloaded', { trimmed: trimStart > 0 || trimEnd < duration, format: 'wav' });
    } catch (error) {
        console.error('[Karaoke download]', error);
        showError('Could not prepare the WAV download. Try a shorter selection.');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const upload = byId('upload-area');
    upload.addEventListener('click', () => { if (!requestController) byId('file-input').click(); });
    upload.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (!requestController) byId('file-input').click();
        }
    });
    upload.addEventListener('dragover', event => {
        event.preventDefault();
        if (!requestController) upload.classList.add('drag-over');
    });
    upload.addEventListener('dragleave', () => upload.classList.remove('drag-over'));
    upload.addEventListener('drop', event => {
        event.preventDefault();
        upload.classList.remove('drag-over');
        if (event.dataTransfer.files[0]) selectFile(event.dataTransfer.files[0]);
    });
    byId('file-input').addEventListener('change', event => {
        if (event.target.files[0]) selectFile(event.target.files[0]);
    });
    byId('file-remove').addEventListener('click', clearFile);
    byId('remove-btn').addEventListener('click', handleRemove);
    byId('cancel-btn').addEventListener('click', () => requestController?.abort());
    byId('play-btn').addEventListener('click', () => {
        if (playing) { pausePlayback(); updateTimeline(); } else startPlayback();
    });
    byId('seek').addEventListener('input', event => {
        const resume = playing;
        pausePlayback();
        position = Math.max(trimStart, Math.min(Number(event.target.value), trimEnd));
        updateTimeline();
        if (resume) startPlayback();
    });
    for (const key of ['original', 'instrumental']) {
        byId(`mute-${key}`).addEventListener('change', updateMix);
        byId(`volume-${key}`).addEventListener('input', updateMix);
    }
    for (const id of ['trim-start', 'trim-end']) byId(id).addEventListener('change', applyTrim);
    byId('reset-trim').addEventListener('click', () => {
        byId('trim-start').value = '0';
        byId('trim-end').value = String(duration);
        applyTrim();
    });
    byId('download-instrumental').addEventListener('click', downloadKaraoke);
    window.addEventListener('resize', () => drawWaveform(currentPosition()));
    window.addEventListener('pagehide', () => {
        requestController?.abort();
        pausePlayback();
        releaseDownload();
    });
});
