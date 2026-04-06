/* ==============================================
   Swaram — Chord Identifier Engine v3
   Real-time mic → FFT → HPCP → penalized matching
   Uses Web Audio API — 100% client-side, no uploads
   ============================================== */

(function () {
    'use strict';

    // ── Constants ──────────────────────────────────────
    var NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    var NOTE_FREQ_A4 = 440;
    var FFT_SIZE = 16384;                  // ~2.7 Hz/bin at 44.1kHz (was 8192)
    var SMOOTHING = 0.5;                   // less temporal smearing (was 0.8)
    var MIN_VOLUME_THRESHOLD = 0.02;       // ignore background noise
    var HISTORY_MAX = 12;

    // ── Detection constants ──────────────────────────
    var ANALYSIS_INTERVAL = 150;           // ms between chord detections (~7 fps)
    var NOISE_FLOOR_DB = -90;              // bins below this are silence
    var PEAK_MIN_HEIGHT = 0.05;            // relative magnitude gate for peaks
    var PEAK_NEIGHBORS = 2;                // local max radius in bins
    var NUM_HARMONICS = 6;                 // HPCP sub-harmonic count
    var HARMONIC_WEIGHTS = [1.0, 0.5, 0.33, 0.25, 0.2, 0.16];
    var CENTS_WINDOW = 50;                 // cosine window half-width in cents
    var BASS_LOW_HZ = 40;                  // bass HPS range start
    var BASS_HIGH_HZ = 300;                // bass HPS range end
    var FIFTH_ATTEN = 0.1;                 // subtract 10% of each note from its 5th
    var CHROMA_SMOOTH_FRAMES = 4;          // rolling chroma average window
    var PENALTY_WEIGHT = 0.8;              // penalty for non-chord-tone energy
    var MIN_CHORD_SCORE = 0.25;            // minimum penalized score to report
    var BASS_ROOT_BOOST = 1.2;             // boost when bass matches chord root
    var VOTE_WINDOW = 5;                   // voting frame count
    var VOTE_THRESHOLD = 0.6;              // 60% majority needed (3 of 5)
    var MIN_HOLD_MS = 500;                 // minimum display time before chord change

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
        '': 1.0, 'm': 1.0, 'sus4': 0.96, 'sus2': 0.96,
        '7': 0.93, 'm7': 0.93, 'dim': 0.92, 'aug': 0.92,
        '6': 0.90, 'm6': 0.90, 'M7': 0.90,
        'm7b5': 0.88, '9': 0.80, 'm9': 0.80
    };

    // Pre-compute chord tone sets for matching (avoids re-creating Sets per frame)
    var CHORD_TONE_SETS = {};
    var qualityKeys = Object.keys(INTERVALS);
    for (var q = 0; q < qualityKeys.length; q++) {
        var qk = qualityKeys[q];
        var tones = {};
        var ivs = INTERVALS[qk];
        for (var n = 0; n < ivs.length; n++) tones[ivs[n] % 12] = true;
        CHORD_TONE_SETS[qk] = { tones: tones, count: Object.keys(tones).length };
    }

    // ── State ──────────────────────────────────────────
    var audioCtx = null;
    var analyser = null;
    var micStream = null;
    var isListening = false;
    var animFrameId = null;
    var chordHistory = [];
    var chromaHistory = [];                 // ring buffer for chroma frame averaging
    var voteBuffer = [];                   // multi-frame voting buffer
    var lastAnalysisTime = 0;              // throttle chord detection
    var lastChordChangeTime = 0;           // display hold timer
    var currentDisplayedChord = '';        // currently shown chord name

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

                // Reset detection state
                chromaHistory = [];
                voteBuffer = [];
                lastAnalysisTime = 0;
                lastChordChangeTime = 0;
                currentDisplayedChord = '';
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
        if (typeof t === 'function') {
            var translated = t(i18nKey);
            if (translated) micStatus.textContent = translated;
        }
    }

    // ── Analysis loop (volume at 60fps, chords throttled to ~7fps) ──

    function analyzeLoop() {
        if (!isListening) return;

        var bufferLength = analyser.frequencyBinCount;

        // Volume meter — every frame (cheap)
        var timeData = new Uint8Array(bufferLength);
        analyser.getByteTimeDomainData(timeData);
        var rms = computeRMS(timeData);
        var volPct = Math.min(100, Math.round(rms * 500));
        volumeFill.style.width = volPct + '%';

        // Chord detection — throttled
        var now = performance.now();
        if (rms > MIN_VOLUME_THRESHOLD && (now - lastAnalysisTime) >= ANALYSIS_INTERVAL) {
            lastAnalysisTime = now;
            var dataArray = new Float32Array(bufferLength);
            analyser.getFloatFrequencyData(dataArray);

            var detected = detectChord(dataArray, audioCtx.sampleRate);
            if (detected) {
                pushVote(detected);
                var winner = getVotedChord();
                if (winner) {
                    showChordWithHold(winner);
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

    // ── Chord detection pipeline ──────────────────────

    function detectChord(freqData, sampleRate) {
        var binSize = sampleRate / FFT_SIZE;
        var minBin = Math.floor(65 / binSize);       // C2 ~65 Hz
        var maxBin = Math.min(freqData.length - 1, Math.ceil(2100 / binSize)); // C7

        // Step 1: dB → linear → log1p compression
        var linMag = new Float64Array(freqData.length);
        var maxMag = 0;
        for (var i = minBin; i <= maxBin; i++) {
            if (freqData[i] < NOISE_FLOOR_DB) {
                linMag[i] = 0;
            } else {
                linMag[i] = Math.log1p(Math.pow(10, freqData[i] / 20));
            }
            if (linMag[i] > maxMag) maxMag = linMag[i];
        }
        if (maxMag < 0.001) return null;

        // Step 2: Find spectral peaks with parabolic interpolation
        var peaks = findSpectralPeaks(linMag, minBin, maxBin, maxMag, binSize);
        if (peaks.length < 2) return null; // need at least 2 peaks for a chord

        // Step 3: Build HPCP from peaks (harmonic pitch class profile)
        var chroma = buildHPCP(peaks);

        // Step 4: Find bass root via Harmonic Product Spectrum (40-300Hz)
        var bassRoot = findBassRoot(linMag, binSize);

        // Step 5: Attenuate fifths (reduce 3rd harmonic bleed)
        chroma = attenuateFifths(chroma);

        // Step 6: Normalize chroma to peak = 1.0
        var chromaMax = 0;
        for (var i = 0; i < 12; i++) {
            if (chroma[i] > chromaMax) chromaMax = chroma[i];
        }
        if (chromaMax > 1e-10) {
            for (var i = 0; i < 12; i++) chroma[i] /= chromaMax;
        }

        // Step 7: Frame averaging (4-frame rolling window)
        chroma = averageChroma(chroma);

        // Step 8: Penalized template matching
        return matchChordPenalized(chroma, bassRoot);
    }

    // ── Spectral peak detection ──────────────────────

    function findSpectralPeaks(linMag, minBin, maxBin, maxMag, binSize) {
        var peaks = [];
        var threshold = maxMag * PEAK_MIN_HEIGHT;

        for (var i = minBin + PEAK_NEIGHBORS; i <= maxBin - PEAK_NEIGHBORS; i++) {
            if (linMag[i] < threshold) continue;

            // Check local maximum within ±PEAK_NEIGHBORS radius
            var isPeak = true;
            for (var j = 1; j <= PEAK_NEIGHBORS; j++) {
                if (linMag[i] <= linMag[i - j] || linMag[i] <= linMag[i + j]) {
                    isPeak = false;
                    break;
                }
            }
            if (!isPeak) continue;

            // Parabolic interpolation for sub-bin frequency accuracy
            var alpha = linMag[i - 1];
            var beta = linMag[i];
            var gamma = linMag[i + 1];
            var denom = alpha - 2 * beta + gamma;
            var interpBin;
            if (Math.abs(denom) < 1e-10) {
                interpBin = i;
            } else {
                var delta = 0.5 * (alpha - gamma) / denom;
                interpBin = i + delta;
            }

            peaks.push({ freq: interpBin * binSize, mag: linMag[i] });
        }

        return peaks;
    }

    // ── HPCP: Harmonic Pitch Class Profile ───────────

    function buildHPCP(peaks) {
        var chroma = new Float64Array(12);
        var piOver2W = Math.PI / (2 * CENTS_WINDOW);

        for (var p = 0; p < peaks.length; p++) {
            var f = peaks[p].freq;
            var m = peaks[p].mag;

            for (var h = 1; h <= NUM_HARMONICS; h++) {
                var fundamental = f / h;
                if (fundamental < 30) break; // below useful range

                // Convert to MIDI note number
                var midiNote = 12 * Math.log2(fundamental / NOTE_FREQ_A4) + 69;
                var nearestMidi = Math.round(midiNote);
                var centsOff = (midiNote - nearestMidi) * 100;

                if (Math.abs(centsOff) >= CENTS_WINDOW) continue;

                // Cosine weighting: 1.0 at center, 0.0 at ±CENTS_WINDOW
                var cosWeight = Math.cos(centsOff * piOver2W);

                var pitchClass = nearestMidi % 12;
                if (pitchClass < 0) pitchClass += 12;

                chroma[pitchClass] += m * HARMONIC_WEIGHTS[h - 1] * cosWeight;
            }
        }

        return chroma;
    }

    // ── Bass root detection via HPS ──────────────────

    function findBassRoot(linMag, binSize) {
        var bassLow = Math.max(1, Math.floor(BASS_LOW_HZ / binSize));
        var bassHigh = Math.floor(BASS_HIGH_HZ / binSize);
        var maxLen = linMag.length;

        var bestBin = -1;
        var bestProduct = 0;

        for (var i = bassLow; i <= bassHigh; i++) {
            if (linMag[i] < 0.001) continue;

            // Multiply spectrum at f, 2f, 3f — true fundamental has all harmonics
            var product = linMag[i];
            var bin2 = Math.round(2 * i);
            var bin3 = Math.round(3 * i);

            if (bin2 < maxLen) {
                product *= (linMag[bin2] + 0.001);
            }
            if (bin3 < maxLen) {
                product *= (linMag[bin3] + 0.001);
            }

            if (product > bestProduct) {
                bestProduct = product;
                bestBin = i;
            }
        }

        if (bestBin < 0) return -1;

        // Parabolic interpolation
        var freq;
        if (bestBin > 0 && bestBin < maxLen - 1) {
            var alpha = linMag[bestBin - 1];
            var beta = linMag[bestBin];
            var gamma = linMag[bestBin + 1];
            var denom = alpha - 2 * beta + gamma;
            if (Math.abs(denom) > 1e-10) {
                var delta = 0.5 * (alpha - gamma) / denom;
                freq = (bestBin + delta) * binSize;
            } else {
                freq = bestBin * binSize;
            }
        } else {
            freq = bestBin * binSize;
        }

        var midiNote = 12 * Math.log2(freq / NOTE_FREQ_A4) + 69;
        var pc = Math.round(midiNote) % 12;
        if (pc < 0) pc += 12;
        return pc;
    }

    // ── Chroma post-processing ──────────────────────

    function attenuateFifths(chroma) {
        var result = new Float64Array(12);
        for (var i = 0; i < 12; i++) result[i] = chroma[i];

        for (var i = 0; i < 12; i++) {
            var fifth = (i + 7) % 12;
            result[fifth] -= chroma[i] * FIFTH_ATTEN;
            if (result[fifth] < 0) result[fifth] = 0;
        }
        return result;
    }

    function averageChroma(currentChroma) {
        var copy = new Float64Array(12);
        for (var i = 0; i < 12; i++) copy[i] = currentChroma[i];
        chromaHistory.push(copy);
        if (chromaHistory.length > CHROMA_SMOOTH_FRAMES) chromaHistory.shift();

        var avg = new Float64Array(12);
        for (var f = 0; f < chromaHistory.length; f++) {
            for (var i = 0; i < 12; i++) avg[i] += chromaHistory[f][i];
        }
        var len = chromaHistory.length;
        for (var i = 0; i < 12; i++) avg[i] /= len;
        return avg;
    }

    // ── Penalized chord matching ─────────────────────

    function matchChordPenalized(chroma, bassRoot) {
        var bestScore = -Infinity;
        var bestRoot = 0;
        var bestQuality = '';

        for (var q = 0; q < qualityKeys.length; q++) {
            var quality = qualityKeys[q];
            var info = CHORD_TONE_SETS[quality];
            var N = info.count;
            var nonN = 12 - N;
            var priority = QUALITY_PRIORITY[quality] || 0.8;

            for (var root = 0; root < 12; root++) {
                // Build shifted chord tone lookup
                var isChordTone = new Uint8Array(12);
                var toneKeys = Object.keys(info.tones);
                for (var k = 0; k < toneKeys.length; k++) {
                    isChordTone[(root + parseInt(toneKeys[k])) % 12] = 1;
                }

                // Compute reward (average chroma at chord tones)
                var reward = 0;
                var penalty = 0;
                for (var i = 0; i < 12; i++) {
                    if (isChordTone[i]) {
                        reward += chroma[i];
                    } else {
                        penalty += chroma[i];
                    }
                }
                var avgReward = reward / N;
                var avgPenalty = nonN > 0 ? penalty / nonN : 0;

                // Score = normalized reward minus weighted penalty
                var score = (avgReward - PENALTY_WEIGHT * avgPenalty) * priority;

                // Bass root boost
                if (bassRoot >= 0 && bassRoot === root) {
                    score *= BASS_ROOT_BOOST;
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestRoot = root;
                    bestQuality = quality;
                }
            }
        }

        if (bestScore < MIN_CHORD_SCORE) return null;

        var chordName = NOTES[bestRoot] + bestQuality;
        var intervals = INTERVALS[bestQuality];
        var noteNames = intervals.map(function (iv) { return NOTES[(bestRoot + iv) % 12]; });
        var confidence = Math.min(100, Math.max(0, Math.round(bestScore * 130)));

        return {
            name: chordName,
            root: NOTES[bestRoot],
            quality: bestQuality,
            notes: noteNames,
            confidence: confidence
        };
    }

    // ── Multi-frame voting (replaces identical-frame stability) ──

    function pushVote(detected) {
        voteBuffer.push(detected);
        if (voteBuffer.length > VOTE_WINDOW * 2) voteBuffer.shift();
    }

    function getVotedChord() {
        if (voteBuffer.length < VOTE_WINDOW) return null;

        var recent = voteBuffer.slice(-VOTE_WINDOW);
        var counts = {};
        for (var i = 0; i < recent.length; i++) {
            var name = recent[i].name;
            counts[name] = (counts[name] || 0) + 1;
        }

        // Find winner
        var bestName = null;
        var bestCount = 0;
        for (var name in counts) {
            if (counts[name] > bestCount) {
                bestCount = counts[name];
                bestName = name;
            }
        }

        // Require VOTE_THRESHOLD fraction (60% = 3 of 5)
        if (bestCount / VOTE_WINDOW < VOTE_THRESHOLD) return null;

        // Return the latest detection object for the winning chord
        for (var i = recent.length - 1; i >= 0; i--) {
            if (recent[i].name === bestName) return recent[i];
        }
        return null;
    }

    // ── Display with hold time ───────────────────────

    function showChordWithHold(detected) {
        if (detected.name === currentDisplayedChord) {
            // Same chord — just update confidence
            showChord(detected.name, detected.confidence, detected.notes, detected.quality);
            return;
        }

        // Different chord — enforce minimum hold time to prevent flickering
        var now = Date.now();
        if (lastChordChangeTime > 0 && (now - lastChordChangeTime) < MIN_HOLD_MS) return;

        lastChordChangeTime = now;
        currentDisplayedChord = detected.name;
        showChord(detected.name, detected.confidence, detected.notes, detected.quality);
    }

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
        detectedNotes.textContent = 'Notes: ' + notes.join(' \u2013 ');
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

        if (data.guitar && typeof renderGuitarSVG === 'function') {
            diagramGuitar.innerHTML = renderGuitarSVG(data.guitar);
        } else {
            diagramGuitar.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:1rem;">No guitar voicing available</p>';
        }

        if (data.keys && typeof renderKeyboardSVG === 'function') {
            diagramKeyboard.innerHTML = renderKeyboardSVG(data.keys);
        } else {
            diagramKeyboard.innerHTML = '';
        }
    }

    function addToHistory(chordName) {
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
