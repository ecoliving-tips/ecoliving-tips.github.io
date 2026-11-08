(function () {
    'use strict';

    const container    = document.getElementById('chords-container');
    const recentSec    = document.getElementById('recently-added-section');
    const searchInput  = document.getElementById('ai-search-input');
    const countEl      = document.getElementById('ai-chord-count');
    const noResults    = document.getElementById('browse-no-results');
    const curatedSec   = document.getElementById('curated-section');

    if (!container || !searchInput) return;

    let allEntries   = [];
    let activeFilter = 'all';
    let fetchPromise = null;
    let loaded       = false;

    const MAX_SEARCH_RESULTS = 200;

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

    function applyFilters() {
        const query = (searchInput.value || '').trim().toLowerCase();
        if (query || activeFilter !== 'all') {
            let filtered = allEntries;
            if (activeFilter !== 'all') { filtered = filtered.filter(function (e) { return e.d === activeFilter; }); }
            filtered = filtered.filter(function (e) {
                return e.t.toLowerCase().includes(query) || (e.a && e.a.toLowerCase().includes(query));
            });
            recentSec.style.display = 'none';
            if (curatedSec) { curatedSec.style.display = 'none'; }
            renderSearchResults(filtered);
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
        loaded = true;
        if (countEl) { countEl.textContent = data.length; }
        const note = document.getElementById('catalog-load-note');
        if (note) note.hidden = true;
        applyFilters();
    }

    function ensureLoaded() {
        if (loaded) { applyFilters(); return; }
        if (!fetchPromise) {
            container.style.display = 'block';
            container.setAttribute('role', 'status');
            noResults.style.display = 'none';
            container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:2rem 0;">Loading chord library\u2026</p>';
            fetchPromise = fetch('/chords/index.json')
                .then(function (r) {
                    if (!r.ok) throw new Error('Chord catalog returned HTTP ' + r.status);
                    return r.json();
                })
                .then(function (data) {
                    if (!Array.isArray(data) || !data.every(function (entry) {
                        return entry && typeof entry.t === 'string'
                            && typeof entry.s === 'string' && /^[a-zA-Z0-9_-]+$/.test(entry.s)
                            && (entry.a == null || typeof entry.a === 'string');
                    })) throw new Error('Chord catalog has an invalid format');
                    return data;
                })
                .then(function (data) { initData(data); })
                .catch(function (error) {
                    console.error('[Chord library]', error);
                    fetchPromise = null;
                    container.style.display = 'block';
                    container.innerHTML = '<p>Unable to load song search. <a href="/library/">Browse the song directory instead</a>.</p>';
                    const retry = document.createElement('button');
                    retry.type = 'button';
                    retry.className = 'btn btn-secondary';
                    retry.textContent = 'Retry search';
                    retry.addEventListener('click', ensureLoaded);
                    container.appendChild(retry);
                });
        }
    }

    var debounceTimer;
    searchInput.addEventListener('input', function () {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () {
            if (!searchInput.value.trim() && activeFilter === 'all') applyFilters();
            else ensureLoaded();
        }, 300);
    });

    document.querySelectorAll('.difficulty-chip').forEach(function (chip) {
        chip.addEventListener('click', function () {
            document.querySelectorAll('.difficulty-chip').forEach(function (c) { c.classList.remove('active'); });
            chip.classList.add('active');
            activeFilter = chip.dataset.difficulty;
            if (activeFilter === 'all' && !searchInput.value.trim()) applyFilters();
            else ensureLoaded();
        });
    });
})();
