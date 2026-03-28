// Swaram — Chord Progression Builder
// Interactive tool: pick a key, see diatonic chords, build & play progressions

(function () {
    'use strict';

    // ===== Music Theory Data =====

    const MAJOR_SCALE = [
        { semitones: 0,  quality: '',    label: 'I' },
        { semitones: 2,  quality: 'm',   label: 'ii' },
        { semitones: 4,  quality: 'm',   label: 'iii' },
        { semitones: 5,  quality: '',    label: 'IV' },
        { semitones: 7,  quality: '',    label: 'V' },
        { semitones: 9,  quality: 'm',   label: 'vi' },
        { semitones: 11, quality: 'dim', label: 'vii\u00B0' }
    ];

    const MINOR_SCALE = [
        { semitones: 0,  quality: 'm',   label: 'i' },
        { semitones: 2,  quality: 'dim', label: 'ii\u00B0' },
        { semitones: 3,  quality: '',    label: 'III' },
        { semitones: 5,  quality: 'm',   label: 'iv' },
        { semitones: 7,  quality: 'm',   label: 'v' },
        { semitones: 8,  quality: '',    label: 'VI' },
        { semitones: 10, quality: '',    label: 'VII' }
    ];

    const PRESETS = {
        major: [
            { name: 'Pop',          degrees: [0, 4, 5, 3], label: 'I \u2013 V \u2013 vi \u2013 IV' },
            { name: 'Rock',         degrees: [0, 3, 4],    label: 'I \u2013 IV \u2013 V' },
            { name: '50s',          degrees: [0, 5, 3, 4], label: 'I \u2013 vi \u2013 IV \u2013 V' },
            { name: 'Axis',         degrees: [5, 3, 0, 4], label: 'vi \u2013 IV \u2013 I \u2013 V' },
            { name: 'Jazz ii-V-I',  degrees: [1, 4, 0],    label: 'ii \u2013 V \u2013 I' },
            { name: 'Pachelbel',    degrees: [0, 4, 5, 2, 3, 0, 3, 4], label: 'I\u2013V\u2013vi\u2013iii\u2013IV\u2013I\u2013IV\u2013V' },
        ],
        minor: [
            { name: 'Minor Pop',    degrees: [0, 5, 2, 6], label: 'i \u2013 VI \u2013 III \u2013 VII' },
            { name: 'Andalusian',   degrees: [0, 6, 5, 4], label: 'i \u2013 VII \u2013 VI \u2013 V' },
            { name: 'Minor Blues',  degrees: [0, 3, 4],    label: 'i \u2013 iv \u2013 v' },
        ]
    };

    // Display-friendly note name (prefer flats for flat keys)
    const DISPLAY_NAMES = {
        'C#': 'C\u266F / D\u266D', 'D#': 'E\u266D', 'F#': 'F\u266F / G\u266D',
        'G#': 'A\u266D', 'A#': 'B\u266D'
    };
    // Slug-friendly key name for URL generation
    const FLAT_DISPLAY = {
        'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb'
    };

    // ===== State =====

    let currentKey = 'C';
    let currentMode = 'major';
    let progression = []; // array of { name, degree, notes }
    let audioCtx = null;
    let playbackTimer = null;
    let isPlaying = false;
    let bpm = 100;
    let masterGain = null;      // single gain node for all playback — disconnect to stop
    let activeOscillators = []; // track oscillators for cleanup

    // ===== Music Theory Helpers =====

    function getNotes() {
        return window.SWARAM_NOTES || ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    }

    // Access CHORD_DIAGRAMS safely — it's a top-level const (not on window)
    function getChordDict() {
        return (typeof CHORD_DIAGRAMS !== 'undefined') ? CHORD_DIAGRAMS : null;
    }

    function getDiatonicChords(rootNote, mode) {
        const NOTES = getNotes();
        const scale = mode === 'minor' ? MINOR_SCALE : MAJOR_SCALE;
        const rootIdx = NOTES.indexOf(rootNote);
        if (rootIdx === -1) return [];
        var dict = getChordDict();

        return scale.map(function (deg) {
            const noteIdx = (rootIdx + deg.semitones) % 12;
            const note = NOTES[noteIdx];
            const chordName = note + deg.quality;
            const displayNote = FLAT_DISPLAY[note] || note;
            const displayName = displayNote + deg.quality;
            const data = dict ? dict[chordName] : null;
            return {
                name: chordName,
                displayName: displayName,
                degree: deg.label,
                quality: deg.quality,
                notes: data ? data.keys : [],
                guitar: data ? data.guitar : null
            };
        });
    }

    function noteToFreq(note, octave) {
        var NOTES = getNotes();
        var idx = NOTES.indexOf(note);
        if (idx === -1) return 440;
        // A4 = 440Hz, A is index 9, octave 4
        var semitonesFromA4 = (idx - 9) + (octave - 4) * 12;
        return 440 * Math.pow(2, semitonesFromA4 / 12);
    }

    function getChordFrequencies(chordName) {
        var dict = getChordDict();
        var data = dict ? dict[chordName] : null;
        if (!data || !data.keys) return [261.63, 329.63, 392.00]; // C major fallback
        // Spread notes across octaves 4-5 for pleasing sound
        return data.keys.map(function (note, i) {
            return noteToFreq(note, i < 3 ? 4 : 5);
        });
    }

    // ===== Web Audio Playback =====

    function getAudioContext() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        return audioCtx;
    }

    function playChordSound(frequencies, startTime, duration) {
        var ctx = getAudioContext();
        var chordGain = ctx.createGain();
        chordGain.gain.setValueAtTime(0.3 / frequencies.length, startTime);
        chordGain.gain.linearRampToValueAtTime(0.25 / frequencies.length, startTime + 0.02);
        chordGain.gain.setValueAtTime(0.25 / frequencies.length, startTime + duration - 0.1);
        chordGain.gain.linearRampToValueAtTime(0, startTime + duration);
        chordGain.connect(masterGain);

        frequencies.forEach(function (freq) {
            var osc = ctx.createOscillator();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, startTime);
            osc.connect(chordGain);
            osc.start(startTime);
            osc.stop(startTime + duration);
            activeOscillators.push(osc);
        });
    }

    function playProgression() {
        if (progression.length === 0) return;
        stopPlayback();

        var ctx = getAudioContext();
        isPlaying = true;
        updatePlayButton();

        // Create a fresh master gain for this playback session
        masterGain = ctx.createGain();
        masterGain.gain.setValueAtTime(1, ctx.currentTime);
        masterGain.connect(ctx.destination);

        function scheduleChords() {
            var beatDuration = 60 / bpm;
            var chordDuration = beatDuration * 2; // 2 beats per chord
            var startTime = ctx.currentTime + 0.1;
            var chordEls = document.querySelectorAll('.progression-chord');

            progression.forEach(function (chord, i) {
                var freqs = getChordFrequencies(chord.name);
                playChordSound(freqs, startTime + i * chordDuration, chordDuration - 0.05);
            });

            // Visual highlight sync
            var idx = 0;
            function highlightNext() {
                if (!isPlaying || idx >= progression.length) {
                    stopPlayback();
                    return;
                }
                chordEls.forEach(function (el) { el.classList.remove('play-highlight'); });
                if (chordEls[idx]) chordEls[idx].classList.add('play-highlight');
                idx++;
                playbackTimer = setTimeout(highlightNext, chordDuration * 1000);
            }
            highlightNext();
        }

        if (ctx.state === 'suspended') {
            ctx.resume().then(scheduleChords);
        } else {
            scheduleChords();
        }
    }

    function stopPlayback() {
        isPlaying = false;
        if (playbackTimer) {
            clearTimeout(playbackTimer);
            playbackTimer = null;
        }
        // Kill all audio immediately
        activeOscillators.forEach(function (osc) {
            try { osc.stop(); } catch (e) { /* already stopped */ }
        });
        activeOscillators = [];
        if (masterGain) {
            try { masterGain.disconnect(); } catch (e) {}
            masterGain = null;
        }
        document.querySelectorAll('.progression-chord').forEach(function (el) {
            el.classList.remove('play-highlight');
        });
        updatePlayButton();
    }

    function updatePlayButton() {
        var btn = document.getElementById('prog-play-btn');
        if (!btn) return;
        var t = window.t || function (k, fb) { return fb; };
        btn.textContent = isPlaying ? t('prog_stop', 'Stop') : t('prog_play', 'Play');
        btn.classList.toggle('active', isPlaying);
    }

    // ===== Progression Management =====

    function addToProgression(chord) {
        progression.push({
            name: chord.name,
            displayName: chord.displayName,
            degree: chord.degree,
            notes: chord.notes
        });
        renderTimeline();
    }

    function removeFromProgression(index) {
        progression.splice(index, 1);
        renderTimeline();
    }

    function clearProgression() {
        progression = [];
        stopPlayback();
        renderTimeline();
    }

    function loadPreset(preset) {
        var diatonic = getDiatonicChords(currentKey, currentMode);
        progression = preset.degrees.map(function (degIdx) {
            var chord = diatonic[degIdx];
            return {
                name: chord.name,
                displayName: chord.displayName,
                degree: chord.degree,
                notes: chord.notes
            };
        });
        stopPlayback();
        renderTimeline();
    }

    function exportProgressionText() {
        if (progression.length === 0) return '';
        var keyDisplay = getKeyDisplay(currentKey, currentMode);
        var chords = progression.map(function (c) { return c.displayName; }).join(' \u2192 ');
        return keyDisplay + ': ' + chords;
    }

    function copyToClipboard() {
        var text = exportProgressionText();
        if (!text) return;
        navigator.clipboard.writeText(text).then(function () {
            var btn = document.getElementById('prog-copy-btn');
            if (btn) {
                var t = window.t || function (k, fb) { return fb; };
                var orig = btn.textContent;
                btn.textContent = t('prog_copied', 'Copied!');
                setTimeout(function () { btn.textContent = orig; }, 1500);
            }
        });
    }

    // ===== Display Helpers =====

    function getKeyDisplay(root, mode) {
        var display = FLAT_DISPLAY[root] || root;
        return display + (mode === 'minor' ? ' Minor' : ' Major');
    }

    // ===== Rendering =====

    function renderDiatonicPalette() {
        var container = document.getElementById('diatonic-palette');
        if (!container) return;

        var diatonic = getDiatonicChords(currentKey, currentMode);
        var html = '';

        diatonic.forEach(function (chord, idx) {
            var miniGuitar = '';
            if (chord.guitar && typeof renderGuitarSVG === 'function') {
                miniGuitar = '<div class="diatonic-diagram">' + renderGuitarSVG(chord.guitar) + '</div>';
            }
            html += '<button class="diatonic-card" data-index="' + idx + '" title="Add ' + chord.displayName + ' to progression">' +
                '<span class="diatonic-degree">' + chord.degree + '</span>' +
                '<span class="diatonic-name">' + chord.displayName + '</span>' +
                miniGuitar +
                '</button>';
        });

        container.innerHTML = html;

        // Bind click handlers
        container.querySelectorAll('.diatonic-card').forEach(function (card) {
            card.addEventListener('click', function () {
                var idx = parseInt(this.getAttribute('data-index'));
                addToProgression(diatonic[idx]);
                // Brief visual feedback
                this.classList.add('selected');
                var self = this;
                setTimeout(function () { self.classList.remove('selected'); }, 300);
            });
        });
    }

    function renderPresets() {
        var container = document.getElementById('preset-buttons');
        if (!container) return;

        var presets = PRESETS[currentMode] || PRESETS.major;
        var html = '';

        presets.forEach(function (preset, idx) {
            html += '<button class="preset-btn" data-index="' + idx + '">' +
                '<span class="preset-name">' + preset.name + '</span>' +
                '<span class="preset-label">' + preset.label + '</span>' +
                '</button>';
        });

        container.innerHTML = html;

        container.querySelectorAll('.preset-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var idx = parseInt(this.getAttribute('data-index'));
                loadPreset(presets[idx]);
            });
        });
    }

    function renderTimeline() {
        var container = document.getElementById('progression-timeline');
        var controls = document.getElementById('progression-controls');
        var emptyMsg = document.getElementById('prog-empty');
        if (!container) return;

        if (progression.length === 0) {
            container.innerHTML = '';
            if (emptyMsg) emptyMsg.style.display = '';
            if (controls) controls.style.display = 'none';
            return;
        }

        if (emptyMsg) emptyMsg.style.display = 'none';
        if (controls) controls.style.display = '';

        var html = '';
        progression.forEach(function (chord, idx) {
            html += '<div class="progression-chord" data-index="' + idx + '">' +
                '<span class="prog-chord-degree">' + chord.degree + '</span>' +
                '<span class="prog-chord-name">' + chord.displayName + '</span>' +
                '<button class="prog-chord-remove" data-index="' + idx + '" title="Remove">&times;</button>' +
                '</div>';
            if (idx < progression.length - 1) {
                html += '<span class="prog-arrow">\u2192</span>';
            }
        });

        container.innerHTML = html;

        // Chord click → show diagram
        container.querySelectorAll('.prog-chord-name').forEach(function (el) {
            el.addEventListener('click', function (e) {
                e.stopPropagation();
                if (typeof showChordDiagram === 'function') {
                    var name = this.textContent.trim();
                    showChordDiagram(name, this);
                }
            });
        });

        // Remove buttons
        container.querySelectorAll('.prog-chord-remove').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var idx = parseInt(this.getAttribute('data-index'));
                removeFromProgression(idx);
            });
        });
    }

    function renderBpmDisplay() {
        var display = document.getElementById('bpm-display');
        if (display) display.textContent = bpm + ' BPM';
    }

    // ===== Key Selector =====

    function populateKeySelector() {
        var select = document.getElementById('key-selector');
        if (!select) return;

        var NOTES = getNotes();
        var html = '';

        // Major keys
        html += '<optgroup label="Major Keys">';
        NOTES.forEach(function (note) {
            var display = FLAT_DISPLAY[note] || note;
            html += '<option value="' + note + '-major"' + (note === currentKey && currentMode === 'major' ? ' selected' : '') + '>' + display + ' Major</option>';
        });
        html += '</optgroup>';

        // Minor keys
        html += '<optgroup label="Minor Keys">';
        NOTES.forEach(function (note) {
            var display = FLAT_DISPLAY[note] || note;
            html += '<option value="' + note + '-minor"' + (note === currentKey && currentMode === 'minor' ? ' selected' : '') + '>' + display + ' Minor</option>';
        });
        html += '</optgroup>';

        select.innerHTML = html;

        select.addEventListener('change', function () {
            var parts = this.value.split('-');
            currentKey = parts[0];
            currentMode = parts[1];
            clearProgression();
            renderDiatonicPalette();
            renderPresets();
        });
    }

    // ===== Init =====

    function init() {
        populateKeySelector();
        renderDiatonicPalette();
        renderPresets();
        renderTimeline();
        renderBpmDisplay();

        // Play button
        var playBtn = document.getElementById('prog-play-btn');
        if (playBtn) {
            playBtn.addEventListener('click', function () {
                if (isPlaying) stopPlayback(); else playProgression();
            });
        }

        // Copy button
        var copyBtn = document.getElementById('prog-copy-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', copyToClipboard);
        }

        // Clear button
        var clearBtn = document.getElementById('prog-clear-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', clearProgression);
        }

        // BPM controls
        var bpmDown = document.getElementById('bpm-down');
        var bpmUp = document.getElementById('bpm-up');
        if (bpmDown) {
            bpmDown.addEventListener('click', function () {
                bpm = Math.max(40, bpm - 10);
                renderBpmDisplay();
            });
        }
        if (bpmUp) {
            bpmUp.addEventListener('click', function () {
                bpm = Math.min(200, bpm + 10);
                renderBpmDisplay();
            });
        }
    }

    // Wait for DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
