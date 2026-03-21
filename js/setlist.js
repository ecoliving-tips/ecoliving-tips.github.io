// Swaram - Setlist / Playlist Feature

const SETLIST_KEY = 'swaram-setlist';

function getSetlist() {
    try {
        return JSON.parse(localStorage.getItem(SETLIST_KEY)) || [];
    } catch {
        return [];
    }
}

function saveSetlist(list) {
    localStorage.setItem(SETLIST_KEY, JSON.stringify(list));
}

function addToSetlist(songId) {
    const list = getSetlist();
    if (!list.includes(songId)) {
        list.push(songId);
        saveSetlist(list);
    }
    updateSetlistButtons(songId);
}

function removeFromSetlist(songId) {
    const list = getSetlist().filter(id => id !== songId);
    saveSetlist(list);
    updateSetlistButtons(songId);
    // If on setlist page, re-render
    if (document.getElementById('setlist-container')) {
        renderSetlistPage();
    }
}

function isInSetlist(songId) {
    return getSetlist().includes(songId);
}

function toggleSetlist(songId) {
    if (isInSetlist(songId)) {
        removeFromSetlist(songId);
    } else {
        addToSetlist(songId);
    }
}

function updateSetlistButtons(songId) {
    document.querySelectorAll(`[data-setlist-id="${songId}"]`).forEach(btn => {
        if (isInSetlist(songId)) {
            btn.textContent = t('in_setlist', 'In Setlist');
            btn.classList.add('in-setlist');
            // Show "View Setlist" link next to button
            if (!btn.nextElementSibling || !btn.nextElementSibling.classList.contains('view-setlist-link')) {
                const link = document.createElement('a');
                link.href = '/setlist.html';
                link.className = 'view-setlist-link';
                link.textContent = t('view_setlist', 'View Setlist');
                btn.parentNode.insertBefore(link, btn.nextSibling);
            }
        } else {
            btn.textContent = t('add_setlist', '+ Add to Setlist');
            btn.classList.remove('in-setlist');
            // Remove "View Setlist" link
            const link = btn.nextElementSibling;
            if (link && link.classList.contains('view-setlist-link')) {
                link.remove();
            }
        }
    });
}

function clearSetlist() {
    saveSetlist([]);
    if (document.getElementById('setlist-container')) {
        renderSetlistPage();
    }
}

function generateShareUrl() {
    const list = getSetlist();
    if (list.length === 0) return '';
    return window.location.origin + '/setlist.html?songs=' + list.join(',');
}

function shareSetlist() {
    const url = generateShareUrl();
    if (!url) return;
    if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(() => {
            showToast(t('link_copied', 'Link copied to clipboard!'));
        });
    } else {
        prompt('Copy this link:', url);
    }
}

function showToast(message) {
    const existing = document.querySelector('.toast-message');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast-message success-banner';
    toast.textContent = message;
    toast.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;text-align:center;padding:12px;';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ===== Setlist Page Rendering =====

async function renderSetlistPage() {
    const container = document.getElementById('setlist-container');
    if (!container) return;

    const list = getSetlist();

    // Check for shared setlist in URL
    const params = new URLSearchParams(window.location.search);
    const sharedSongs = params.get('songs');
    if (sharedSongs && list.length === 0) {
        const ids = sharedSongs.split(',').filter(Boolean);
        saveSetlist(ids);
        // Remove query param to avoid re-importing
        window.history.replaceState({}, '', window.location.pathname);
        return renderSetlistPage();
    }

    if (list.length === 0) {
        container.innerHTML = `
            <div class="setlist-empty">
                <p data-i18n="setlist_empty">Your setlist is empty</p>
                <p data-i18n="setlist_empty_desc">Browse songs and add them to your setlist!</p>
                <a href="/songs.html" class="btn" data-i18n="browse_songs">Browse Songs</a>
            </div>
        `;
        applyLanguage(currentLang);
        return;
    }

    // Load song data
    try {
        const res = await fetch('/songs/index.json');
        const allSongs = await res.json();
        const songMap = {};
        allSongs.forEach(s => songMap[s.id] = s);

        let html = '<ul class="setlist-list">';
        list.forEach((id, index) => {
            const song = songMap[id];
            if (!song) return;
            const titleMl = song.title_ml || '';
            const artistMl = song.artist_ml || '';
            html += `
                <li class="setlist-item" draggable="true" data-index="${index}" data-id="${id}">
                    <span class="drag-handle">&#9776;</span>
                    <div class="setlist-info">
                        <h4><a href="/songs/${id}/"><span class="lang-en">${escapeSetlistHtml(song.title)}</span>${titleMl ? `<span class="lang-ml">${escapeSetlistHtml(titleMl)}</span>` : ''}</a></h4>
                        <p><span class="lang-en">${escapeSetlistHtml(song.artist || 'Unknown')}</span>${artistMl ? `<span class="lang-ml">${escapeSetlistHtml(artistMl)}</span>` : ''} &middot; ${escapeSetlistHtml(song.category || 'General')} &middot; Key: ${escapeSetlistHtml(song.key || '?')}</p>
                    </div>
                    <button class="remove-btn" onclick="removeFromSetlist('${id}')" aria-label="Remove from setlist">&times;</button>
                </li>
            `;
        });
        html += '</ul>';

        html += `
            <div class="setlist-actions">
                <button class="btn btn-secondary" onclick="shareSetlist()" data-i18n="share_setlist">Share Setlist</button>
                <button class="btn btn-secondary" onclick="window.print()" data-i18n="print_setlist">Print Setlist</button>
                <button class="btn btn-secondary" onclick="clearSetlist()" data-i18n="clear_setlist">Clear All</button>
            </div>
        `;

        container.innerHTML = html;
        setupDragAndDrop();
        applyLanguage(currentLang);
    } catch (e) {
        container.innerHTML = '<p>Error loading setlist. Please try again.</p>';
    }
}

function escapeSetlistHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function setupDragAndDrop() {
    const items = document.querySelectorAll('.setlist-item');
    let draggedItem = null;

    items.forEach(item => {
        item.addEventListener('dragstart', (e) => {
            draggedItem = item;
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });

        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            draggedItem = null;
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });

        item.addEventListener('drop', (e) => {
            e.preventDefault();
            if (!draggedItem || draggedItem === item) return;

            const list = getSetlist();
            const fromId = draggedItem.getAttribute('data-id');
            const toId = item.getAttribute('data-id');
            const fromIdx = list.indexOf(fromId);
            const toIdx = list.indexOf(toId);

            if (fromIdx > -1 && toIdx > -1) {
                list.splice(fromIdx, 1);
                list.splice(toIdx, 0, fromId);
                saveSetlist(list);
                renderSetlistPage();
            }
        });
    });
}

// Initialize setlist page if we're on it
document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('setlist-container')) {
        renderSetlistPage();
    }

    // Initialize setlist buttons on song pages
    document.querySelectorAll('[data-setlist-id]').forEach(btn => {
        const songId = btn.getAttribute('data-setlist-id');
        updateSetlistButtons(songId);
    });
});
