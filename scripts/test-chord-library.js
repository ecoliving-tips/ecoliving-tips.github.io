const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { generateChordLibrary, generateSongsPage, loadTemplates } = require('../build');

const root = path.join(__dirname, '..');
const templates = loadTemplates();

function withOutput(run) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'swaram-library-test-'));
    try {
        run(directory);
    } finally {
        fs.rmSync(directory, { recursive: true });
    }
}

function readPage(directory, url) {
    return fs.readFileSync(path.join(directory, ...new URL(url).pathname.split('/').filter(Boolean), 'index.html'), 'utf8');
}

test('directory covers the real catalog with bounded pages and crawlable pagination', () => {
    withOutput(directory => {
        const catalog = JSON.parse(fs.readFileSync(path.join(root, 'chords', 'index.json'), 'utf8'));
        const pages = generateChordLibrary(catalog, templates, directory);
        const hub = readPage(directory, 'https://ecoliving-tips.github.io/library/');
        const linkedSlugs = new Set();
        let maxBytes = 0;
        for (const page of pages) {
            const html = readPage(directory, page.loc);
            maxBytes = Math.max(maxBytes, Buffer.byteLength(html));
            assert.ok(!/\{\{[A-Z_]+\}\}/.test(html), 'No unresolved template tokens');
            assert.ok(html.includes(`href="${page.loc}"`), 'Self canonical');
            const json = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
            assert.equal(json.url, page.loc);
            const links = [...html.matchAll(/class="chord-browse-card" href="\/chords\/([^/]+)\//g)];
            assert.ok(links.length <= 200);
            if (links.length) {
                assert.equal(json.mainEntity.numberOfItems, links.length);
                assert.ok(hub.includes(`href="${new URL(page.loc).pathname}"`), 'Hub links directly to every listing page');
            }
            for (const link of links) {
                assert.ok(!linkedSlugs.has(link[1]), 'Song listed once');
                linkedSlugs.add(link[1]);
            }
            for (const link of html.matchAll(/href="(\/library\/[^"]*)"/g)) {
                assert.ok(fs.existsSync(path.join(directory, ...link[1].split('/').filter(Boolean), 'index.html')), 'Directory links resolve');
            }
        }
        assert.deepEqual(linkedSlugs, new Set(catalog.map(entry => entry.s)));
        assert.ok(maxBytes < 200 * 1024, `Largest HTML page is ${maxBytes} bytes`);
        console.log(`Verified ${linkedSlugs.size} songs across ${pages.length} pages; largest page ${maxBytes} bytes.`);
    });
});

test('generation is deterministic, escapes metadata, handles duplicates and empty catalogs', () => {
    withOutput(directory => {
        const entries = [
            { slug: 'alpha', title: 'Alpha $& <song>', artist: '</script> & Artist' },
            { slug: 'other', title: '\u0d05\u0d28\u0d4d\u0d28', artist: 'Artist' },
            { slug: 'alpha', title: 'Duplicate' },
        ];
        const first = generateChordLibrary(entries, templates, directory);
        const html = readPage(directory, 'https://ecoliving-tips.github.io/library/a/');
        assert.ok(html.includes('Alpha $&amp; &lt;song&gt;'));
        assert.ok(html.includes('&lt;/script&gt; &amp; Artist'));
        assert.ok(!html.includes('Duplicate'));
        assert.deepEqual(generateChordLibrary(entries, templates, directory), first);
        assert.throws(() => generateChordLibrary([{ slug: '../escape' }], templates, directory), /invalid slug/);
    });
    withOutput(directory => {
        assert.equal(generateChordLibrary([], templates, directory).length, 1);
        assert.ok(readPage(directory, 'https://ecoliving-tips.github.io/library/').includes('No chord charts'));
    });
});

test('song browse prerendering retains recent charts and only links available letters', () => {
    withOutput(directory => {
        fs.copyFileSync(path.join(root, 'songs.html'), path.join(directory, 'songs.html'));
        const entries = [{ slug: 'alpha', title: 'Alpha', artist: 'Artist', created_at: '2026-11-08' }];
        const pages = generateChordLibrary(entries, templates, directory);
        generateSongsPage([], [], [], entries, pages, directory);
        const first = fs.readFileSync(path.join(directory, 'songs.html'), 'utf8');
        assert.ok(first.includes('href="/chords/alpha/"'));
        assert.ok(first.includes('href="/library/a/"'));
        assert.ok(!first.includes('href="/library/b/"'));
        generateSongsPage([], [], [], entries, pages, directory);
        assert.equal(fs.readFileSync(path.join(directory, 'songs.html'), 'utf8'), first);
    });
});

function searchHarness(fetchImpl) {
    function element() {
        return {
            style: {}, listeners: {}, children: [], value: '', dataset: {},
            classList: { add() {}, remove() {} },
            setAttribute() {},
            addEventListener(name, callback) { this.listeners[name] = callback; },
            appendChild(child) { this.children.push(child); },
            set innerHTML(value) { this.html = value; this.children = []; },
            get innerHTML() { return this.html || ''; },
        };
    }
    const ids = Object.fromEntries([
        'chords-container', 'recently-added-section', 'ai-search-input', 'ai-chord-count',
        'browse-no-results', 'curated-section', 'catalog-load-note',
    ].map(id => [id, element()]));
    const chips = ['all', 'easy'].map(difficulty => {
        const chip = element();
        chip.dataset.difficulty = difficulty;
        return chip;
    });
    let calls = 0;
    let errors = 0;
    let timer;
    vm.runInNewContext(fs.readFileSync(path.join(root, 'js', 'browse-chords.js'), 'utf8'), {
        document: {
            getElementById: id => ids[id],
            querySelectorAll: () => chips,
            createElement: element,
            createDocumentFragment: element,
        },
        fetch: async () => { calls++; return fetchImpl(calls); },
        console: { error() { errors++; } },
        setTimeout(callback) { timer = callback; return 1; },
        clearTimeout() { timer = null; },
    });
    return {
        ids, chips,
        get calls() { return calls; },
        get errors() { return errors; },
        async search(query) {
            ids['ai-search-input'].value = query;
            ids['ai-search-input'].listeners.input();
            timer();
            await new Promise(resolve => setImmediate(resolve));
        },
    };
}

test('search downloads nothing on initialization or empty input; title, artist and difficulty still work', async () => {
    const harness = searchHarness(() => ({
        ok: true,
        json: async () => [
            { t: 'Alpha', a: 'Artist One', s: 'alpha', d: 'easy' },
            { t: 'Beta', a: 'Artist Two', s: 'beta', d: 'advanced' },
        ],
    }));
    assert.equal(harness.calls, 0);
    assert.equal(harness.ids['ai-search-input'].listeners.focus, undefined);
    await harness.search('');
    assert.equal(harness.calls, 0);
    await harness.search('artist two');
    assert.equal(harness.calls, 1);
    const grid = () => harness.ids['chords-container'].children[0].children[0];
    assert.equal(grid().children[0].href, '/chords/beta/');
    await harness.search('alpha');
    assert.equal(grid().children[0].href, '/chords/alpha/');
    await harness.search('');
    harness.chips[1].listeners.click();
    assert.equal(grid().children.length, 1);
    assert.equal(grid().children[0].href, '/chords/alpha/');
    assert.equal(harness.calls, 1);
});

test('search reports HTTP and malformed catalog errors and supports retry', async () => {
    for (const response of [
        { ok: false, status: 503 },
        { ok: true, json: async () => ({ invalid: true }) },
    ]) {
        const harness = searchHarness(call => call === 1 ? response : { ok: true, json: async () => [] });
        await harness.search('alpha');
        assert.equal(harness.errors, 1);
        assert.ok(harness.ids['chords-container'].innerHTML.includes('/library/'));
        harness.ids['chords-container'].children[0].listeners.click();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(harness.calls, 2);
        assert.equal(harness.ids['browse-no-results'].style.display, 'block');
    }
});

test('entry points and service worker do not require an automatic full catalog download', () => {
    const songs = fs.readFileSync(path.join(root, 'songs.html'), 'utf8');
    assert.equal([...songs.matchAll(/class="az-letter-btn" href="\/library\//g)].length, 27);
    assert.ok(fs.readFileSync(path.join(root, 'index.html'), 'utf8').includes('href="/library/"'));
    assert.ok(fs.readFileSync(path.join(root, 'templates', 'chords-page.html'), 'utf8').includes('href="/library/"'));
    const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
    assert.ok(!sw.match(/const STATIC_ASSETS = \[([\s\S]*?)\];/)[1].includes("'/chords/index.json'"));
});
