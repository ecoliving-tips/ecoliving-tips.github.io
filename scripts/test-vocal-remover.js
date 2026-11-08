const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js', 'vocal-remover.js'), 'utf8');
function createPlayer() {
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, {
            value: '1', checked: false, hidden: true,
            classList: { add() {}, remove() {} }, setAttribute() {},
            clientWidth: 0,
        });
        return elements.get(id);
    };
    const context = vm.createContext({
        window: { addEventListener() {} },
        document: { addEventListener() {}, getElementById: element },
        console, Blob, URL, FormData, AbortController, DOMException,
        setTimeout, clearTimeout, setInterval, clearInterval,
        requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    });
    vm.runInContext(source, context);
    return { context, element, run: code => vm.runInContext(code, context) };
}
function audioBuffer(channels, sampleRate = 8) {
    return {
        numberOfChannels: channels.length,
        sampleRate,
        length: channels[0].length,
        duration: channels[0].length / sampleRate,
        getChannelData: index => Float32Array.from(channels[index]),
    };
}

test('upload limits and supported media are enforced', () => {
    const { context } = createPlayer();
    const valid = { name: 'song.MP3', type: 'audio/mpeg', size: 1024 };
    assert.doesNotThrow(() => context.validateUpload(valid));
    for (const file of [
        { ...valid, size: 1023 },
        { ...valid, size: 30 * 1024 * 1024 + 1 },
        { ...valid, name: 'song.exe' },
        { ...valid, type: 'video/mp4' },
    ]) assert.throws(() => context.validateUpload(file));
});

test('trim rejects reversed, out-of-bounds, empty and too-short selections', () => {
    const { context, element, run } = createPlayer();
    for (const [start, end] of [[2, 1], [-1, 1], [0, 11], [1, 1.05], [NaN, 2]]) {
        assert.throws(() => context.getTrimRange(start, end, 10));
    }
    assert.equal(context.getTrimRange(1.25, 8.5, 10).end, 8.5);
    run('buffers = {}; duration = 10;');
    element('trim-start').value = '';
    element('trim-end').value = '2';
    assert.equal(context.applyTrim(), false);
    assert.match(element('trim-error').textContent, /Enter both/);
});

test('trimmed export is stereo 24-bit PCM WAV with exact frame count', async () => {
    const { context } = createPlayer();
    const buffer = audioBuffer([
        [0, 0, 1, -1, 0.5, -0.5, 0, 0],
        [0, 0, -1, 1, -0.5, 0.5, 0, 0],
    ]);
    const wav = context.encodeTrimmedWav(buffer, 0.25, 0.75);
    assert.equal(wav.type, 'audio/wav');
    const bytes = await wav.arrayBuffer();
    const view = new DataView(bytes);
    assert.equal(Buffer.from(bytes).subarray(0, 4).toString(), 'RIFF');
    assert.equal(view.getUint16(22, true), 2);
    assert.equal(view.getUint16(34, true), 24);
    assert.equal(view.getUint32(24, true), 8);
    assert.equal(view.getUint32(40, true), 4 * 2 * 3);
    assert.equal(bytes.byteLength, 44 + 4 * 2 * 3);
    assert.equal(Buffer.from(bytes).readIntLE(44, 3), 0x7FFFFF);
    assert.equal(Buffer.from(bytes).readIntLE(47, 3), -0x800000);
});

test('odd-byte mono PCM exports include RIFF padding, not extra samples', async () => {
    const { context } = createPlayer();
    const wav = context.encodeTrimmedWav(audioBuffer([[0, 0.25, 0.5]], 3), 0, 1);
    const bytes = await wav.arrayBuffer();
    assert.equal(new DataView(bytes).getUint32(40, true), 9);
    assert.equal(bytes.byteLength, 54);
    assert.equal(new DataView(bytes).getUint32(4, true), 46);
});

test('comparison uses one clock, independent mute and safe combined gain', async () => {
    const { context, element, run } = createPlayer();
    const starts = [];
    const levels = [];
    context.testContext = {
        currentTime: 5,
        resume: async () => {},
        destination: {},
        createBufferSource: () => ({
            connect() {}, stop() {}, start: (...args) => starts.push(args),
        }),
        createGain: () => ({
            connect() {}, disconnect() {},
            gain: { setTargetAtTime: value => levels.push(value) },
        }),
    };
    element('mute-original').checked = true;
    run('audioContext = testContext; buffers = { original: {}, instrumental: {} }; duration = trimEnd = 10;');
    await context.startPlayback();
    assert.deepEqual(starts, [[5.03, 0, 10], [5.03, 0, 10]]);
    assert.deepEqual(levels, [0, 1]);
    element('mute-original').checked = false;
    context.updateMix();
    assert.deepEqual(levels.slice(-2), [0.5, 0.5]);
    element('mute-instrumental').checked = true;
    context.updateMix();
    assert.deepEqual(levels.slice(-2), [1, 0]);
    context.pausePlayback();
    assert.equal(run('playing'), false);
});

test('server errors and malformed outputs never become fallback success', async () => {
    const { context } = createPlayer();
    const file = new Blob(['audio'], { type: 'audio/wav' });
    const controller = new AbortController();
    for (const [status, detail, expected] of [
        [503, 'karaoke_busy', /60 seconds/],
        [503, 'karaoke_timeout', /time limit/],
        [429, 'rate_limited', /busy/],
        [500, 'karaoke_failed', /HTTP 500/],
        [400, 'invalid_audio_file', /invalid_audio_file/],
    ]) {
        context.fetch = async () => ({
            ok: false, status, headers: new Headers({
                'Content-Type': 'application/json', 'Retry-After': '60',
            }), json: async () => ({ detail }),
        });
        await assert.rejects(context.requestKaraoke(file, controller.signal), expected);
    }
    context.fetch = async () => ({
        ok: true, headers: new Headers({ 'Content-Type': 'application/json' }),
    });
    await assert.rejects(context.requestKaraoke(file, controller.signal), /unexpected output/);
    context.fetch = async () => ({
        ok: true, headers: new Headers({ 'Content-Type': 'audio/wav' }),
        arrayBuffer: async () => new ArrayBuffer(0),
    });
    await assert.rejects(context.requestKaraoke(file, controller.signal), /empty/);
});

test('karaoke SEO schema matches the visible FAQ and canonical URL', () => {
    const html = fs.readFileSync(path.join(root, 'vocal-remover.html'), 'utf8');
    const schemas = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
        .map(match => JSON.parse(match[1]));
    const faq = schemas.find(schema => schema['@type'] === 'FAQPage');
    const visible = [...html.matchAll(/<details class="faq-item"><summary><h3>(.*?)<\/h3><\/summary><p>(.*?)<\/p><\/details>/g)];
    assert.equal(faq.mainEntity.length, visible.length);
    faq.mainEntity.forEach((question, index) => {
        assert.equal(question.name, visible[index][1]);
        assert.equal(question.acceptedAnswer.text, visible[index][2]);
    });
    const app = schemas.find(schema => schema['@type'] === 'WebApplication');
    assert.equal(app.url, 'https://ecoliving-tips.github.io/vocal-remover.html');
    assert.ok(html.includes(`<link rel="canonical" href="${app.url}">`));
    const sitemap = fs.readFileSync(path.join(root, 'sitemap-pages.xml'), 'utf8');
    assert.ok(sitemap.includes(`<loc>${app.url}</loc>`));
    const build = fs.readFileSync(path.join(root, 'build.js'), 'utf8');
    assert.ok(build.includes("{ loc: '/vocal-remover.html', file: 'vocal-remover.html' }"));
    assert.equal([...html.matchAll(/<h1>/g)].length, 1);
    assert.ok(html.includes('Free Vocal Remover Online &amp; Karaoke Maker'));
    assert.ok(!html.includes('id="audio-vocals"'));
    assert.ok(!html.includes('id="audio-drums"'));
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length);
});
