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
    var SMOOTHING = 0.7;                   // temporal smoothing (lower = more responsive)
    var MIN_VOLUME_THRESHOLD = 0.02;       // ignore background noise
    var STABILITY_FRAMES = 3;              // require N consistent frames before showing
    var HISTORY_MAX = 12;

    // ── Advanced detection constants ─────────────────
    var PEAK_PROMINENCE_DB = 3;            // min dB above neighbors for a spectral peak
    var PEAK_NEIGHBOR_BINS = 4;            // local max window size (each side)
    var HPS_HARMONICS = 3;                 // downsample copies for Harmonic Product Spectrum
    var BASS_HIGH = 300;                   // Hz — bass/treble chroma split
    var BASS_WEIGHT = 1.5;                 // bass chroma multiplier in merge
    var HARMONIC_CANCEL_FACTOR = 0.7;      // fraction subtracted at harmonic frequencies
    var CHROMA_SMOOTH_FRAMES = 3;          // rolling chroma average window
    var MIN_COSINE_SIM = 0.30;             // minimum cosine similarity to report a chord

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
    var chromaHistory = [];                 // ring buffer for chroma frame averaging

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
                chromaHistory = [];
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

    // ── Spectral peak detection ─────────────────────

    function findPeaks(linMag, binSize) {
        var minBin = Math.floor(65 / binSize);
        var maxBin = Math.min(linMag.length - 1, Math.ceil(2100 / binSize));
        var peaks = [];

        for (var i = minBin; i <= maxBin; i++) {
            if (linMag[i] < 1e-6) continue;
            var isMax = true;
            var neighborSum = 0;
            var neighborCount = 0;

            for (var j = -PEAK_NEIGHBOR_BINS; j <= PEAK_NEIGHBOR_BINS; j++) {
                if (j === 0) continue;
                var idx = i + j;
                if (idx < 0 || idx >= linMag.length) continue;
                if (linMag[idx] >= linMag[i]) { isMax = false; break; }
                neighborSum += linMag[idx];
                neighborCount++;
            }
            if (!isMax || neighborCount === 0) continue;

            var avgNeighbor = neighborSum / neighborCount;
            if (avgNeighbor < 1e-10) avgNeighbor = 1e-10;
            var prominenceDB = 20 * Math.log10(linMag[i] / avgNeighbor);
            if (prominenceDB >= PEAK_PROMINENCE_DB) {
                peaks.push({ bin: i, mag: linMag[i], freq: i * binSize });
            }
        }
        return peaks;
    }

    // ── Harmonic Product Spectrum ──────────────────

    function harmonicProductSpectrum(peaks, linMag, binSize) {
        // Build HPS magnitude: multiply spectrum at 1/2, 1/3 downsample ratios
        var minBin = Math.floor(65 / binSize);
        var maxBin = Math.min(linMag.length - 1, Math.ceil(2100 / binSize));
        var hps = new Float64Array(linMag.length);

        for (var i = minBin; i <= maxBin; i++) {
            hps[i] = linMag[i];
            for (var h = 2; h <= HPS_HARMONICS; h++) {
                var hBin = i * h;
                if (hBin < linMag.length) {
                    hps[i] *= linMag[hBin];
                } else {
                    hps[i] = 0;
                    break;
                }
            }
        }

        // Re-pick peaks from HPS — only keep those near original peaks
        var filtered = [];
        for (var p = 0; p < peaks.length; p++) {
            var bin = peaks[p].bin;
            // Check if this bin is still a local max in HPS
            var stillMax = true;
            for (var j = -2; j <= 2; j++) {
                if (j === 0) continue;
                var idx = bin + j;
                if (idx >= 0 && idx < hps.length && hps[idx] >= hps[bin]) {
                    stillMax = false;
                    break;
                }
            }
            if (stillMax && hps[bin] > 0) {
                filtered.push({ bin: bin, mag: hps[bin], freq: peaks[p].freq });
            }
        }
        return filtered;
    }

    // ── Chroma vector construction ────────────────

    function buildChromaVectors(peaks, binSize) {
        var bass = new Float64Array(12);
        var treble = new Float64Array(12);

        for (var p = 0; p < peaks.length; p++) {
            var freq = peaks[p].freq;
            var mag = peaks[p].mag;
            var noteNum = 12 * Math.log2(freq / NOTE_FREQ_A4) + 69;
            var noteIdx = Math.round(noteNum) % 12;
            if (noteIdx < 0) noteIdx += 12;
            var energy = mag * mag;

            if (freq <= BASS_HIGH) {
                bass[noteIdx] += energy;
            }
            if (freq >= BASS_HIGH) {
                treble[noteIdx] += energy;
            }
        }
        return { bass: bass, treble: treble };
    }

    // ── Harmonic cancellation ─────────────────────

    function cancelHarmonics(bassChroma, trebleChroma, peaks, binSize) {
        // Sort peaks by magnitude descending — strongest fundamentals first
        var sorted = peaks.slice().sort(function (a, b) { return b.mag - a.mag; });

        for (var p = 0; p < sorted.length; p++) {
            var freq = sorted[p].freq;
            var energy = sorted[p].mag * sorted[p].mag;
            var cancelAmount = energy * HARMONIC_CANCEL_FACTOR;

            // Subtract energy at 2f, 3f, 4f, 5f
            for (var h = 2; h <= 5; h++) {
                var hFreq = freq * h;
                if (hFreq > 2100) break;
                var noteNum = 12 * Math.log2(hFreq / NOTE_FREQ_A4) + 69;
                var noteIdx = Math.round(noteNum) % 12;
                if (noteIdx < 0) noteIdx += 12;

                if (hFreq <= BASS_HIGH) {
                    bassChroma[noteIdx] = Math.max(0, bassChroma[noteIdx] - cancelAmount);
                }
                if (hFreq >= BASS_HIGH) {
                    trebleChroma[noteIdx] = Math.max(0, trebleChroma[noteIdx] - cancelAmount);
                }
            }
        }
    }

    // ── Chroma merge ──────────────────────────────

    function mergeChroma(bassChroma, trebleChroma) {
        var merged = new Float64Array(12);

        // Normalize each independently
        var bassMax = 0, trebleMax = 0;
        for (var i = 0; i < 12; i++) {
            if (bassChroma[i] > bassMax) bassMax = bassChroma[i];
            if (trebleChroma[i] > trebleMax) trebleMax = trebleChroma[i];
        }

        for (var i = 0; i < 12; i++) {
            var normBass = bassMax > 1e-10 ? bassChroma[i] / bassMax : 0;
            var normTreble = trebleMax > 1e-10 ? trebleChroma[i] / trebleMax : 0;
            merged[i] = normTreble + normBass * BASS_WEIGHT;
        }

        // Normalize merged
        var mMax = 0;
        for (var i = 0; i < 12; i++) {
            if (merged[i] > mMax) mMax = merged[i];
        }
        if (mMax > 1e-10) {
            for (var i = 0; i < 12; i++) merged[i] /= mMax;
        }
        return merged;
    }

    // ── Chroma frame averaging ────────────────────

    function averageChroma(currentChroma) {
        // Store a copy
        var copy = new Float64Array(12);
        for (var i = 0; i < 12; i++) copy[i] = currentChroma[i];
        chromaHistory.push(copy);
        if (chromaHistory.length > CHROMA_SMOOTH_FRAMES) chromaHistory.shift();

        var avg = new Float64Array(12);
        for (var f = 0; f < chromaHistory.length; f++) {
            for (var i = 0; i < 12; i++) {
                avg[i] += chromaHistory[f][i];
            }
        }
        var n = chromaHistory.length;
        for (var i = 0; i < 12; i++) avg[i] /= n;
        return avg;
    }

    // ── Chord detection pipeline ──────────────────

    function detectChord(freqData, sampleRate) {
        var binSize = sampleRate / FFT_SIZE;

        // Step 1: Convert dB to linear magnitude
        var linMag = new Float64Array(freqData.length);
        for (var i = 0; i < freqData.length; i++) {
            linMag[i] = Math.pow(10, freqData[i] / 20);
        }

        // Step 2: Find spectral peaks
        var peaks = findPeaks(linMag, binSize);
        if (peaks.length < 2) return null;

        // Step 3: Harmonic Product Spectrum — suppress overtones
        peaks = harmonicProductSpectrum(peaks, linMag, binSize);
        if (peaks.length < 2) return null;

        // Step 4: Build separate bass and treble chroma
        var chromas = buildChromaVectors(peaks, binSize);

        // Step 5: Cancel harmonic contamination
        cancelHarmonics(chromas.bass, chromas.treble, peaks, binSize);

        // Step 6: Merge with bass weighting
        var chroma = mergeChroma(chromas.bass, chromas.treble);

        // Step 7: Frame averaging
        chroma = averageChroma(chroma);

        // Step 8: Template matching
        return matchChord(chroma, chromas.bass);
    }

    // ── Cosine similarity chord matching ──────────

    function matchChord(chroma, bassChroma) {
        var bestScore = -1;
        var bestRoot = 0;
        var bestQuality = '';

        // Pre-compute chroma norm
        var chromaNormSq = 0;
        for (var i = 0; i < 12; i++) chromaNormSq += chroma[i] * chroma[i];
        if (chromaNormSq < 1e-10) return null;
        var chromaNorm = Math.sqrt(chromaNormSq);

        // Find strongest bass note for root boost
        var bassRoot = -1;
        var bassMax = 0;
        if (bassChroma) {
            for (var i = 0; i < 12; i++) {
                if (bassChroma[i] > bassMax) { bassMax = bassChroma[i]; bassRoot = i; }
            }
        }

        var qualityKeys = Object.keys(INTERVALS);

        for (var q = 0; q < qualityKeys.length; q++) {
            var quality = qualityKeys[q];
            var intervals = INTERVALS[quality];
            var priority = QUALITY_PRIORITY[quality] || 0.8;

            // Pre-compute template norm (count unique chroma bins)
            var templateBins = {};
            for (var n = 0; n < intervals.length; n++) {
                templateBins[(intervals[n]) % 12] = true;
            }
            var templateNonZero = Object.keys(templateBins).length;
            var templateNorm = Math.sqrt(templateNonZero);

            for (var root = 0; root < 12; root++) {
                // Compute dot product: chroma · template
                var dot = 0;
                for (var n = 0; n < intervals.length; n++) {
                    var noteIdx = (root + intervals[n]) % 12;
                    dot += chroma[noteIdx];
                }
                // De-duplicate: if intervals map to same bin, we count chroma once per unique bin
                // Since template values are 1.0, dot = sum of chroma at chord tone positions
                // For 9th chords: interval 14 % 12 = 2, which is unique, so no dedup needed

                var cosineSim = dot / (chromaNorm * templateNorm);

                // Bass root boost
                if (bassRoot >= 0 && bassRoot === root) {
                    cosineSim *= 1.15;
                }

                // Quality priority (prefer simpler chords)
                cosineSim *= priority;

                if (cosineSim > bestScore) {
                    bestScore = cosineSim;
                    bestRoot = root;
                    bestQuality = quality;
                }
            }
        }

        if (bestScore < MIN_COSINE_SIM) return null;

        var chordName = NOTES[bestRoot] + bestQuality;
        var intervals = INTERVALS[bestQuality];
        var noteNames = intervals.map(function (iv) { return NOTES[(bestRoot + iv) % 12]; });
        var confidence = Math.min(100, Math.round(bestScore * 120));

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
