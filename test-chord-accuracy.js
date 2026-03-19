/**
 * Swaram Chord Accuracy Test
 *
 * Compares AI-detected chords against hand-written chords in .md files.
 * Run: node test-chord-accuracy.js [chord-service-url]
 *
 * Requires the chord-service to be running.
 * Default URL: http://localhost:8000
 */

const fs = require('fs');
const path = require('path');

const SERVICE_URL = process.argv[2] || 'http://localhost:8000';
const ROOT = __dirname;

// ===== Parse songs to test =====
const TEST_SONGS = [
    {
        id: 'anna-pesaha',
        file: 'anna-pesaha.md',
        youtubeUrl: 'https://youtube.com/watch?v=CGfSjeFkL-0',
        expectedKey: 'C',
        expectedTime: '3/4',
    },
    {
        id: 'krooshakum-meshayil',
        file: 'krooshakum-meshayil.md',
        youtubeUrl: 'https://www.youtube.com/watch?v=AwzKPOERtyE',
        expectedKey: 'Cm',
        expectedTime: '3/4',
    },
];

// ===== Extract chords from .md file =====
function extractChordsFromMd(filepath) {
    const content = fs.readFileSync(filepath, 'utf-8').replace(/\r\n/g, '\n');
    const chords = new Set();

    const lines = content.split('\n');
    for (const line of lines) {
        // Chord-lyric lines: [Chord]text
        const chordMatches = line.matchAll(/\[([^\]]+)\]/g);
        for (const m of chordMatches) {
            chords.add(m[1]);
        }

        // Chord progression lines: || C | Am | G ||
        if (line.trim().startsWith('||') && line.trim().endsWith('||')) {
            const inner = line.replace(/^\|\||\|\|$/g, '').trim();
            const parts = inner.split('|').map(s => s.trim()).filter(Boolean);
            for (const chord of parts) {
                chords.add(chord);
            }
        }
    }

    return [...chords].sort();
}

// ===== Normalize chord name for comparison =====
function normalizeChord(chord) {
    // Normalize flats to sharps for comparison
    const flatMap = {
        'Db': 'C#', 'Eb': 'D#', 'Fb': 'E', 'Gb': 'F#',
        'Ab': 'G#', 'Bb': 'A#', 'Cb': 'B',
    };

    let normalized = chord;
    for (const [flat, sharp] of Object.entries(flatMap)) {
        if (normalized.startsWith(flat)) {
            normalized = sharp + normalized.slice(flat.length);
            break;
        }
    }
    return normalized;
}

// ===== Call chord service =====
async function analyzeVideo(url) {
    const response = await fetch(`${SERVICE_URL}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Service error ${response.status}: ${text}`);
    }

    return response.json();
}

// ===== Compare chords =====
function compareChords(detected, expected) {
    const detectedNorm = new Set(detected.map(normalizeChord));
    const expectedNorm = new Set(expected.map(normalizeChord));

    const matched = [...expectedNorm].filter(c => detectedNorm.has(c));
    const missed = [...expectedNorm].filter(c => !detectedNorm.has(c));
    const extra = [...detectedNorm].filter(c => !expectedNorm.has(c));

    const precision = detected.length > 0 ? matched.length / detectedNorm.size : 0;
    const recall = expected.length > 0 ? matched.length / expectedNorm.size : 0;
    const f1 = (precision + recall) > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

    return { matched, missed, extra, precision, recall, f1 };
}

// ===== Main =====
async function main() {
    console.log('Swaram Chord Accuracy Test');
    console.log(`Service URL: ${SERVICE_URL}\n`);

    // Check service health
    try {
        const health = await fetch(`${SERVICE_URL}/health`);
        if (!health.ok) throw new Error('Not OK');
        console.log('Service health: OK\n');
    } catch (e) {
        console.error(`ERROR: Cannot reach chord service at ${SERVICE_URL}`);
        console.error('Make sure the chord-service is running.');
        console.error('  cd chord-service && python app.py');
        process.exit(1);
    }

    for (const song of TEST_SONGS) {
        console.log(`${'='.repeat(60)}`);
        console.log(`Song: ${song.id}`);
        console.log(`YouTube: ${song.youtubeUrl}`);
        console.log(`Expected key: ${song.expectedKey}, Time: ${song.expectedTime}`);
        console.log('');

        // Get expected chords from .md
        const mdPath = path.join(ROOT, 'songs', song.file);
        const expectedChords = extractChordsFromMd(mdPath);
        console.log(`Hand-written chords (${expectedChords.length}): ${expectedChords.join(', ')}`);

        // Call chord service
        console.log('\nAnalyzing with AI...');
        try {
            const result = await analyzeVideo(song.youtubeUrl);

            // Unique detected chord names
            const detectedUnique = [...new Set(result.chords.map(c => c.chord))].sort();
            console.log(`Detected chords (${detectedUnique.length}): ${detectedUnique.join(', ')}`);
            console.log(`Detected key: ${result.key}, BPM: ${result.bpm}, Time: ${result.timeSignature}`);

            // Compare
            const comparison = compareChords(detectedUnique, expectedChords);
            console.log(`\nResults:`);
            console.log(`  Matched:   ${comparison.matched.join(', ') || 'none'}`);
            console.log(`  Missed:    ${comparison.missed.join(', ') || 'none'}`);
            console.log(`  Extra:     ${comparison.extra.join(', ') || 'none'}`);
            console.log(`  Precision: ${(comparison.precision * 100).toFixed(1)}%`);
            console.log(`  Recall:    ${(comparison.recall * 100).toFixed(1)}%`);
            console.log(`  F1 Score:  ${(comparison.f1 * 100).toFixed(1)}%`);

            // Key accuracy
            const keyMatch = normalizeChord(result.key) === normalizeChord(song.expectedKey);
            console.log(`  Key match: ${keyMatch ? 'YES' : 'NO'} (detected: ${result.key}, expected: ${song.expectedKey})`);

            // Time signature accuracy
            const timeMatch = result.timeSignature === song.expectedTime;
            console.log(`  Time sig:  ${timeMatch ? 'YES' : 'NO'} (detected: ${result.timeSignature}, expected: ${song.expectedTime})`);

        } catch (e) {
            console.error(`  ERROR: ${e.message}`);
        }

        console.log('');
    }
}

main().catch(console.error);
