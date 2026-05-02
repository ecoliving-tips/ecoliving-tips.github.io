/**
 * chord-page-player.js — Interactive YouTube-synced chord player for /chords/{slug}/ pages.
 * Expects window.CHORD_DATA (array of {chord, time, duration}), window.YOUTUBE_VIDEO_ID,
 * and optionally window.BEGINNER_META ({capo, difficulty}).
 * Requires: js/chord-utils.js loaded before this script.
 */
(function () {
    'use strict';

    var CU = window.ChordUtils;
    var chords = window.CHORD_DATA || [];
    var videoId = window.YOUTUBE_VIDEO_ID || '';
    var beginnerMeta = window.BEGINNER_META || { capo: 0, difficulty: 'easy' };

    var ytPlayer = null;
    var syncInterval = null;
    var currentTranspose = 0;
    var lastActiveIdx = -1;
    var cachedBlocks = null;
    var cachedCurrentEl = null;

    // Beginner mode state
    var beginnerMode = false;
    var capoPosition = 0;
    var difficultyLevel = '';

    // ── i18n helper ──

    function t(key) {
        try {
            if (typeof translations !== 'undefined' && typeof currentLang !== 'undefined') {
                return translations[currentLang] && translations[currentLang][key] || key;
            }
        } catch (e) { /* ignore */ }
        return key;
    }

    // ── Chord display ──

    function getDisplayChord(raw) {
        return CU.getDisplayChord(raw, beginnerMode, capoPosition, currentTranspose);
    }

    // ── Transpose ──

    function applyTranspose(delta) {
        var next = currentTranspose + delta;
        if (next < -11 || next > 11) return;
        currentTranspose = next;
        document.getElementById('transpose-value').textContent = String(currentTranspose);
        if (beginnerMode && chords.length) {
            capoPosition = CU.findOptimalCapo(chords, currentTranspose).capo;
            difficultyLevel = CU.computeDifficulty(chords, capoPosition, currentTranspose);
            updateBeginnerInfo();
        }
        renderTimeline();
        updateChordsUsed();
    }

    function updateChordsUsed() {
        var grid = document.getElementById('chords-used');
        if (!grid) return;
        var badges = grid.querySelectorAll('.chord-badge');
        badges.forEach(function (badge) {
            var orig = badge.dataset.original;
            if (orig) badge.textContent = getDisplayChord(orig);
        });
    }

    // ── Beginner mode ──

    function toggleBeginnerMode(enabled) {
        beginnerMode = enabled;
        var origBtn = document.getElementById('mode-original');
        var begBtn = document.getElementById('mode-beginner');
        if (origBtn) origBtn.classList.toggle('active', !enabled);
        if (begBtn) begBtn.classList.toggle('active', enabled);

        if (enabled && chords.length) {
            capoPosition = CU.findOptimalCapo(chords, currentTranspose).capo;
            difficultyLevel = CU.computeDifficulty(chords, capoPosition, currentTranspose);
            updateBeginnerInfo();
        }

        var infoBar = document.getElementById('beginner-info');
        if (infoBar) infoBar.style.display = enabled ? '' : 'none';

        renderTimeline();
        updateChordsUsed();
        lastActiveIdx = -1;
        updateChordSync();
    }

    function updateBeginnerInfo() {
        var capoEl = document.getElementById('capo-display');
        var diffEl = document.getElementById('difficulty-display');
        if (capoEl) {
            capoEl.textContent = capoPosition > 0
                ? t('gen_capo_prefix') + ' ' + capoPosition
                : t('gen_no_capo');
        }
        if (diffEl) {
            var labels = { easy: t('gen_difficulty_easy'), moderate: t('gen_difficulty_moderate'), advanced: t('gen_difficulty_advanced') };
            diffEl.textContent = labels[difficultyLevel] || difficultyLevel;
            diffEl.className = 'meta-badge beginner-difficulty difficulty-' + difficultyLevel;
        }
    }

    // ── Timeline rendering ──

    function formatTime(s) {
        if (s == null || isNaN(s)) return '0:00';
        return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
    }

    function renderTimeline() {
        var container = document.getElementById('chord-timeline');
        if (!container || !chords.length) return;
        container.innerHTML = '';

        chords.forEach(function (evt, idx) {
            var block = document.createElement('div');
            block.className = 'chord-block';
            block.dataset.index = idx;
            block.dataset.time = evt.time;
            block.dataset.duration = evt.duration;
            block.style.minWidth = Math.max(60, Math.min(200, evt.duration * 50)) + 'px';

            var display = getDisplayChord(evt.chord);
            var name = document.createElement('span');
            name.className = 'chord-block-name';
            name.textContent = display;
            block.appendChild(name);

            if (beginnerMode && display !== evt.chord) {
                var orig = document.createElement('span');
                orig.className = 'chord-block-original';
                orig.textContent = evt.chord;
                block.appendChild(orig);
            }

            var time = document.createElement('span');
            time.className = 'chord-block-time';
            time.textContent = formatTime(evt.time);
            block.appendChild(time);

            block.addEventListener('click', function () { seekTo(evt.time); });
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
        var lo = 0, hi = chords.length - 1, result = -1;
        while (lo <= hi) {
            var mid = (lo + hi) >> 1;
            if (chords[mid].time <= time) { result = mid; lo = mid + 1; }
            else { hi = mid - 1; }
        }
        return result;
    }

    function updateChordSync() {
        if (!ytPlayer || typeof ytPlayer.getCurrentTime !== 'function') return;
        var time = ytPlayer.getCurrentTime();
        var activeIdx = findActiveChordIndex(time);
        if (activeIdx === lastActiveIdx) return;
        lastActiveIdx = activeIdx;

        if (cachedCurrentEl && activeIdx >= 0) {
            cachedCurrentEl.textContent = getDisplayChord(chords[activeIdx].chord);
        }

        if (cachedBlocks) {
            for (var i = 0; i < cachedBlocks.length; i++) {
                cachedBlocks[i].classList.toggle('active', i === activeIdx);
                cachedBlocks[i].classList.toggle('past', i < activeIdx);
            }
        }

        if (activeIdx >= 0 && cachedBlocks && cachedBlocks[activeIdx]) {
            cachedBlocks[activeIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    }

    function startSync() { if (!syncInterval) syncInterval = setInterval(updateChordSync, 100); }
    function stopSync() { clearInterval(syncInterval); syncInterval = null; }

    // ── YouTube IFrame API ──

    function onStateChange(event) {
        if (event.data === 1) startSync();
        else if (event.data === 0 || event.data === 2) stopSync();
    }

    function initPlayer() {
        if (!videoId) return;
        var tag = document.createElement('script');
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
        var downBtn = document.getElementById('transpose-down');
        var upBtn = document.getElementById('transpose-up');
        var resetBtn = document.getElementById('transpose-reset');
        if (downBtn) downBtn.addEventListener('click', function () { applyTranspose(-1); });
        if (upBtn) upBtn.addEventListener('click', function () { applyTranspose(1); });
        if (resetBtn) resetBtn.addEventListener('click', function () {
            currentTranspose = 0;
            document.getElementById('transpose-value').textContent = '0';
            if (beginnerMode && chords.length) {
                capoPosition = CU.findOptimalCapo(chords, 0).capo;
                difficultyLevel = CU.computeDifficulty(chords, capoPosition, 0);
                updateBeginnerInfo();
            }
            renderTimeline();
            updateChordsUsed();
        });

        // Beginner mode toggle
        var origBtn = document.getElementById('mode-original');
        var begBtn = document.getElementById('mode-beginner');
        if (origBtn) origBtn.addEventListener('click', function () { toggleBeginnerMode(false); });
        if (begBtn) begBtn.addEventListener('click', function () { toggleBeginnerMode(true); });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
