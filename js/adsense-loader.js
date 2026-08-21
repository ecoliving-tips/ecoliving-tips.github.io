(function () {
    'use strict';

    if (window.__swaramAdsLoaderInitialized) return;
    window.__swaramAdsLoaderInitialized = true;

    const ADS_CLIENT = 'ca-pub-7438590583270235';
    const ADSENSE_MODE = 'normal'; // BUILD: ADSENSE_EMERGENCY_MODE
    window.__swaramAdsEmergency = ADSENSE_MODE === 'emergency';
    window.__swaramAdsReady = false;
    let loaded = false;

    if (ADSENSE_MODE === 'emergency') return;

    function isLikelyAutomation() {
        const ua = (navigator.userAgent || '').toLowerCase();
        return !!(
            navigator.webdriver ||
            window.__nightmare ||
            window._phantom ||
            window.callPhantom ||
            document.__selenium_unwrapped ||
            window.domAutomation ||
            window.domAutomationController ||
            ua.includes('headlesschrome') ||
            ua.includes('phantomjs') ||
            ua.includes('playwright') ||
            ua.includes('selenium') ||
            ua.includes('puppeteer')
        );
    }

    function renderAdSlots() {
        document.querySelectorAll('[data-swaram-ad-slot]').forEach(function (container) {
            if (container.querySelector('.adsbygoogle')) return;
            const ad = document.createElement('ins');
            ad.className = 'adsbygoogle';
            ad.style.display = 'block';
            ad.dataset.adClient = ADS_CLIENT;
            ad.dataset.adSlot = container.dataset.swaramAdSlot;
            if (container.dataset.swaramAdLayout) ad.dataset.adLayout = container.dataset.swaramAdLayout;
            if (container.dataset.swaramAdFormat) ad.dataset.adFormat = container.dataset.swaramAdFormat;
            container.appendChild(ad);
            (window.adsbygoogle = window.adsbygoogle || []).push({});
        });
    }

    function injectAdSenseScript() {
        if (loaded || isLikelyAutomation()) return;
        loaded = true;
        window.__swaramAdsReady = true;

        function appendScript() {
            if (document.getElementById('swaram-adsense-loader')) return;
            renderAdSlots();
            const script = document.createElement('script');
            script.id = 'swaram-adsense-loader';
            script.async = true;
            script.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + ADS_CLIENT;
            script.crossOrigin = 'anonymous';
            document.head.appendChild(script);
        }

        if (document.visibilityState === 'visible') {
            appendScript();
        } else {
            document.addEventListener('visibilitychange', function onVisible() {
                if (document.visibilityState !== 'visible') return;
                document.removeEventListener('visibilitychange', onVisible);
                appendScript();
            });
        }
    }

    function cleanupListeners() {
        window.removeEventListener('pointerdown', onHumanSignal, true);
        window.removeEventListener('keydown', onHumanSignal, true);
        window.removeEventListener('touchstart', onHumanSignal, true);
        window.removeEventListener('scroll', onHumanSignal, true);
    }

    function onHumanSignal() {
        cleanupListeners();
        injectAdSenseScript();
    }

    // Optional manual override for debugging: ?ads=force
    if (new URLSearchParams(window.location.search).get('ads') === 'force') {
        injectAdSenseScript();
        return;
    }

    window.addEventListener('pointerdown', onHumanSignal, { once: true, passive: true, capture: true });
    window.addEventListener('keydown', onHumanSignal, { once: true, passive: true, capture: true });
    window.addEventListener('touchstart', onHumanSignal, { once: true, passive: true, capture: true });
    window.addEventListener('scroll', onHumanSignal, { once: true, passive: true, capture: true });
})();
