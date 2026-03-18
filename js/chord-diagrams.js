// Swaram - Chord Diagrams (Guitar + Keyboard SVG Renderer)

const CHORD_DIAGRAMS = {
    // Major chords
    "C":  { guitar: { frets: [-1,3,2,0,1,0], startFret: 0 }, keys: ["C","E","G"] },
    "D":  { guitar: { frets: [-1,-1,0,2,3,2], startFret: 0 }, keys: ["D","F#","A"] },
    "E":  { guitar: { frets: [0,2,2,1,0,0], startFret: 0 }, keys: ["E","G#","B"] },
    "F":  { guitar: { frets: [1,1,2,3,3,1], startFret: 1, barre: 1 }, keys: ["F","A","C"] },
    "G":  { guitar: { frets: [3,2,0,0,0,3], startFret: 0 }, keys: ["G","B","D"] },
    "A":  { guitar: { frets: [-1,0,2,2,2,0], startFret: 0 }, keys: ["A","C#","E"] },
    "B":  { guitar: { frets: [-1,2,4,4,4,2], startFret: 2, barre: 2 }, keys: ["B","D#","F#"] },

    // Minor chords
    "Cm": { guitar: { frets: [-1,3,5,5,4,3], startFret: 3, barre: 3 }, keys: ["C","D#","G"] },
    "Dm": { guitar: { frets: [-1,-1,0,2,3,1], startFret: 0 }, keys: ["D","F","A"] },
    "Em": { guitar: { frets: [0,2,2,0,0,0], startFret: 0 }, keys: ["E","G","B"] },
    "Fm": { guitar: { frets: [1,1,1,3,3,1], startFret: 1, barre: 1 }, keys: ["F","G#","C"] },
    "Gm": { guitar: { frets: [3,5,5,3,3,3], startFret: 3, barre: 3 }, keys: ["G","A#","D"] },
    "Am": { guitar: { frets: [-1,0,2,2,1,0], startFret: 0 }, keys: ["A","C","E"] },
    "Bm": { guitar: { frets: [-1,2,4,4,3,2], startFret: 2, barre: 2 }, keys: ["B","D","F#"] },

    // 7th chords
    "C7":  { guitar: { frets: [-1,3,2,3,1,0], startFret: 0 }, keys: ["C","E","G","A#"] },
    "D7":  { guitar: { frets: [-1,-1,0,2,1,2], startFret: 0 }, keys: ["D","F#","A","C"] },
    "E7":  { guitar: { frets: [0,2,0,1,0,0], startFret: 0 }, keys: ["E","G#","B","D"] },
    "G7":  { guitar: { frets: [3,2,0,0,0,1], startFret: 0 }, keys: ["G","B","D","F"] },
    "A7":  { guitar: { frets: [-1,0,2,0,2,0], startFret: 0 }, keys: ["A","C#","E","G"] },
    "B7":  { guitar: { frets: [-1,2,1,2,0,2], startFret: 0 }, keys: ["B","D#","F#","A"] },

    // Suspended
    "Gsus4": { guitar: { frets: [3,3,0,0,1,3], startFret: 0 }, keys: ["G","C","D"] },
    "Dsus4": { guitar: { frets: [-1,-1,0,2,3,3], startFret: 0 }, keys: ["D","G","A"] },

    // Major 7th
    "CM7":  { guitar: { frets: [-1,3,2,0,0,0], startFret: 0 }, keys: ["C","E","G","B"] },
    "Dm7":  { guitar: { frets: [-1,-1,0,2,1,1], startFret: 0 }, keys: ["D","F","A","C"] },
    "Em9":  { guitar: { frets: [0,2,0,0,0,2], startFret: 0 }, keys: ["E","G","B","F#"] },
};

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

function showChordDiagram(chordName, anchorEl) {
    // Close existing tooltip
    closeChordDiagram();

    // Normalize: strip qualities to find base
    const data = CHORD_DIAGRAMS[chordName];
    if (!data) return; // No diagram available

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'chord-diagram-overlay';
    overlay.onclick = closeChordDiagram;

    // Create tooltip
    const tooltip = document.createElement('div');
    tooltip.className = 'chord-diagram-tooltip';
    tooltip.id = 'chord-tooltip';

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
            ${renderGuitarSVG(data.guitar)}
        </div>
        <div class="diagram-panel" id="panel-keyboard">
            ${renderKeyboardSVG(data.keys)}
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
    if (chordName) {
        showChordDiagram(chordName, chordEl);
    }
});
