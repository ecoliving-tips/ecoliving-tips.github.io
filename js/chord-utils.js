/**
 * chord-utils.js — Shared chord logic (transpose, simplify, capo, difficulty).
 * Used by chord-finder.js and chord-page-player.js.
 * NOTE: Keep build.js beginner functions in sync with this file.
 */
window.ChordUtils = (function () {
    'use strict';

    const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const FLAT_MAP = { 'Db': 'C#', 'Eb': 'D#', 'Fb': 'E', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#', 'Cb': 'B' };

    const BEGINNER_CHORDS = new Set([
        'C', 'D', 'E', 'F', 'G', 'A',
        'Am', 'Dm', 'Em',
        'A7', 'B7', 'D7', 'E7', 'G7'
    ]);

    const BEGINNER_7THS = new Set(['A7', 'B7', 'D7', 'E7', 'G7']);

    function transposeChord(chord, semitones) {
        if (!chord || semitones === 0) return chord;
        if (chord.includes('/')) {
            var parts = chord.split('/');
            return transposeChord(parts[0], semitones) + '/' + transposeChord(parts[1], semitones);
        }
        var match = chord.match(/^([A-G][#b]?)(.*)/);
        if (!match) return chord;
        var root = match[1];
        var quality = match[2];
        if (FLAT_MAP[root]) root = FLAT_MAP[root];
        var rootIndex = NOTES.indexOf(root);
        if (rootIndex < 0) return chord;
        var newIndex = ((rootIndex + semitones) % 12 + 12) % 12;
        return NOTES[newIndex] + quality;
    }

    function simplifyChord(chord) {
        if (!chord) return chord;
        if (chord.includes('/')) chord = chord.split('/')[0];
        var match = chord.match(/^([A-G][#b]?)(.*)/);
        if (!match) return chord;
        var root = match[1];
        var quality = match[2];
        if (FLAT_MAP[root]) root = FLAT_MAP[root];
        if (quality === '5') return root;
        if (/^m?1[13]/.test(quality)) return root + (quality.startsWith('m') ? 'm' : '');
        if (/m?.*9/.test(quality)) {
            var isMinor = quality.startsWith('m') && !quality.startsWith('maj');
            return root + (isMinor ? 'm' : '');
        }
        if (quality === '7sus4') return root;
        if (quality === 'm7b5') return root + 'm';
        if (quality === 'dim') return root + 'm';
        if (quality === 'aug') return root;
        if (quality === '6') return root;
        if (quality === 'm6') return root + 'm';
        if (quality === 'sus4' || quality === 'sus2') return root;
        if (quality === 'add2') return root;
        if (quality === 'M7' || quality === 'maj7') return root;
        if (quality === 'm7') return root + 'm';
        if (quality.startsWith('7')) {
            return BEGINNER_7THS.has(root + '7') ? root + '7' : root;
        }
        return root + quality;
    }

    function findOptimalCapo(chordEvents, currentTranspose) {
        if (!chordEvents || !chordEvents.length) return { capo: 0 };
        currentTranspose = currentTranspose || 0;
        var uniqueSimplified = [];
        var seen = {};
        for (var i = 0; i < chordEvents.length; i++) {
            var s = simplifyChord(chordEvents[i].chord);
            if (!seen[s]) { seen[s] = true; uniqueSimplified.push(s); }
        }
        var bestCapo = 0;
        var bestScore = -1;
        for (var capo = 0; capo <= 7; capo++) {
            var score = 0;
            for (var j = 0; j < uniqueSimplified.length; j++) {
                var t = transposeChord(uniqueSimplified[j], -capo + currentTranspose);
                if (BEGINNER_CHORDS.has(t)) score++;
            }
            if (score > bestScore) { bestScore = score; bestCapo = capo; }
        }
        return { capo: bestCapo };
    }

    function computeDifficulty(chordEvents, capo, currentTranspose) {
        if (!chordEvents || !chordEvents.length) return 'easy';
        currentTranspose = currentTranspose || 0;
        var seen = {};
        var unique = [];
        for (var i = 0; i < chordEvents.length; i++) {
            var s = simplifyChord(chordEvents[i].chord);
            var t = transposeChord(s, -capo + currentTranspose);
            if (!seen[t]) { seen[t] = true; unique.push(t); }
        }
        var beginnerCount = 0;
        for (var j = 0; j < unique.length; j++) {
            if (BEGINNER_CHORDS.has(unique[j])) beginnerCount++;
        }
        var ratio = beginnerCount / unique.length;
        if (ratio >= 1) return 'easy';
        if (ratio >= 0.7) return 'moderate';
        return 'advanced';
    }

    function getDisplayChord(rawChord, beginnerMode, capoPosition, currentTranspose) {
        var chord = rawChord;
        if (beginnerMode) {
            chord = simplifyChord(chord);
            chord = transposeChord(chord, -capoPosition + currentTranspose);
        } else {
            chord = transposeChord(chord, currentTranspose);
        }
        return chord;
    }

    return {
        NOTES: NOTES,
        FLAT_MAP: FLAT_MAP,
        BEGINNER_CHORDS: BEGINNER_CHORDS,
        BEGINNER_7THS: BEGINNER_7THS,
        transposeChord: transposeChord,
        simplifyChord: simplifyChord,
        findOptimalCapo: findOptimalCapo,
        computeDifficulty: computeDifficulty,
        getDisplayChord: getDisplayChord
    };
})();
