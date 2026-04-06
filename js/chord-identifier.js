/* ==============================================
   Swaram — Chord Identifier Engine
   Real-time mic → FFT → note detection → chord matching
   Uses Web Audio API — 100% client-side, no uploads
   ============================================== */

(function () {
    'use strict';

    // ── Constants ──────────────────────────────────────
    var NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    var NOTE_FREQ_A4 = 440;
    var FFT_SIZE = 8192;
    var SMOOTHING = 0.8;
    var MIN_VOLUME_THRESHOLD = 0.02;       // ignore background noise
    var NOTE_MAGNITUDE_THRESHOLD = 0.15;   // relative magnitude to count as present
    var STABILITY_FRAMES = 4;              // require N consistent frames before showing
    var HISTORY_MAX = 12;

    // Chord intervals — reuse from chord-diagrams.js globals if available
    var INTERVALS = window.SWARAM_INTERVALS || {
        '':     [0, 4, 7],
        'm':    [0, 3, 7],
        '7':    [0, 4, 7, 10],
        'm7':   [0, 3, 7, 10],
        'M7':   [0, 4, 7, 11],
        'sus2': [0, 2, 7],
        'sus4': [0, 5, 7],
        'dim':  [0, 3, 6],
        'aug':  [0, 4, 8],
        '6':    [0, 4, 7, 9],
        'm6':   [0, 3, 7, 9],
        '9':    [0, 4, 7, 10, 14],
        'm9':   [0, 3, 7, 10, 14],
        'm7b5': [0, 3, 6, 10]
    };

    var QUALITY_NAMES = {
        '':     'Major',
        'm':    'Minor',
        '7':    'Dominant 7th',
        'm7':   'Minor 7th',
        'M7':   'Major 7th',
        'sus2': 'Suspended 2nd',
        'sus4': 'Suspended 4th',
        'dim':  'Diminished',
        'aug':  'Augmented',
        '6':    'Major 6th',
        'm6':   'Minor 6th',
        '9':    'Dominant 9th',
        'm9':   'Minor 9th',
        'm7b5': 'Half-diminished'
    };

    // Scoring weights — prioritize simpler chords
    var QUALITY_PRIORITY = {
        '': 1.0, 'm': 1.0, '7': 0.92, 'm7': 0.92, 'sus4': 0.95, 'sus2': 0.95,
        '6': 0.88, 'm6': 0.88, 'M7': 0.88, 'dim': 0.90, 'aug': 0.90,
        '9': 0.82, 'm9': 0.82, 'm7b5': 0.85
    };

    // ── State ──────────────────────────────────────────
    var audioCtx = null;
    var analyser = null;
    var micStream = null;
    var isListening = false;
    var animFrameId = null;
    var stabilityBuffer = [];
    var chordHistory = [];

    // ── DOM refs ───────────────────────────────────────
    var micBtn, micIconOff, micIconOn, micStatus;
    var volumeMeter, volumeFill;
    var resultArea, detectedChord, detectedChordFull, detectedNotes, confidenceFill, confidenceLabel;
    var diagramArea, diagramGuitar, diagramKeyboard;
    var historyArea, historyChips;

    function initDOM() {
        micBtn = document.getElementById('mic-btn');
        if (!micBtn) return; // not on the chord-identifier page
        micIconOff = document.getElementById('mic-icon-off');
        micIconOn = document.getElementById('mic-icon-on');
        micStatus = document.getElementById('mic-status');
        volumeMeter = document.getElementById('volume-meter');
        volumeFill = document.getElementById('volume-fill');
        resultArea = document.getElementById('result-area');
        detectedChord = document.getElementById('detected-chord');
        detectedChordFull = document.getElementById('detected-chord-full');
        detectedNotes = document.getElementById('detected-notes');
        confidenceFill = document.getElementById('confidence-fill');
        confidenceLabel = document.getElementById('confidence-label');
        diagramArea = document.getElementById('diagram-area');
        diagramGuitar = document.getElementById('diagram-guitar');
        diagramKeyboard = document.getElementById('diagram-keyboard');
        historyArea = document.getElementById('history-area');
        historyChips = document.getElementById('history-chips');

        micBtn.addEventListener('click', toggleListening);

        // Diagram tabs
        var tabs = document.querySelectorAll('.identifier-tab');
        tabs.forEach(function (tab) {
            tab.addEventListener('click', function () {
                tabs.forEach(function (t) { t.classList.remove('active'); });
                tab.classList.add('active');
                var which = tab.getAttribute('data-tab');
                diagramGuitar.style.display = which === 'guitar' ? '' : 'none';
                diagramKeyboard.style.display = which === 'keyboard' ? '' : 'none';
            });
        });
    }

    // ── Mic control ────────────────────────────────────

    function toggleListening() {
        if (isListening) {
            stopListening();
        } else {
            startListening();
        }
    }

    function startListening() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setStatus('ci_no_mic', 'Microphone not supported in this browser.');
            return;
        }

        navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
            .then(function (stream) {
                micStream = stream;
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                analyser = audioCtx.createAnalyser();
                analyser.fftSize = FFT_SIZE;
                analyser.smoothingTimeConstant = SMOOTHING;

                var source = audioCtx.createMediaStreamSource(stream);
                source.connect(analyser);

                isListening = true;
                micIconOff.style.display = 'none';
                micIconOn.style.display = '';
                micBtn.classList.add('listening');
                setStatus('ci_listening', 'Listening... play a chord');
                volumeMeter.style.display = '';
                resultArea.style.display = '';

                stabilityBuffer = [];
                analyzeLoop();
            })
            .catch(function (err) {
                console.error('Mic error:', err);
                if (err.name === 'NotAllowedError') {
                    setStatus('ci_mic_denied', 'Microphone access denied. Please allow mic access and try again.');
                } else {
                    setStatus('ci_mic_error', 'Could not access microphone. Check your settings.');
                }
            });
    }

    function stopListening() {
        isListening = false;
        if (animFrameId) {
            cancelAnimationFrame(animFrameId);
            animFrameId = null;
        }
        if (micStream) {
            micStream.getTracks().forEach(function (t) { t.stop(); });
            micStream = null;
        }
        if (audioCtx) {
            audioCtx.close();
            audioCtx = null;
        }
        analyser = null;

        micIconOff.style.display = '';
        micIconOn.style.display = 'none';
        micBtn.classList.remove('listening');
        setStatus('ci_tap_to_start', 'Tap to start listening');
        volumeMeter.style.display = 'none';
    }

    function setStatus(i18nKey, fallback) {
        micStatus.textContent = fallback;
        micStatus.setAttribute('data-i18n', i18nKey);
        // Try live i18n update
        if (typeof t === 'function') {
            var translated = t(i18nKey);
            if (translated) micStatus.textContent = translated;
        }
    }

    // ── Analysis loop ──────────────────────────────────

    function analyzeLoop() {
        if (!isListening) return;

        var bufferLength = analyser.frequencyBinCount;
        var dataArray = new Float32Array(bufferLength);
        analyser.getFloatFrequencyData(dataArray);

        // Also get time-domain for volume
        var timeData = new Uint8Array(bufferLength);
        analyser.getByteTimeDomainData(timeData);
        var rms = computeRMS(timeData);

        // Update volume meter
        var volPct = Math.min(100, Math.round(rms * 500));
        volumeFill.style.width = volPct + '%';

        if (rms > MIN_VOLUME_THRESHOLD) {
            var detected = detectChord(dataArray, audioCtx.sampleRate);
            if (detected) {
                pushStability(detected.name);
                var stable = getStableChord();
                if (stable) {
                    showChord(stable, detected.confidence, detected.notes, detected.quality);
                }
            }
        }

        animFrameId = requestAnimationFrame(analyzeLoop);
    }

    function computeRMS(timeData) {
        var sum = 0;
        for (var i = 0; i < timeData.length; i++) {
            var v = (timeData[i] - 128) / 128;
            sum += v * v;
        }
        return Math.sqrt(sum / timeData.length);
    }

    // ── Pitch / note detection ─────────────────────────

    function detectChord(freqData, sampleRate) {
        var binSize = sampleRate / FFT_SIZE;

        // Build chroma vector — 12 bins for C through B
        var chroma = new Float64Array(12);
        var maxMag = -Infinity;

        // Only analyze musically relevant range: ~65 Hz (C2) to ~2100 Hz (C7)
        var minBin = Math.floor(65 / binSize);
        var maxBin = Math.min(freqData.length - 1, Math.ceil(2100 / binSize));

        for (var i = minBin; i <= maxBin; i++) {
            var mag = Math.pow(10, freqData[i] / 20); // dB to linear
            if (mag > maxMag) maxMag = mag;
        }

        if (maxMag < 0.001) return null; // too quiet

        for (var i = minBin; i <= maxBin; i++) {
            var mag = Math.pow(10, freqData[i] / 20);
            var relMag = mag / maxMag;
            if (relMag < NOTE_MAGNITUDE_THRESHOLD) continue;

            var freq = i * binSize;
            var noteNum = 12 * Math.log2(freq / NOTE_FREQ_A4) + 69;
            var noteIdx = Math.round(noteNum) % 12;
            if (noteIdx < 0) noteIdx += 12;

            // Weight by magnitude — stronger peaks count more
            chroma[noteIdx] += relMag * relMag;
        }

        // Normalize chroma
        var chromaMax = 0;
        for (var i = 0; i < 12; i++) {
            if (chroma[i] > chromaMax) chromaMax = chroma[i];
        }
        if (chromaMax < 0.001) return null;
        for (var i = 0; i < 12; i++) {
            chroma[i] /= chromaMax;
        }

        // Match against all chord templates
        return matchChord(chroma);
    }

    function matchChord(chroma) {
        var bestScore = -1;
        var bestRoot = 0;
        var bestQuality = '';

        var qualityKeys = Object.keys(INTERVALS);

        for (var q = 0; q < qualityKeys.length; q++) {
            var quality = qualityKeys[q];
            var intervals = INTERVALS[quality];
            var priority = QUALITY_PRIORITY[quality] || 0.8;

            for (var root = 0; root < 12; root++) {
                var score = 0;
                var total = 0;

                // Score: how well does the chroma match this chord template?
                for (var n = 0; n < intervals.length; n++) {
                    var noteIdx = (root + intervals[n]) % 12;
                    score += chroma[noteIdx];
                    total++;
                }

                // Average match of chord tones
                var matchScore = score / total;

                // Penalize notes present that are NOT in the chord
                var penalty = 0;
                var penaltyCount = 0;
                for (var n = 0; n < 12; n++) {
                    var isChordTone = false;
                    for (var k = 0; k < intervals.length; k++) {
                        if ((root + intervals[k]) % 12 === n) { isChordTone = true; break; }
                    }
                    if (!isChordTone && chroma[n] > 0.3) {
                        penalty += chroma[n];
                        penaltyCount++;
                    }
                }
                if (penaltyCount > 0) {
                    matchScore -= (penalty / penaltyCount) * 0.3;
                }

                // Boost root note presence
                if (chroma[root] > 0.5) {
                    matchScore += 0.1;
                }

                // Apply quality priority (prefer simpler chords)
                matchScore *= priority;

                if (matchScore > bestScore) {
                    bestScore = matchScore;
                    bestRoot = root;
                    bestQuality = quality;
                }
            }
        }

        if (bestScore < 0.3) return null; // too low confidence

        var chordName = NOTES[bestRoot] + bestQuality;
        var intervals = INTERVALS[bestQuality];
        var noteNames = intervals.map(function (i) { return NOTES[(bestRoot + i) % 12]; });
        var confidence = Math.min(100, Math.round(bestScore * 100));

        return {
            name: chordName,
            root: NOTES[bestRoot],
            quality: bestQuality,
            notes: noteNames,
            confidence: confidence
        };
    }

    // ── Stability: require consistent detection over multiple frames ──

    function pushStability(chordName) {
        stabilityBuffer.push(chordName);
        if (stabilityBuffer.length > STABILITY_FRAMES * 2) {
            stabilityBuffer.shift();
        }
    }

    function getStableChord() {
        if (stabilityBuffer.length < STABILITY_FRAMES) return null;
        var last = stabilityBuffer.slice(-STABILITY_FRAMES);
        var allSame = last.every(function (c) { return c === last[0]; });
        return allSame ? last[0] : null;
    }

    // ── Display ────────────────────────────────────────

    function showChord(chordName, confidence, notes, quality) {
        // Don't re-render if same chord
        if (detectedChord.textContent === chordName) {
            // Just update confidence
            confidenceFill.style.width = confidence + '%';
            confidenceLabel.textContent = confidence + '%';
            return;
        }

        detectedChord.textContent = chordName;
        detectedChordFull.textContent = chordName.replace(/^[A-G]#?/, function (r) { return r + ' '; }).trim();
        if (quality !== undefined) {
            var fullName = NOTES[NOTES.indexOf(chordName.replace(/[^A-G#]/g, ''))] || '';
            detectedChordFull.textContent = fullName + ' ' + (QUALITY_NAMES[quality] || '');
        }
        detectedNotes.textContent = 'Notes: ' + notes.join(' – ');
        confidenceFill.style.width = confidence + '%';
        confidenceLabel.textContent = confidence + '%';

        // Color confidence bar
        confidenceFill.className = 'confidence-bar-fill';
        if (confidence >= 70) confidenceFill.classList.add('high');
        else if (confidence >= 45) confidenceFill.classList.add('medium');
        else confidenceFill.classList.add('low');

        resultArea.style.display = '';

        // Show diagrams
        showDiagrams(chordName);

        // Add to history
        addToHistory(chordName);

        // Pulse animation on chord name
        detectedChord.classList.remove('chord-pulse');
        void detectedChord.offsetWidth; // force reflow
        detectedChord.classList.add('chord-pulse');
    }

    function showDiagrams(chordName) {
        if (typeof CHORD_DIAGRAMS === 'undefined') return;

        var data = CHORD_DIAGRAMS[chordName];
        if (!data) {
            // Try flat alias — CHORD_DIAGRAMS uses sharps (e.g. A#), but detected chord may use flats (Bb)
            var FLAT_ALIASES = window.SWARAM_FLAT_ALIASES || {};
            for (var key in FLAT_ALIASES) {
                var flat = FLAT_ALIASES[key];
                if (chordName.indexOf(flat) === 0) {
                    var suffix = chordName.substring(flat.length);
                    data = CHORD_DIAGRAMS[key + suffix];
                    break;
                }
            }
        }

        if (!data) {
            diagramArea.style.display = 'none';
            return;
        }

        diagramArea.style.display = '';

        // Guitar diagram
        if (data.guitar && typeof renderGuitarSVG === 'function') {
            diagramGuitar.innerHTML = renderGuitarSVG(data.guitar);
        } else {
            diagramGuitar.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:1rem;">No guitar voicing available</p>';
        }

        // Keyboard diagram
        if (data.keys && typeof renderKeyboardSVG === 'function') {
            diagramKeyboard.innerHTML = renderKeyboardSVG(data.keys);
        } else {
            diagramKeyboard.innerHTML = '';
        }
    }

    function addToHistory(chordName) {
        // Avoid duplicates at the end
        if (chordHistory.length > 0 && chordHistory[chordHistory.length - 1] === chordName) return;

        chordHistory.push(chordName);
        if (chordHistory.length > HISTORY_MAX) chordHistory.shift();

        historyArea.style.display = '';
        renderHistory();
    }

    function renderHistory() {
        historyChips.innerHTML = '';
        for (var i = chordHistory.length - 1; i >= 0; i--) {
            var chip = document.createElement('span');
            chip.className = 'history-chip';
            if (i === chordHistory.length - 1) chip.classList.add('latest');
            chip.textContent = chordHistory[i];
            historyChips.appendChild(chip);
        }
    }

    // ── Init ───────────────────────────────────────────

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initDOM);
    } else {
        initDOM();
    }

})();
