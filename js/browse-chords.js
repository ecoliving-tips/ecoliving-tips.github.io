(function () {
    'use strict';

    const container = document.getElementById('chords-container');
    const recentSection = document.getElementById('recently-added-section');
    const recentRow = document.getElementById('recently-added-row');
    const letterBar = document.getElementById('az-letter-bar');
    const searchInput = document.getElementById('ai-search-input');
    const countEl = document.getElementById('ai-chord-count');
    const noResults = document.getElementById('browse-no-results');
    const curatedSection = document.getElementById('curated-section');

    let allEntries = [];
    let activeFilter = 'all';

    const LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];

    function getFirstLetter(title) {
        const ch = (title || '').trim().charAt(0).toUpperCase();
        return /[A-Z]/.test(ch) ? ch : '#';
    }

    function renderLetterBar(availableLetters) {
        letterBar.innerHTML = '';
        LETTERS.forEach(letter => {
            const btn = document.createElement('button');
            btn.className = 'az-letter-btn' + (availableLetters.has(letter) ? '' : ' disabled');
            btn.textContent = letter;
            btn.setAttribute('data-letter', letter);
            if (availableLetters.has(letter)) {
                btn.addEventListener('click', () => {
                    const target = document.getElementById('letter-' + letter);
                    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
            }
            letterBar.appendChild(btn);
        });
    }

    function renderCards(entries) {
        container.innerHTML = '';
        if (!entries.length) {
            container.style.display = 'none';
            letterBar.style.display = 'none';
            noResults.style.display = 'block';
            countEl.textContent = '0';
            return;
        }

        container.style.display = 'block';
        letterBar.style.display = 'flex';
        noResults.style.display = 'none';
        countEl.textContent = entries.length;

        const grouped = {};
        entries.forEach(e => {
            const letter = getFirstLetter(e.t);
            if (!grouped[letter]) grouped[letter] = [];
            grouped[letter].push(e);
        });

        const availableLetters = new Set(Object.keys(grouped));
        renderLetterBar(availableLetters);

        const frag = document.createDocumentFragment();
        LETTERS.forEach(letter => {
            if (!grouped[letter]) return;
            const group = document.createElement('div');
            group.className = 'letter-group';
            group.id = 'letter-' + letter;

            const heading = document.createElement('h3');
            heading.className = 'letter-heading';
            heading.textContent = letter;
            group.appendChild(heading);

            const grid = document.createElement('div');
            grid.className = 'chord-browse-grid';

            grouped[letter].forEach(entry => {
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

                const badge = document.createElement('span');
                badge.className = 'cb-badge difficulty-' + entry.d;
                badge.textContent = entry.d.charAt(0).toUpperCase() + entry.d.slice(1);
                card.appendChild(badge);

                grid.appendChild(card);
            });

            group.appendChild(grid);
            frag.appendChild(group);
        });

        container.appendChild(frag);
    }

    function renderRecentlyAdded(entries) {
        const sorted = [...entries].sort((a, b) => (b.dt || '').localeCompare(a.dt || ''));
        const recent = sorted.slice(0, 10);
        recentRow.innerHTML = '';

        recent.forEach(entry => {
            const card = document.createElement('a');
            card.className = 'recently-added-card';
            card.href = '/chords/' + entry.s + '/';

            const title = document.createElement('div');
            title.className = 'ra-title';
            title.textContent = entry.t;
            card.appendChild(title);

            if (entry.a) {
                const artist = document.createElement('div');
                artist.className = 'ra-artist';
                artist.textContent = entry.a;
                card.appendChild(artist);
            }

            const meta = document.createElement('div');
            meta.className = 'ra-meta';
            const badge = document.createElement('span');
            badge.className = 'cb-badge difficulty-' + entry.d;
            badge.textContent = entry.d.charAt(0).toUpperCase() + entry.d.slice(1);
            meta.appendChild(badge);
            card.appendChild(meta);

            recentRow.appendChild(card);
        });
    }

    function applyFilters() {
        const query = (searchInput.value || '').trim().toLowerCase();
        let filtered = allEntries;

        if (activeFilter !== 'all') {
            filtered = filtered.filter(e => e.d === activeFilter);
        }

        if (query) {
            filtered = filtered.filter(e =>
                e.t.toLowerCase().includes(query) ||
                (e.a && e.a.toLowerCase().includes(query))
            );
            recentSection.style.display = 'none';
            if (curatedSection) curatedSection.style.display = 'none';
        } else {
            recentSection.style.display = '';
            if (curatedSection) curatedSection.style.display = '';
        }

        renderCards(filtered);
    }

    // Search debounce
    let debounceTimer;
    searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(applyFilters, 300);
    });

    // Difficulty filter chips
    document.querySelectorAll('.difficulty-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.difficulty-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            activeFilter = chip.dataset.difficulty;
            applyFilters();
        });
    });

    // Scroll spy for letter bar
    let observer;
    function setupScrollSpy() {
        if (observer) observer.disconnect();
        const headings = container.querySelectorAll('.letter-heading');
        if (!headings.length) return;

        observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const letter = entry.target.textContent;
                    document.querySelectorAll('.az-letter-btn').forEach(btn => {
                        btn.classList.toggle('active', btn.dataset.letter === letter);
                    });
                }
            });
        }, { rootMargin: '-80px 0px -70% 0px' });

        headings.forEach(h => observer.observe(h));
    }

    // Fetch and initialize
    fetch('/chords/index.json')
        .then(r => r.json())
        .then(data => {
            allEntries = data;
            countEl.textContent = data.length;
            renderRecentlyAdded(data);
            renderCards(data);
            setupScrollSpy();
        })
        .catch(() => {
            container.innerHTML = '<p style="color:var(--text-muted);text-align:center;">Unable to load chord library.</p>';
        });
})();
