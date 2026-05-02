document.addEventListener('DOMContentLoaded', function() {
    // Mobile menu toggle
    const mobileMenuToggle = document.querySelector('.mobile-menu-toggle');
    const nav = document.querySelector('nav');
    const navLinks = document.querySelectorAll('nav ul li a');

    if (mobileMenuToggle && nav) {
        mobileMenuToggle.addEventListener('click', function() {
            nav.classList.toggle('mobile-nav-open');
            mobileMenuToggle.classList.toggle('active');
            const isExpanded = nav.classList.contains('mobile-nav-open');
            mobileMenuToggle.setAttribute('aria-expanded', isExpanded);
            document.body.style.overflow = isExpanded ? 'hidden' : '';
        });

        navLinks.forEach(link => {
            link.addEventListener('click', function() {
                nav.classList.remove('mobile-nav-open');
                mobileMenuToggle.classList.remove('active');
                mobileMenuToggle.setAttribute('aria-expanded', 'false');
                document.body.style.overflow = '';
            });
        });

        document.addEventListener('click', function(event) {
            if (!nav.contains(event.target) && !mobileMenuToggle.contains(event.target)) {
                nav.classList.remove('mobile-nav-open');
                mobileMenuToggle.classList.remove('active');
                mobileMenuToggle.setAttribute('aria-expanded', 'false');
                document.body.style.overflow = '';
            }
        });

        window.addEventListener('resize', function() {
            if (window.innerWidth > 768 && nav.classList.contains('mobile-nav-open')) {
                nav.classList.remove('mobile-nav-open');
                mobileMenuToggle.classList.remove('active');
                mobileMenuToggle.setAttribute('aria-expanded', 'false');
                document.body.style.overflow = '';
            }
        });
    }

    // Smooth scrolling for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;
            e.preventDefault();
            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                window.scrollTo({
                    top: targetElement.offsetTop - 80,
                    behavior: 'smooth'
                });
            }
        });
    });

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    // Offline indicator
    const offlineBanner = document.getElementById('offline-banner');
    if (offlineBanner) {
        window.addEventListener('online', () => { offlineBanner.style.display = 'none'; });
        window.addEventListener('offline', () => { offlineBanner.style.display = 'block'; });
    }
});

// ---------------------------------------------------------------------------
// UPI Donate — used on all pages via nav + donate section
// ---------------------------------------------------------------------------
const UPI_ID = '7306025928@upi';

function isMobileDevice() {
    return navigator.maxTouchPoints > 0 && window.matchMedia('(pointer: coarse)').matches;
}

function openUPI() {
    if (isMobileDevice()) {
        window.open(`upi://pay?pa=${UPI_ID}&pn=Swaram`, '_blank');
    } else {
        showQRModal();
    }
}

function closeUPI() {
    const modal = document.getElementById('upi-modal');
    if (modal) modal.style.display = 'none';
    const qrModal = document.getElementById('qr-modal');
    if (qrModal) qrModal.style.display = 'none';
}

function showQRModal() {
    // Use pre-built modal if present (chord-finder, index, etc.)
    const existing = document.getElementById('upi-modal');
    if (existing) {
        existing.style.display = 'flex';
        return;
    }
    // Otherwise check for dynamically created modal
    if (document.getElementById('qr-modal')) {
        document.getElementById('qr-modal').style.display = 'flex';
        return;
    }
    // Create modal dynamically
    const modal = document.createElement('div');
    modal.id = 'qr-modal';
    modal.className = 'qr-modal-overlay';
    modal.innerHTML = `
        <div class="qr-modal-content">
            <button class="qr-modal-close" aria-label="Close">&times;</button>
            <h3 data-i18n="qr_modal_title">Scan to Donate via UPI</h3>
            <img src="/assets/donate-qr.png" alt="UPI QR Code for donation" class="qr-modal-img">
            <p class="qr-modal-upi-id">UPI ID: <strong>${UPI_ID}</strong>
                <button class="qr-modal-copy" onclick="copyUPIId()" data-i18n="copy_upi_id">Copy</button>
            </p>
            <p class="qr-modal-hint" data-i18n="qr_modal_hint">Open any UPI app on your phone and scan this QR code</p>
        </div>`;
    document.body.appendChild(modal);
    modal.querySelector('.qr-modal-close').addEventListener('click', () => modal.style.display = 'none');
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
}

function copyUPIId() {
    navigator.clipboard.writeText(UPI_ID).then(() => {
        const btn = document.querySelector('.qr-modal-copy');
        if (btn) { btn.textContent = '✓'; setTimeout(() => btn.textContent = 'Copy', 1500); }
    });
}

// ---------------------------------------------------------------------------
// Social Share — used on song + lyrics pages
// ---------------------------------------------------------------------------
function shareSong(platform) {
    const url = window.location.href;
    const container = document.querySelector('.share-buttons');
    const title = container ? container.dataset.songTitle : document.title;
    const artist = container ? container.dataset.songArtist : '';
    const text = artist ? `${title} by ${artist} — Chords on Swaram` : `${title} — Chords on Swaram`;

    switch (platform) {
        case 'whatsapp':
            window.open(`https://wa.me/?text=${encodeURIComponent(text + '\n' + url)}`, '_blank');
            break;
        case 'facebook':
            window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, '_blank');
            break;
        case 'twitter':
            window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank');
            break;
        case 'copy':
            navigator.clipboard.writeText(url).then(() => {
                const btn = container ? container.querySelector('.share-copy') : null;
                if (btn) {
                    btn.classList.add('copied');
                    btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
                    setTimeout(() => {
                        btn.classList.remove('copied');
                        btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
                    }, 2000);
                }
            });
            break;
    }
}

// ---------------------------------------------------------------------------
// PWA Install Prompt — non-intrusive, one-time
// ---------------------------------------------------------------------------
(function () {
    let deferredPrompt = null;

    window.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault();
        deferredPrompt = e;

        // Don't show if user already dismissed or app is installed
        if (localStorage.getItem('pwa-install-dismissed')) return;
        if (window.matchMedia('(display-mode: standalone)').matches) return;

        // Delay showing the banner by 30 seconds so it's not intrusive
        setTimeout(showInstallBanner, 30000);
    });

    // If app gets installed, remove banner and mark as installed
    window.addEventListener('appinstalled', function () {
        localStorage.setItem('pwa-install-dismissed', '1');
        const banner = document.getElementById('pwa-install-banner');
        if (banner) banner.remove();
    });

    function showInstallBanner() {
        if (!deferredPrompt) return;
        if (document.getElementById('pwa-install-banner')) return;

        const banner = document.createElement('div');
        banner.id = 'pwa-install-banner';
        banner.className = 'pwa-install-banner';
        banner.innerHTML =
            '<span class="pwa-text" data-i18n="pwa_install_text">Install Swaram for quick access — works offline too!</span>' +
            '<button class="pwa-install-btn" data-i18n="pwa_install_btn">Install</button>' +
            '<button class="pwa-dismiss" aria-label="Dismiss">&times;</button>';
        document.body.appendChild(banner);

        banner.querySelector('.pwa-install-btn').addEventListener('click', function () {
            deferredPrompt.prompt();
            deferredPrompt.userChoice.then(function (result) {
                if (result.outcome === 'accepted') {
                    localStorage.setItem('pwa-install-dismissed', '1');
                }
                deferredPrompt = null;
                banner.remove();
            });
        });

        banner.querySelector('.pwa-dismiss').addEventListener('click', function () {
            localStorage.setItem('pwa-install-dismissed', '1');
            banner.remove();
            deferredPrompt = null;
        });
    }
})();
