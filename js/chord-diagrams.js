// Swaram - Chord Diagrams (Guitar + Keyboard SVG Renderer)
// Comprehensive chord dictionary: all 12 roots × 13 types + flat aliases

const CHORD_DIAGRAMS = {};

// ===== Chord Generation =====
(function buildChordDictionary() {
    const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const FLAT_ALIASES = { 'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb' };

    // Keyboard note intervals (semitones from root)
    const INTERVALS = {
        '':     [0, 4, 7],            // Major
        'm':    [0, 3, 7],            // Minor
        '7':    [0, 4, 7, 10],        // Dominant 7th
        'm7':   [0, 3, 7, 10],        // Minor 7th
        'M7':   [0, 4, 7, 11],        // Major 7th
        'sus2': [0, 2, 7],            // Suspended 2nd
        'sus4': [0, 5, 7],            // Suspended 4th
        'dim':  [0, 3, 6],            // Diminished
        'aug':  [0, 4, 8],            // Augmented
        '6':    [0, 4, 7, 9],         // Major 6th
        'm6':   [0, 3, 7, 9],         // Minor 6th
        '9':    [0, 4, 7, 10, 14],    // Dominant 9th
        'm9':   [0, 3, 7, 10, 14],    // Minor 9th
        'm7b5': [0, 3, 6, 10],        // Half-diminished (minor 7 flat 5)
    };

    // Guitar barre patterns: E-shape (root on low E string, fret N)
    // Derived from open E voicings shifted up the neck
    // Array order: [E, A, D, G, B, e] (low to high)
    var E = {
        //                    E     A     D     G     B     e
        '':     function(n){return [n,  n+2,  n+2,  n+1,  n,    n   ]}, // E major shape
        'm':    function(n){return [n,  n+2,  n+2,  n,    n,    n   ]}, // E minor shape
        '7':    function(n){return [n,  n+2,  n,    n+1,  n,    n   ]}, // E7 shape
        'm7':   function(n){return [n,  n+2,  n,    n,    n,    n   ]}, // Em7 shape
        'M7':   function(n){return [n,  n+2,  n+1,  n+1,  n,    n   ]}, // Emaj7 shape
        'sus4': function(n){return [n,  n+2,  n+2,  n+2,  n,    n   ]}, // Esus4 shape
        '9':    function(n){return [n,  n+2,  n,    n+1,  n,    n+2 ]}, // E9 shape
        'm9':   function(n){return [n,  n+2,  n,    n,    n,    n+2 ]}, // Em9 shape
        'm7b5': function(n){return [n,  n+1,  n,    n,    n,    -1  ]}, // Em7b5 shape
    };

    // Guitar barre patterns: A-shape (root on A string, fret N)
    var A = {
        //                    E     A     D     G     B     e
        '':     function(n){return [-1,  n,   n+2,  n+2,  n+2,  n   ]}, // A major shape
        'm':    function(n){return [-1,  n,   n+2,  n+2,  n+1,  n   ]}, // A minor shape
        '7':    function(n){return [-1,  n,   n+2,  n,    n+2,  n   ]}, // A7 shape
        'm7':   function(n){return [-1,  n,   n+2,  n,    n+1,  n   ]}, // Am7 shape
        'M7':   function(n){return [-1,  n,   n+2,  n+1,  n+2,  n   ]}, // Amaj7 shape
        'sus2': function(n){return [-1,  n,   n+2,  n+2,  n,    n   ]}, // Asus2 shape
        'sus4': function(n){return [-1,  n,   n+2,  n+2,  n+3,  n   ]}, // Asus4 shape
        'dim':  function(n){return [-1,  n,   n+1,  n+2,  n+1,  -1  ]}, // Adim shape
        'aug':  function(n){return [-1,  n,   n+3,  n+2,  n+2,  -1  ]}, // Aaug shape
        '6':    function(n){return [-1,  n,   n+2,  n+2,  n+2,  n+2 ]}, // A6 shape
        'm6':   function(n){return [-1,  n,   n+2,  n+2,  n+1,  n+2 ]}, // Am6 shape
        'm7b5': function(n){return [-1,  n,   n+1,  n,    n+1,  -1  ]}, // Am7b5 shape
    };

    // E-string fret for each root note
    var eFret = { C:8, 'C#':9, D:10, 'D#':11, E:0, F:1, 'F#':2, G:3, 'G#':4, A:5, 'A#':6, B:7 };
    // A-string fret for each root note
    var aFret = { C:3, 'C#':4, D:5, 'D#':6, E:7, F:8, 'F#':9, G:10, 'G#':11, A:0, 'A#':1, B:2 };

    function getKeys(rootIdx, intervals) {
        return intervals.map(function(i) { return NOTES[(rootIdx + i) % 12]; });
    }

    function makeGuitar(shape, fret) {
        var frets = shape(fret);
        var barre = fret > 0 ? fret : undefined;
        var startFret = fret > 0 ? fret : 0;
        var result = { frets: frets, startFret: startFret };
        if (barre) result.barre = barre;
        return result;
    }

    // Hand-crafted open voicings (nicer sounding than barre equivalents)
    var OPEN = {
        'C':     { frets: [-1,3,2,0,1,0], startFret: 0 },
        'D':     { frets: [-1,-1,0,2,3,2], startFret: 0 },
        'G':     { frets: [3,2,0,0,0,3], startFret: 0 },
        'Dm':    { frets: [-1,-1,0,2,3,1], startFret: 0 },
        'Em':    { frets: [0,2,2,0,0,0], startFret: 0 },
        'Am':    { frets: [-1,0,2,2,1,0], startFret: 0 },
        'C7':    { frets: [3,3,2,3,1,0], startFret: 0 },
        'D7':    { frets: [-1,-1,0,2,1,2], startFret: 0 },
        'E7':    { frets: [0,2,0,1,0,0], startFret: 0 },
        'G7':    { frets: [3,2,0,0,0,1], startFret: 0 },
        'A7':    { frets: [-1,0,2,0,2,0], startFret: 0 },
        'B7':    { frets: [-1,2,1,2,0,2], startFret: 0 },
        'Dm7':   { frets: [-1,-1,0,2,1,1], startFret: 0 },
        'CM7':   { frets: [-1,3,2,0,0,0], startFret: 0 },
        'Em9':   { frets: [0,2,0,0,0,2], startFret: 0 },
        'Gsus4': { frets: [3,3,0,0,1,3], startFret: 0 },
        'Dsus4': { frets: [-1,-1,0,2,3,3], startFret: 0 },
        'Asus2': { frets: [-1,0,2,2,0,0], startFret: 0 },
        'Dsus2': { frets: [-1,-1,0,2,3,0], startFret: 0 },
        'Eb':    { frets: [-1,-1,1,3,4,3], startFret: 1 },
    };

    // Generate all chords
    for (var rootIdx = 0; rootIdx < 12; rootIdx++) {
        var root = NOTES[rootIdx];

        for (var quality in INTERVALS) {
            var name = root + quality;
            var keys = getKeys(rootIdx, INTERVALS[quality]);
            var guitar;

            // Use open voicing if available
            if (OPEN[name]) {
                guitar = OPEN[name];
            } else {
                // Pick best barre shape: prefer lower fret positions
                var ef = eFret[root];
                var af = aFret[root];
                var eShape = E[quality];
                var aShape = A[quality];

                if (eShape && aShape) {
                    // Both available: pick whichever gives a lower fret position
                    guitar = ef <= af ? makeGuitar(eShape, ef) : makeGuitar(aShape, af);
                } else if (eShape) {
                    guitar = makeGuitar(eShape, ef);
                } else if (aShape) {
                    guitar = makeGuitar(aShape, af);
                } else {
                    guitar = null;
                }
            }

            if (guitar) {
                CHORD_DIAGRAMS[name] = { guitar: guitar, keys: keys };
            } else {
                CHORD_DIAGRAMS[name] = { keys: keys };
            }

            // Add flat-name alias
            var flat = FLAT_ALIASES[root];
            if (flat) {
                CHORD_DIAGRAMS[flat + quality] = CHORD_DIAGRAMS[name];
            }
        }
    }
})();

// All white and black key names for one octave
const PIANO_KEYS = [
    { note: "C", type: "white" },
    { note: "C#", type: "black" },
    { note: "D", type: "white" },
    { note: "D#", type: "black" },
    { note: "E", type: "white" },
    { note: "F", type: "white" },
    { note: "F#", type: "black" },
    { note: "G", type: "white" },
    { note: "G#", type: "black" },
    { note: "A", type: "white" },
    { note: "A#", type: "black" },
    { note: "B", type: "white" }
];

function renderGuitarSVG(data) {
    const { frets, startFret, barre } = data;
    const w = 120, h = 160;
    const stringSpacing = 18, fretSpacing = 28;
    const startX = 20, startY = 30;
    let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;

    // Fret position label
    if (startFret > 0) {
        svg += `<text x="${startX - 14}" y="${startY + fretSpacing - 4}" fill="#9B8FC2" font-size="11" text-anchor="middle">${startFret}</text>`;
    }

    // Nut (thick line at top if open position)
    if (startFret === 0) {
        svg += `<rect x="${startX}" y="${startY - 2}" width="${stringSpacing * 5}" height="4" fill="#F1EFFA" rx="1"/>`;
    }

    // Fret lines
    for (let f = 0; f <= 4; f++) {
        const y = startY + f * fretSpacing;
        svg += `<line x1="${startX}" y1="${y}" x2="${startX + stringSpacing * 5}" y2="${y}" stroke="#6B5F8A" stroke-width="1"/>`;
    }

    // String lines
    for (let s = 0; s < 6; s++) {
        const x = startX + s * stringSpacing;
        svg += `<line x1="${x}" y1="${startY}" x2="${x}" y2="${startY + fretSpacing * 4}" stroke="#9B8FC2" stroke-width="1"/>`;
    }

    // Barre
    if (barre) {
        const barreY = startY + fretSpacing * 0.5;
        const barreStrings = [];
        frets.forEach((f, i) => { if (f === barre) barreStrings.push(i); });
        if (barreStrings.length >= 2) {
            const x1 = startX + barreStrings[0] * stringSpacing;
            const x2 = startX + barreStrings[barreStrings.length - 1] * stringSpacing;
            svg += `<rect x="${x1 - 4}" y="${barreY - 5}" width="${x2 - x1 + 8}" height="10" rx="5" fill="#8B5CF6"/>`;
        }
    }

    // Finger dots + open/muted indicators
    frets.forEach((fret, string) => {
        const x = startX + string * stringSpacing;
        if (fret === -1) {
            svg += `<text x="${x}" y="${startY - 8}" fill="#EC4899" font-size="12" text-anchor="middle">x</text>`;
        } else if (fret === 0) {
            svg += `<circle cx="${x}" cy="${startY - 10}" r="4" fill="none" stroke="#8B5CF6" stroke-width="1.5"/>`;
        } else {
            const relativeFret = fret - (startFret > 0 ? startFret - 1 : 0);
            const y = startY + (relativeFret - 0.5) * fretSpacing;
            if (!barre || fret !== barre) {
                svg += `<circle cx="${x}" cy="${y}" r="6" fill="#8B5CF6"/>`;
            }
        }
    });

    // String labels at bottom
    const labels = ['E','A','D','G','B','e'];
    labels.forEach((label, i) => {
        const x = startX + i * stringSpacing;
        svg += `<text x="${x}" y="${startY + fretSpacing * 4 + 16}" fill="#6B5F8A" font-size="9" text-anchor="middle">${label}</text>`;
    });

    svg += '</svg>';
    return svg;
}

function renderKeyboardSVG(activeKeys) {
    const w = 200, h = 90;
    const whiteW = 26, whiteH = 70;
    const blackW = 16, blackH = 44;
    const startX = 8, startY = 10;

    let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;

    const whiteKeys = PIANO_KEYS.filter(k => k.type === 'white');
    const isActive = (note) => activeKeys.includes(note);

    // White keys
    whiteKeys.forEach((key, i) => {
        const x = startX + i * whiteW;
        const active = isActive(key.note);
        svg += `<rect x="${x}" y="${startY}" width="${whiteW - 1}" height="${whiteH}" rx="2" fill="${active ? '#8B5CF6' : '#F1EFFA'}" stroke="#6B5F8A" stroke-width="1"/>`;
        if (active) {
            svg += `<text x="${x + whiteW / 2 - 0.5}" y="${startY + whiteH - 6}" fill="#fff" font-size="9" text-anchor="middle" font-weight="600">${key.note}</text>`;
        }
    });

    // Black keys
    const blackPositions = [0, 1, 3, 4, 5]; // C# D# F# G# A#
    const blackNotes = ["C#", "D#", "F#", "G#", "A#"];
    blackPositions.forEach((pos, i) => {
        const x = startX + pos * whiteW + whiteW * 0.65;
        const active = isActive(blackNotes[i]);
        svg += `<rect x="${x}" y="${startY}" width="${blackW}" height="${blackH}" rx="2" fill="${active ? '#EC4899' : '#1A1425'}" stroke="#6B5F8A" stroke-width="0.5"/>`;
        if (active) {
            svg += `<text x="${x + blackW / 2}" y="${startY + blackH - 5}" fill="#fff" font-size="7" text-anchor="middle" font-weight="600">${blackNotes[i]}</text>`;
        }
    });

    svg += '</svg>';
    return svg;
}

// Compute guitar voicing for slash chords (e.g., Cm/A = Cm with A as lowest note)
// Uses hand-crafted voicings for known slash chords, with algorithmic fallback
function getSlashChordGuitar(originalData, bassNote, chordName) {
    // Hand-crafted playable voicings for common slash chords
    // Array order: [E, A, D, G, B, e] — -1 = muted, 0 = open
    var SLASH_VOICINGS = {
        'C/E':   { frets: [0, 3, 2, 0, 1, 0], startFret: 0 },
        'C/G':   { frets: [3, 3, 2, 0, 1, 0], startFret: 0 },
        'D/F#':  { frets: [2, 0, 0, 2, 3, 2], startFret: 0 },
        'G/B':   { frets: [-1, 2, 0, 0, 0, 3], startFret: 0 },
        'G/F#':  { frets: [2, 2, 0, 0, 0, 3], startFret: 0 },
        'Am/E':  { frets: [0, 0, 2, 2, 1, 0], startFret: 0 },
        'Am/G':  { frets: [3, 0, 2, 2, 1, 0], startFret: 0 },
        'Am/C':  { frets: [-1, 3, 2, 2, 1, 0], startFret: 0 },
        'Em/D':  { frets: [-1, -1, 0, 0, 0, 0], startFret: 0 },
        'Em/B':  { frets: [-1, 2, 2, 0, 0, 0], startFret: 0 },
        'Dm/F':  { frets: [1, 0, 0, 2, 3, 1], startFret: 0 },
        'Dm/C':  { frets: [-1, 3, 0, 2, 3, 1], startFret: 0 },
        'F/C':   { frets: [-1, 3, 3, 2, 1, 1], startFret: 1 },
        'F/A':   { frets: [-1, 0, 3, 2, 1, 1], startFret: 0 },
        'Cm/Bb': { frets: [-1, 1, 1, 0, 1, -1], startFret: 0 },
        'Cm/Eb': { frets: [-1, -1, 1, 0, 1, 3], startFret: 0 },
        'Cm/G':  { frets: [3, 3, 5, 5, 4, 3], startFret: 3, barre: 3 },
        'Cm/A':  { frets: [-1, 0, 1, 0, 1, 3], startFret: 0 },
    };

    if (SLASH_VOICINGS[chordName]) return SLASH_VOICINGS[chordName];

    // Algorithmic fallback: try to place bass note on E or A string
    const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const FLAT_TO_SHARP = { 'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#' };
    const bass = FLAT_TO_SHARP[bassNote] || bassNote;
    const bassIdx = NOTES.indexOf(bass);
    if (bassIdx === -1) return originalData;

    // Open string note indices: E=4, A=9
    var bassOnE = (bassIdx - 4 + 12) % 12;
    var bassOnA = (bassIdx - 9 + 12) % 12;

    var frets = originalData.frets.slice();
    var changed = false;

    if (bassOnE === 0) {
        frets[0] = 0;
        changed = true;
    } else if (bassOnA === 0) {
        frets[0] = -1;
        frets[1] = 0;
        changed = true;
    } else if (bassOnA <= 3 && frets[0] === -1) {
        // A string with low fret, E already muted
        frets[1] = bassOnA;
        changed = true;
    }

    if (!changed) return originalData;

    // Check playability: max fret span ≤ 4
    var playedFrets = frets.filter(function(f) { return f > 0; });
    if (playedFrets.length === 0) return { frets: frets, startFret: 0 };

    var minFret = Math.min.apply(null, playedFrets);
    var maxFret = Math.max.apply(null, playedFrets);
    if (maxFret - minFret > 4) return originalData;

    var startFret = minFret > 3 ? minFret : 0;
    var result = { frets: frets, startFret: startFret };
    if (startFret > 0) {
        var barreCount = frets.filter(function(f) { return f === minFret; }).length;
        if (barreCount >= 2) result.barre = minFret;
    }
    return result;
}

function showChordDiagram(chordName, anchorEl) {
    // Close existing tooltip
    closeChordDiagram();

    // For slash chords like Cm/A, show diagram for the root chord (Cm) with bass note
    const lookupName = chordName.includes('/') ? chordName.split('/')[0] : chordName;
    // Normalize: strip parens, convert "maj7" → "M7" to match diagram dictionary
    const normalizedName = lookupName.replace(/[()]/g, '').replace(/maj7$/, 'M7');
    const bassNote = chordName.includes('/') ? chordName.split('/')[1] : null;
    const data = CHORD_DIAGRAMS[normalizedName];
    if (!data) {
        // Show a brief tooltip indicating no diagram is available
        closeChordDiagram();
        const overlay = document.createElement('div');
        overlay.className = 'chord-diagram-overlay';
        overlay.onclick = closeChordDiagram;

        const tooltip = document.createElement('div');
        tooltip.className = 'chord-diagram-tooltip';
        tooltip.id = 'chord-tooltip';
        tooltip.innerHTML = `
            <div class="tooltip-header">
                <h4>${chordName}</h4>
                <button class="tooltip-close" onclick="closeChordDiagram()">&times;</button>
            </div>
            <p style="padding:1.5em;color:#9B8FC2;text-align:center;">No diagram available for this chord</p>
        `;
        document.body.appendChild(overlay);
        document.body.appendChild(tooltip);

        const rect = anchorEl.getBoundingClientRect();
        tooltip.style.top = (rect.bottom + 8) + 'px';
        tooltip.style.left = Math.max(8, rect.left) + 'px';
        return;
    }

    // Build slash chord data with correct bass note in diagrams
    let guitarData = data.guitar;
    let keyboardKeys = data.keys;

    if (bassNote) {
        // Add bass note to keyboard keys if not already present
        if (!keyboardKeys.includes(bassNote)) {
            keyboardKeys = [bassNote].concat(keyboardKeys);
        }

        // Adjust guitar voicing to include bass note on lowest possible string
        if (guitarData) {
            guitarData = getSlashChordGuitar(guitarData, bassNote, chordName);
        }
    }

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'chord-diagram-overlay';
    overlay.onclick = closeChordDiagram;

    // Create tooltip
    const tooltip = document.createElement('div');
    tooltip.className = 'chord-diagram-tooltip';
    tooltip.id = 'chord-tooltip';

    const guitarPanel = guitarData
        ? renderGuitarSVG(guitarData)
        : '<p style="padding:1em;color:#9B8FC2;text-align:center;">No guitar diagram</p>';

    tooltip.innerHTML = `
        <div class="tooltip-header">
            <h4>${chordName}</h4>
            <button class="tooltip-close" onclick="closeChordDiagram()">&times;</button>
        </div>
        <div class="diagram-tabs">
            <button class="diagram-tab active" onclick="switchDiagramTab('guitar', this)">Guitar</button>
            <button class="diagram-tab" onclick="switchDiagramTab('keyboard', this)">Keyboard</button>
        </div>
        <div class="diagram-panel active" id="panel-guitar">
            ${guitarPanel}
        </div>
        <div class="diagram-panel" id="panel-keyboard">
            ${renderKeyboardSVG(keyboardKeys)}
        </div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(tooltip);

    // Position tooltip near the anchor element
    const rect = anchorEl.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    let top = rect.bottom + 8;
    let left = rect.left;

    // Keep within viewport
    if (top + tooltipRect.height > window.innerHeight) {
        top = rect.top - tooltipRect.height - 8;
    }
    if (left + tooltipRect.width > window.innerWidth) {
        left = window.innerWidth - tooltipRect.width - 8;
    }
    if (left < 8) left = 8;

    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';
}

function closeChordDiagram() {
    const tooltip = document.getElementById('chord-tooltip');
    const overlay = document.querySelector('.chord-diagram-overlay');
    if (tooltip) tooltip.remove();
    if (overlay) overlay.remove();
}

function switchDiagramTab(tab, btn) {
    document.querySelectorAll('.diagram-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.diagram-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-' + tab).classList.add('active');
}

// Attach click handler to all chord elements
document.addEventListener('click', function(e) {
    const chordEl = e.target.closest('.chord-name:not(.empty), .chord');
    if (!chordEl) return;

    const chordName = chordEl.textContent.trim();
    if (chordName && chordName !== '-') {
        showChordDiagram(chordName, chordEl);
    }
});
