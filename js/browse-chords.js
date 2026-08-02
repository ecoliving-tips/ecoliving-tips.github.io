(function () {
    'use strict';

    const container    = document.getElementById('chords-container');
    const recentSec    = document.getElementById('recently-added-section');
    const letterBar    = document.getElementById('az-letter-bar');
    const searchInput  = document.getElementById('ai-search-input');
    const countEl      = document.getElementById('ai-chord-count');
    const noResults    = document.getElementById('browse-no-results');
    const curatedSec   = document.getElementById('curated-section');

    if (!container || !searchInput) return;

    let allEntries   = [];
    let grouped      = {};
    let activeFilter = 'all';
    let activeLetter = null;
    let fetchPromise = null;

    const LETTERS            = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];
    const MAX_SEARCH_RESULTS = 200;

    function getFirstLetter(title) {
        const ch = (title || '').trim().charAt(0).toUpperCase();
        return /[A-Z]/.test(ch) ? ch : '#';
    }

    function makeCard(entry) {
        const card = document.createElement('a');
        card.className = 'chord-browse-card';
        card.href = '/chords/' + entry.s + '/';
        const info = document.createElement('div');
        info.className = 'cb-info';
        const title = document.createElement('div');
        title.className = 'cb-title';
        title.textContent = entry.t;
        info.appendChild(title);
        if (entry.a) {
            const artist = document.createElement('div');
            artist.className = 'cb-artist';
            artist.textContent = entry.a;
            info.appendChild(artist);
        }
        card.appendChild(info);
        if (entry.d) {
            const badge = document.createElement('span');
            badge.className = 'cb-badge difficulty-' + entry.d;
            badge.textContent = entry.d.charAt(0).toUpperCase() + entry.d.slice(1);
            card.appendChild(badge);
        }
        return card;
    }

    function renderLetterBar() {
        letterBar.innerHTML = '';
        LETTERS.forEach(function (letter) {
            const btn = document.createElement('button');
            const has = !!grouped[letter];
            btn.className = 'az-letter-btn' + (has ? '' : ' disabled');
            btn.textContent = letter;
            btn.setAttribute('data-letter', letter);
            if (has) {
                btn.addEventListener('click', function () {
                    document.querySelectorAll('.az-letter-btn').forEach(function (b) { b.classList.remove('active'); });
                    btn.classList.add('active');
                    activeLetter = letter;
                    searchInput.value = '';
                    applyFilters();
                    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
            }
            letterBar.appendChild(btn);
        });
        letterBar.style.display = 'flex';
    }

    function renderSearchResults(entries) {
        container.innerHTML = '';
        if (!entries.length) {
            container.style.display = 'none';
            noResults.style.display = 'block';
            return;
        }
        const capped   = entries.length > MAX_SEARCH_RESULTS;
        const toRender = capped ? entries.slice(0, MAX_SEARCH_RESULTS) : entries;
        const frag     = document.createDocumentFragment();
        if (capped) {
            const note = document.createElement('p');
            note.style.cssText = 'color:var(--text-muted);font-size:0.9rem;margin-bottom:1rem;';
            note.textContent = 'Showing ' + MAX_SEARCH_RESULTS + ' of ' + entries.length + ' results — refine to narrow down.';
            frag.appendChild(note);
        }
        const grid = document.createElement('div');
        grid.className = 'chord-browse-grid';
        toRender.forEach(function (e) { grid.appendChild(makeCard(e)); });
        frag.appendChild(grid);
        container.appendChild(frag);
        container.style.display = 'block';
        noResults.style.display = 'none';
    }

    function renderLetterView(letter) {
        container.innerHTML = '';
        const entries = (grouped[letter] || []).filter(function (e) {
            return activeFilter === 'all' || e.d === activeFilter;
        });
        if (!entries.length) {
            container.style.display = 'none';
            noResults.style.display = 'block';
            return;
        }
        const frag    = document.createDocumentFragment();
        const group   = document.createElement('div');
        group.className = 'letter-group';
        group.id        = 'letter-' + letter;
        const heading   = document.createElement('h3');
        heading.className = 'letter-heading';
        heading.textContent = letter;
        group.appendChild(heading);
        const grid = document.createElement('div');
        grid.className = 'chord-browse-grid';
        entries.forEach(function (e) { grid.appendChild(makeCard(e)); });
        group.appendChild(grid);
        frag.appendChild(group);
        container.appendChild(frag);
        container.style.display = 'block';
        noResults.style.display = 'none';
    }

    function applyFilters() {
        const query = (searchInput.value || '').trim().toLowerCase();
        if (query) {
            activeLetter = null;
            document.querySelectorAll('.az-letter-btn').forEach(function (b) { b.classList.remove('active'); });
            let filtered = allEntries;
            if (activeFilter !== 'all') { filtered = filtered.filter(function (e) { return e.d === activeFilter; }); }
            filtered = filtered.filter(function (e) {
                return e.t.toLowerCase().includes(query) || (e.a && e.a.toLowerCase().includes(query));
            });
            recentSec.style.display = 'none';
            if (curatedSec) { curatedSec.style.display = 'none'; }
            renderSearchResults(filtered);
        } else if (activeLetter) {
            recentSec.style.display = '';
            if (curatedSec) { curatedSec.style.display = ''; }
            renderLetterView(activeLetter);
        } else {
            container.style.display = 'none';
            container.innerHTML = '';
            noResults.style.display = 'none';
            recentSec.style.display = '';
            if (curatedSec) { curatedSec.style.display = ''; }
        }
    }

    function initData(data) {
        allEntries = data;
        grouped    = {};
        data.forEach(function (e) {
            const l = getFirstLetter(e.t);
            if (!grouped[l]) { grouped[l] = []; }
            grouped[l].push(e);
        });
        if (countEl) { countEl.textContent = data.length; }
        renderLetterBar();
        applyFilters();
    }

    function ensureLoaded(then) {
        if (allEntries.length) { if (then) { then(); } return; }
        if (!fetchPromise) {
            container.style.display = 'block';
            container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:2rem 0;">Loading chord library\u2026</p>';
            fetchPromise = fetch('/chords/index.json')
                .then(function (r) { return r.json(); })
                .then(function (data) { initData(data); })
                .catch(function () {
                    container.innerHTML = '<p style="color:var(--text-muted);text-align:center;">Unable to load chord library.</p>';
                });
        }
        if (then) { fetchPromise.then(then); }
    }

    searchInput.addEventListener('focus', function () { ensureLoaded(); }, { once: true });

    var debounceTimer;
    searchInput.addEventListener('input', function () {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () { ensureLoaded(applyFilters); }, 300);
    });

    document.querySelectorAll('.difficulty-chip').forEach(function (chip) {
        chip.addEventListener('click', function () {
            document.querySelectorAll('.difficulty-chip').forEach(function (c) { c.classList.remove('active'); });
            chip.classList.add('active');
            activeFilter = chip.dataset.difficulty;
            ensureLoaded(applyFilters);
        });
    });

    // Lazy-load when AI library section scrolls near viewport
    var aiSection = document.getElementById('ai-library-section');
    if (aiSection && 'IntersectionObserver' in window) {
        var obs = new IntersectionObserver(function (entries) {
            if (entries[0].isIntersecting) { obs.disconnect(); ensureLoaded(); }
        }, { rootMargin: '300px' });
        obs.observe(aiSection);
    }
})();
