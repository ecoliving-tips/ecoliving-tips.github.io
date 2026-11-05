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

    // Progress bar under the current chord (time left until the next chord)
    var progressEl = null;
    var progressFillEl = null;
    var progressRafId = null;
    var lastProgressPct = -1;
    var lastProgressEnding = false;

    // Beginner mode state
    var beginnerMode = false;
    var capoPosition = 0;
    var difficultyLevel = '';

    // Now Playing Panel state (persisted in localStorage)
    var nppMode = localStorage.getItem('swaram-npp-mode') || 'diagram';
    var nppInstrument = localStorage.getItem('swaram-npp-instrument') || 'guitar';

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
                ? 'Capo ' + capoPosition
                : 'No Capo';
        }
        if (diffEl) {
            var labels = { easy: 'Easy', moderate: 'Moderate', advanced: 'Advanced' };
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

        // Update now-playing diagram panel
        updateNowPlayingPanel(activeIdx);

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

    // ── Progress bar (how long the current chord lasts) ──

    // The bar lives inside the "Now" card. It is created here (not in the page
    // HTML) so the generated /chords/ pages don't need to be rebuilt.
    function ensureProgressBar() {
        if (progressFillEl && progressFillEl.isConnected) return;
        progressEl = document.getElementById('npp-progress');
        if (!progressEl) {
            var nameEl = document.querySelector('.npp-card.current .npp-chord-name');
            if (!nameEl || !nameEl.parentNode) return;
            progressEl = document.createElement('div');
            progressEl.className = 'npp-progress';
            progressEl.id = 'npp-progress';
            progressEl.setAttribute('role', 'progressbar');
            progressEl.setAttribute('aria-label', 'Time left on this chord');
            progressEl.setAttribute('aria-valuemin', '0');
            progressEl.setAttribute('aria-valuemax', '100');
            progressEl.setAttribute('aria-valuenow', '0');
            progressEl.innerHTML = '<div class="npp-progress-fill" id="npp-progress-fill"></div>';
            nameEl.parentNode.insertBefore(progressEl, nameEl.nextSibling);
        }
        progressFillEl = progressEl.querySelector('.npp-progress-fill');
        lastProgressPct = -1;
        lastProgressEnding = false;
    }

    // Fills from the chord's start to the next chord's start; turns amber near
    // the end ("get ready"). Pass activeIdx < 0 to reset it.
    function updateChordProgress(activeIdx, time) {
        ensureProgressBar();
        if (!progressFillEl) return;

        var pct = 0;
        var ending = false;
        var c = activeIdx >= 0 ? chords[activeIdx] : null;
        if (c) {
            var next = chords[activeIdx + 1];
            // Chord lasts until the next one starts (the last one: its own duration)
            var end = next ? next.time : c.time + (c.duration || 0);
            var len = end - c.time;
            if (len > 0) {
                pct = Math.min(1, Math.max(0, (time - c.time) / len));
                ending = pct > 0.75 || (end - time) < 0.6;
            }
        }

        // Avoid redundant style writes (this runs ~60x/s)
        var rounded = Math.round(pct * 1000) / 1000;
        if (rounded !== lastProgressPct) {
            lastProgressPct = rounded;
            progressFillEl.style.transform = 'scaleX(' + rounded + ')';
            progressEl.setAttribute('aria-valuenow', String(Math.round(rounded * 100)));
        }
        if (ending !== lastProgressEnding) {
            lastProgressEnding = ending;
            progressFillEl.classList.toggle('ending', ending);
        }
    }

    // The chord sync below polls every 100 ms; the bar gets its own
    // requestAnimationFrame loop so it moves smoothly.
    function progressTick() {
        if (ytPlayer && typeof ytPlayer.getCurrentTime === 'function' && chords.length) {
            var time = ytPlayer.getCurrentTime();
            updateChordProgress(findActiveChordIndex(time), time);
        }
        progressRafId = requestAnimationFrame(progressTick);
    }

    function startSync() {
        if (!syncInterval) syncInterval = setInterval(updateChordSync, 100);
        if (!progressRafId) progressRafId = requestAnimationFrame(progressTick);
    }
    function stopSync() {
        clearInterval(syncInterval);
        syncInterval = null;
        if (progressRafId) { cancelAnimationFrame(progressRafId); progressRafId = null; }
    }

    // ── YouTube IFrame API ──

    function onStateChange(event) {
        if (event.data === 1) startSync();
        else if (event.data === 0 || event.data === 2) stopSync();
        if (event.data === 0) updateChordProgress(-1, 0); // ended: reset the bar
    }

    function initPlayer() {
        if (!videoId) return;
        var tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);

        window.onYouTubeIframeAPIReady = function () {
            ytPlayer = new YT.Player('youtube-player', {
                videoId: videoId,
                playerVars: { rel: 0, modestbranding: 1, playsinline: 1, origin: window.location.origin },
                events: { onStateChange: onStateChange },
            });
        };
    }

    // ── Now Playing Panel ──

    function initNowPlayingPanel() {
        var modeToggle = document.getElementById('npp-mode-toggle');
        var instrToggle = document.getElementById('npp-instrument-toggle');
        applyNppMode(nppMode);
        applyNppInstrument(nppInstrument);

        if (modeToggle) {
            modeToggle.addEventListener('click', function (e) {
                var btn = e.target.closest('[data-mode]');
                if (!btn) return;
                nppMode = btn.dataset.mode;
                localStorage.setItem('swaram-npp-mode', nppMode);
                applyNppMode(nppMode);
                if (lastActiveIdx >= 0) updateNowPlayingPanel(lastActiveIdx);
            });
        }

        if (instrToggle) {
            instrToggle.addEventListener('click', function (e) {
                var btn = e.target.closest('[data-instrument]');
                if (!btn) return;
                nppInstrument = btn.dataset.instrument;
                localStorage.setItem('swaram-npp-instrument', nppInstrument);
                applyNppInstrument(nppInstrument);
                if (lastActiveIdx >= 0) updateNowPlayingPanel(lastActiveIdx);
            });
        }
    }

    function applyNppMode(mode) {
        var panel = document.getElementById('now-playing-panel');
        if (!panel) return;
        panel.dataset.mode = mode;
        var modeButtons = panel.querySelectorAll('#npp-mode-toggle .npp-btn');
        modeButtons.forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
        var instrToggle = document.getElementById('npp-instrument-toggle');
        if (instrToggle) instrToggle.style.display = mode === 'diagram' ? 'flex' : 'none';
    }

    function applyNppInstrument(instrument) {
        var instrButtons = document.querySelectorAll('#npp-instrument-toggle .npp-btn');
        instrButtons.forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.instrument === instrument);
        });
    }

    function updateNowPlayingPanel(activeIdx) {
        var panel = document.getElementById('now-playing-panel');
        if (!panel || !chords) return;

        [
            { cls: 'current', offset: 0 },
            { cls: 'next',    offset: 1 },
            { cls: 'next2',   offset: 2 },
        ].forEach(function (item) {
            var idx = activeIdx + item.offset;
            var card = panel.querySelector('.npp-card.' + item.cls);
            if (!card) return;
            var nameEl = card.querySelector('.npp-chord-name');
            var diagramEl = card.querySelector('.npp-diagram');

            if (idx < 0 || idx >= chords.length) {
                nameEl.textContent = '—';
                if (diagramEl) diagramEl.innerHTML = '';
                return;
            }

            var chord = getDisplayChord(chords[idx].chord);
            nameEl.textContent = chord;

            if (nppMode === 'diagram' && diagramEl) {
                var lookupName = chord.indexOf('/') >= 0 ? chord.split('/')[0] : chord;
                var normalized = lookupName.replace(/[()]/g, '').replace(/maj7$/, 'M7');
                var data = window.CHORD_DIAGRAMS && window.CHORD_DIAGRAMS[normalized];
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

    // ── Init ──

    function init() {
        renderTimeline();
        initPlayer();
        initNowPlayingPanel();
        ensureProgressBar();

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
