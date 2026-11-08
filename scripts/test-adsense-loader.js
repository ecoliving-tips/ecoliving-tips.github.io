const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js', 'adsense-loader.js'), 'utf8');
const cacheKey = 'swaram-ads-country-v2';
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness(options = {}) {
    function element() {
        return {
            dataset: {}, style: {}, children: [], listeners: {}, removed: false,
            classes: new Set(),
            classList: { add(name) { this.owner.classes.add(name); } },
            appendChild(child) { this.children.push(child); },
            querySelector(selector) { return this.children.find(child => !child.removed && selector === '.adsbygoogle' && child.className === 'adsbygoogle') || null; },
            remove() { this.removed = true; },
            addEventListener(name, callback) { this.listeners[name] = callback; },
        };
    }
    function slot(top, width = 300, format = 'fluid') {
        const el = element();
        el.classList.owner = el;
        el.dataset = { swaramAdSlot: String(slots.length + 1), swaramAdFormat: format };
        el.top = top;
        el.width = width;
        el.visible = true;
        el.getBoundingClientRect = () => ({
            top: el.top, bottom: el.top + 290, left: 0, right: el.width, width: el.visible ? el.width : 0,
        });
        slots.push(el);
        return el;
    }
    const slots = [];
    const head = element();
    const listeners = {};
    const documentListeners = {};
    const intersectionObservers = [];
    const mutationObservers = [];
    const requests = [];
    const errors = [];
    const warnings = [];
    const storage = new Map();
    if (options.cache) storage.set(cacheKey, JSON.stringify(options.cache));
    class MutationObserver {
        constructor(callback) { this.callback = callback; mutationObservers.push(this); }
        observe(target) { this.target = target; }
        disconnect() { this.disconnected = true; }
    }
    class IntersectionObserver {
        constructor(callback, config) { this.callback = callback; this.config = config; this.targets = new Set(); intersectionObservers.push(this); }
        observe(target) { this.targets.add(target); }
        unobserve(target) { this.targets.delete(target); }
    }
    const document = {
        visibilityState: options.visibility || 'visible',
        head, documentElement: element(),
        createElement: element,
        querySelectorAll(selector) {
            if (selector === '[data-swaram-ad-slot]') return slots.filter(el => !el.removed);
            return [...head.children, ...slots.flatMap(el => el.children)].filter(el => !el.removed);
        },
        getElementById(id) { return head.children.find(el => !el.removed && el.id === id); },
        addEventListener(name, callback) { documentListeners[name] = callback; },
        removeEventListener(name) { delete documentListeners[name]; },
    };
    const window = {
        innerWidth: 390, innerHeight: 844, MutationObserver,
        IntersectionObserver: options.noIntersectionObserver ? undefined : IntersectionObserver,
        addEventListener(name, callback) { listeners[name] = callback; },
        removeEventListener(name) { delete listeners[name]; },
        requestAnimationFrame(callback) { queueMicrotask(callback); },
        getComputedStyle(el) { return { display: el.visible ? 'block' : 'none', visibility: 'visible' }; },
    };
    const context = {
        window, document, MutationObserver, IntersectionObserver,
        navigator: { userAgent: 'Mozilla/5.0', webdriver: !!options.automation },
        localStorage: {
            getItem: key => storage.get(key) || null,
            setItem: (key, value) => storage.set(key, value),
        },
        AbortController, setTimeout, clearTimeout,
        fetch(url, config) {
            requests.push({ url, config });
            return options.fetch ? options.fetch(url, config, requests.length) : Promise.resolve({ ok: true, json: async () => ({ country: 'IN' }) });
        },
        console: { error: message => errors.push(message), warn: message => warnings.push(message) },
    };
    return {
        slot, slots, head, window, document, listeners, documentListeners, intersectionObservers, mutationObservers, requests, errors, warnings, storage,
        start() { vm.runInNewContext(source, context); },
        async interact() { listeners.pointerdown?.(); await flush(); },
        async intersect(el) {
            intersectionObservers[0].callback([{ target: el, isIntersecting: true }]);
            await flush();
        },
    };
}

const cached = countries => ({ timestamp: Date.now(), countries });

test('no ads or geo lookups before interaction; automation remains blocked', async () => {
    const h = harness();
    h.slot(100);
    h.start();
    assert.equal(h.requests.length, 0);
    assert.equal(h.head.children.length, 0);
    const bot = harness({ automation: true });
    bot.start();
    await bot.interact();
    assert.equal(bot.requests.length, 0);
    assert.equal(bot.head.children.length, 0);
});

test('cached allowed visitor requests only nearby slots, once, and preserves ad attributes', async () => {
    const h = harness({ cache: cached(['IN']) });
    const near = h.slot(100);
    near.dataset.swaramAdLayout = 'in-article';
    near.dataset.swaramAdFullWidthResponsive = 'true';
    const far = h.slot(3000);
    h.start();
    await h.interact();
    assert.equal(h.requests.length, 0);
    assert.equal(h.window.adsbygoogle.length, 1);
    assert.equal(far.children.length, 0);
    assert.equal(near.children[0].dataset.adLayout, 'in-article');
    assert.equal(near.children[0].dataset.fullWidthResponsive, 'true');
    assert.equal(h.intersectionObservers[0].config.rootMargin, '200px');
    await h.intersect(far);
    await h.intersect(far);
    assert.equal(h.window.adsbygoogle.length, 2);
    assert.equal(far.children.length, 1);
    assert.equal(h.head.children.length, 1);
});

test('hidden and undersized slots wait for visibility or resize', async () => {
    const h = harness({ cache: cached(['IN']) });
    const hidden = h.slot(100, 300, 'auto');
    hidden.visible = false;
    const narrow = h.slot(100, 210);
    h.start();
    await h.interact();
    assert.equal(h.window.adsbygoogle.length, 0);
    hidden.visible = true;
    h.listeners['swaram:ads-visibility-changed']();
    await flush();
    assert.equal(hidden.children.length, 1);
    assert.equal(narrow.children.length, 0);
    narrow.width = 280;
    h.listeners.resize();
    await flush();
    assert.equal(narrow.children.length, 1);
});

test('viewport fallback handles scroll without IntersectionObserver', async () => {
    const h = harness({ cache: cached(['IN']), noIntersectionObserver: true });
    const far = h.slot(3000);
    h.start();
    await h.interact();
    assert.equal(far.children.length, 0);
    far.top = 500;
    h.listeners.scroll();
    await flush();
    assert.equal(far.children.length, 1);
    h.listeners.scroll();
    await flush();
    assert.equal(far.children.length, 1);
});

test('cached Singapore blocks all slots and scripts', async () => {
    const h = harness({ cache: cached(['SG']) });
    const near = h.slot(100);
    h.start();
    await h.interact();
    assert.equal(near.removed, true);
    assert.equal(h.head.children.length, 0);
    assert.equal(h.requests.length, 0);
    assert.equal(h.window.__swaramAdsReady, false);
});

test('a late Singapore response overrides an early allowed response and cancels pending providers', async () => {
    let respondSingapore;
    const h = harness({
        fetch(url, config, index) {
            if (index === 1) return Promise.resolve({ ok: true, json: async () => ({ country_code: 'IN' }) });
            if (index === 2) return new Promise(resolve => { respondSingapore = () => resolve({ ok: true, json: async () => ({ cc: 'SG' }) }); });
            return new Promise((resolve, reject) => {
                config.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
            });
        },
    });
    h.slot(100);
    h.start();
    await h.interact();
    assert.equal(h.requests.length, 6);
    assert.equal(h.head.children.length, 0);
    respondSingapore();
    await flush();
    assert.equal(h.slots[0].removed, true);
    assert.equal(h.head.children.length, 0);
    assert.ok(h.requests.every(request => request.config.signal.aborted));
    assert.ok(JSON.parse(h.storage.get(cacheKey)).countries.includes('SG'));
});

test('allowed visitors still wait for all country results', async () => {
    let respondLast;
    const h = harness({
        fetch(url, config, index) {
            if (index === 6) return new Promise(resolve => { respondLast = () => resolve({ ok: true, json: async () => ({ country_code: 'IN' }) }); });
            return Promise.resolve({ ok: true, json: async () => ({ country_code: 'IN', cc: 'IN', country: 'IN', countryCode: 'IN' }) });
        },
    });
    h.slot(100);
    h.start();
    await h.interact();
    assert.equal(h.head.children.length, 0);
    respondLast();
    await flush();
    assert.equal(h.head.children.length, 1);
});

test('total geo failure retains stale country protection and reports fallback', async () => {
    for (const countries of [['SG'], ['IN'], null]) {
        const h = harness({
            cache: countries ? { timestamp: Date.now() - 2 * 86400000, countries } : undefined,
            fetch: async () => ({ ok: false }),
        });
        h.slot(100);
        h.start();
        await h.interact();
        assert.equal(h.warnings.length, 1);
        assert.equal(h.head.children.length, countries?.includes('SG') ? 0 : 1);
    }
});

test('background tabs wait for visibility; unfilled slots collapse and failures are logged', async () => {
    const h = harness({ cache: cached(['IN']), visibility: 'hidden' });
    const near = h.slot(100);
    h.start();
    await h.interact();
    assert.equal(h.head.children.length, 0);
    h.document.visibilityState = 'visible';
    h.documentListeners.visibilitychange();
    assert.equal(h.head.children.length, 1);
    const observer = h.mutationObservers.find(item => item.target === near.children[0]);
    near.children[0].dataset.adStatus = 'unfilled';
    observer.callback();
    assert.ok(near.classes.has('ad-slot-unfilled'));
    assert.ok(observer.disconnected);
    h.head.children[0].listeners.error();
    assert.equal(h.errors.length, 1);
});

test('source markup and build output agree; progress uses the central loader', () => {
    const homepage = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const build = fs.readFileSync(path.join(root, 'build.js'), 'utf8');
    const slot = homepage.match(/<div class="recently-added-card"[^>]*data-swaram-ad-slot="6173198662"[^>]*><\/div>/)[0];
    assert.ok(!slot.includes('overflow:hidden'));
    assert.ok(build.includes(slot));
    const finder = fs.readFileSync(path.join(root, 'chord-finder.html'), 'utf8');
    assert.ok(finder.includes('data-swaram-ad-slot="7291819152"'));
    const js = fs.readFileSync(path.join(root, 'js', 'chord-finder.js'), 'utf8');
    const progress = js.slice(js.indexOf('function showProgress()'), js.indexOf('function hideProgress()'));
    assert.ok(progress.includes("new Event('swaram:ads-visibility-changed')"));
    assert.ok(!progress.includes('adsbygoogle'));
    const { minifyCSS } = require('../build');
    assert.equal(fs.readFileSync(path.join(root, 'css', 'styles.min.css'), 'utf8'),
        minifyCSS(fs.readFileSync(path.join(root, 'css', 'styles.css'), 'utf8')));
});
