/**
 * chord-page-player.js — Interactive YouTube-synced chord player for /chords/{slug}/ pages.
 * Expects window.CHORD_DATA (array of {chord, time, duration}) and window.YOUTUBE_VIDEO_ID.
 */
(function () {
    'use strict';

    const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const FLAT_MAP = { 'Db': 'C#', 'Eb': 'D#', 'Fb': 'E', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#', 'Cb': 'B' };

    const chords = window.CHORD_DATA || [];
    const videoId = window.YOUTUBE_VIDEO_ID || '';

    let ytPlayer = null;
    let syncInterval = null;
    let currentTranspose = 0;
    let lastActiveIdx = -1;
    let cachedBlocks = null;
    let cachedCurrentEl = null;

    // ── Transpose ──

    function transposeChord(chord, semitones) {
        if (!chord || semitones === 0) return chord;
        if (chord.includes('/')) {
            const p = chord.split('/');
            return transposeChord(p[0], semitones) + '/' + transposeChord(p[1], semitones);
        }
        const m = chord.match(/^([A-G][#b]?)(.*)/);
        if (!m) return chord;
        let root = m[1];
        if (FLAT_MAP[root]) root = FLAT_MAP[root];
        const idx = NOTES.indexOf(root);
        if (idx < 0) return chord;
        return NOTES[((idx + semitones) % 12 + 12) % 12] + m[2];
    }

    function getDisplayChord(raw) {
        return transposeChord(raw, currentTranspose);
    }

    function applyTranspose(delta) {
        const next = currentTranspose + delta;
        if (next < -11 || next > 11) return;
        currentTranspose = next;
        document.getElementById('transpose-value').textContent = String(currentTranspose);
        renderTimeline();
        updateChordsUsed();
    }

    function updateChordsUsed() {
        const grid = document.getElementById('chords-used');
        if (!grid) return;
        const badges = grid.querySelectorAll('.chord-badge');
        badges.forEach(badge => {
            const orig = badge.dataset.original;
            if (orig) badge.textContent = getDisplayChord(orig);
        });
    }

    // ── Timeline rendering ──

    function formatTime(s) {
        if (s == null || isNaN(s)) return '0:00';
        return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
    }

    function renderTimeline() {
        const container = document.getElementById('chord-timeline');
        if (!container || !chords.length) return;
        container.innerHTML = '';

        chords.forEach((evt, idx) => {
            const block = document.createElement('div');
            block.className = 'chord-block';
            block.dataset.index = idx;
            block.dataset.time = evt.time;
            block.dataset.duration = evt.duration;
            block.style.minWidth = Math.max(60, Math.min(200, evt.duration * 50)) + 'px';

            const name = document.createElement('span');
            name.className = 'chord-block-name';
            name.textContent = getDisplayChord(evt.chord);
            block.appendChild(name);

            const time = document.createElement('span');
            time.className = 'chord-block-time';
            time.textContent = formatTime(evt.time);
            block.appendChild(time);

            block.addEventListener('click', () => seekTo(evt.time));
            container.appendChild(block);
        });

        cachedBlocks = container.querySelectorAll('.chord-block');
        cachedCurrentEl = document.getElementById('current-chord');
        lastActiveIdx = -1;
    }

    function seekTo(time) {
        if (ytPlayer && typeof ytPlayer.seekTo === 'function') {
            ytPlayer.seekTo(time, true);
        }
    }

    // ── Sync ──

    function findActiveChordIndex(time) {
        let lo = 0, hi = chords.length - 1, result = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (chords[mid].time <= time) { result = mid; lo = mid + 1; }
            else { hi = mid - 1; }
        }
        return result;
    }

    function updateChordSync() {
        if (!ytPlayer || typeof ytPlayer.getCurrentTime !== 'function') return;
        const time = ytPlayer.getCurrentTime();
        const activeIdx = findActiveChordIndex(time);
        if (activeIdx === lastActiveIdx) return;
        lastActiveIdx = activeIdx;

        if (cachedCurrentEl && activeIdx >= 0) {
            cachedCurrentEl.textContent = getDisplayChord(chords[activeIdx].chord);
        }

        if (cachedBlocks) {
            for (let i = 0; i < cachedBlocks.length; i++) {
                cachedBlocks[i].classList.toggle('active', i === activeIdx);
                cachedBlocks[i].classList.toggle('past', i < activeIdx);
            }
        }

        if (activeIdx >= 0 && cachedBlocks?.[activeIdx]) {
            cachedBlocks[activeIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    }

    function startSync() { if (!syncInterval) syncInterval = setInterval(updateChordSync, 100); }
    function stopSync() { clearInterval(syncInterval); syncInterval = null; }

    // ── YouTube IFrame API ──

    function onStateChange(event) {
        if (event.data === 1) startSync();       // PLAYING
        else if (event.data === 0 || event.data === 2) stopSync(); // ENDED or PAUSED
    }

    function initPlayer() {
        if (!videoId) return;
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);

        window.onYouTubeIframeAPIReady = function () {
            ytPlayer = new YT.Player('youtube-player', {
                videoId: videoId,
                playerVars: { rel: 0, modestbranding: 1 },
                events: { onStateChange: onStateChange },
            });
        };
    }

    // ── Init ──

    function init() {
        renderTimeline();
        initPlayer();

        // Transpose buttons
        const downBtn = document.getElementById('transpose-down');
        const upBtn = document.getElementById('transpose-up');
        const resetBtn = document.getElementById('transpose-reset');
        if (downBtn) downBtn.addEventListener('click', () => applyTranspose(-1));
        if (upBtn) upBtn.addEventListener('click', () => applyTranspose(1));
        if (resetBtn) resetBtn.addEventListener('click', () => { currentTranspose = 0; document.getElementById('transpose-value').textContent = '0'; renderTimeline(); updateChordsUsed(); });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
