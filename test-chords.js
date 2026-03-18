var document = { addEventListener: function(){} };
eval(require('fs').readFileSync('js/chord-diagrams.js', 'utf-8').replace(/^const /gm, 'var '));

var OPEN_TUNING = [40, 45, 50, 55, 59, 64];
var NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

function fretToNote(string, fret) {
  return NOTE_NAMES[(OPEN_TUNING[string] + fret) % 12];
}

function verifyChord(name, expectedNotes) {
  var d = CHORD_DIAGRAMS[name];
  if (!d || !d.guitar) { console.log(name + ': NO GUITAR DATA'); return; }
  var actual = [];
  d.guitar.frets.forEach(function(f,i) {
    if (f >= 0) actual.push(fretToNote(i, f));
  });
  var unique = [...new Set(actual)].sort();
  var expected = expectedNotes.sort();
  var ok = expected.every(function(n){ return unique.includes(n); }) ? 'PASS' : 'FAIL';
  console.log(name + ': ' + ok + ' notes=' + unique.join(',') + (ok === 'FAIL' ? ' expected=' + expected.join(',') : ''));
}

verifyChord('C', ['C','E','G']);
verifyChord('D', ['D','F#','A']);
verifyChord('E', ['E','G#','B']);
verifyChord('F', ['F','A','C']);
verifyChord('G', ['G','B','D']);
verifyChord('A', ['A','C#','E']);
verifyChord('Bb', ['A#','D','F']);
verifyChord('Ab', ['G#','C','D#']);
verifyChord('Am', ['A','C','E']);
verifyChord('Em', ['E','G','B']);
verifyChord('Fm', ['F','G#','C']);
verifyChord('Cm', ['C','D#','G']);
verifyChord('Gm', ['G','A#','D']);
verifyChord('G7', ['G','B','D','F']);
verifyChord('C7', ['C','E','G','A#']);
verifyChord('A7', ['A','C#','E','G']);
verifyChord('Am7', ['A','C','E','G']);
verifyChord('Cm7', ['C','D#','G','A#']);
verifyChord('Fm7', ['F','G#','C','D#']);
verifyChord('Gm7', ['G','A#','D','F']);
verifyChord('CM7', ['C','E','G','B']);
verifyChord('AbM7', ['G#','C','D#','G']);
verifyChord('Gsus4', ['G','C','D']);
verifyChord('Dsus4', ['D','G','A']);
verifyChord('Asus2', ['A','B','E']);
verifyChord('Cdim', ['C','D#','F#']);
verifyChord('Bdim', ['B','D','F']);
verifyChord('Caug', ['C','E','G#']);
verifyChord('Aaug', ['A','C#','F']);
