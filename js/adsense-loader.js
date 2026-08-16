(function () {
    'use strict';

    if (window.__swaramAdsLoaderInitialized) return;
    window.__swaramAdsLoaderInitialized = true;

    const ADS_CLIENT = 'ca-pub-7438590583270235';
    const ADSENSE_MODE = 'normal'; // BUILD: ADSENSE_EMERGENCY_MODE
    const EMERGENCY_DWELL_MS = 3000;
    const EMERGENCY_SCROLL_PX = 100;
    let loaded = false;
    let hasPrimarySignal = false;
    let hasMeaningfulScroll = false;
    let emergencyStartedAt = 0;
    let emergencyTimer = null;

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

    function injectAdSenseScript() {
        if (loaded || isLikelyAutomation()) return;
        loaded = true;

        function appendScript() {
            if (document.getElementById('swaram-adsense-loader')) return;
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
        window.removeEventListener('pointerdown', onEmergencyPrimarySignal, true);
        window.removeEventListener('keydown', onEmergencyPrimarySignal, true);
        window.removeEventListener('touchstart', onEmergencyPrimarySignal, true);
        window.removeEventListener('scroll', onEmergencyScrollSignal, true);
        document.removeEventListener('visibilitychange', onEmergencyVisibilityChange, true);
        if (emergencyTimer) {
            clearTimeout(emergencyTimer);
            emergencyTimer = null;
        }
    }

    function onHumanSignal() {
        cleanupListeners();
        injectAdSenseScript();
    }

    function maybeLoadEmergencyAds() {
        if (loaded || isLikelyAutomation()) {
            cleanupListeners();
            return;
        }
        if (!hasPrimarySignal || !hasMeaningfulScroll || document.visibilityState !== 'visible') return;

        const remainingMs = EMERGENCY_DWELL_MS - (Date.now() - emergencyStartedAt);
        if (remainingMs > 0) {
            if (!emergencyTimer) {
                emergencyTimer = setTimeout(function () {
                    emergencyTimer = null;
                    maybeLoadEmergencyAds();
                }, remainingMs);
            }
            return;
        }

        cleanupListeners();
        injectAdSenseScript();
    }

    function onEmergencyPrimarySignal() {
        if (!hasPrimarySignal) {
            hasPrimarySignal = true;
            emergencyStartedAt = Date.now();
        }
        maybeLoadEmergencyAds();
    }

    function onEmergencyScrollSignal() {
        hasMeaningfulScroll = window.scrollY >= EMERGENCY_SCROLL_PX;
        maybeLoadEmergencyAds();
    }

    function onEmergencyVisibilityChange() {
        maybeLoadEmergencyAds();
    }

    // Optional manual override for debugging: ?ads=force
    if (ADSENSE_MODE !== 'emergency' && new URLSearchParams(window.location.search).get('ads') === 'force') {
        injectAdSenseScript();
        return;
    }

    if (ADSENSE_MODE === 'emergency') {
        window.addEventListener('pointerdown', onEmergencyPrimarySignal, { passive: true, capture: true });
        window.addEventListener('keydown', onEmergencyPrimarySignal, { passive: true, capture: true });
        window.addEventListener('touchstart', onEmergencyPrimarySignal, { passive: true, capture: true });
        window.addEventListener('scroll', onEmergencyScrollSignal, { passive: true, capture: true });
        document.addEventListener('visibilitychange', onEmergencyVisibilityChange, { capture: true });
        return;
    }

    window.addEventListener('pointerdown', onHumanSignal, { once: true, passive: true, capture: true });
    window.addEventListener('keydown', onHumanSignal, { once: true, passive: true, capture: true });
    window.addEventListener('touchstart', onHumanSignal, { once: true, passive: true, capture: true });
    window.addEventListener('scroll', onHumanSignal, { once: true, passive: true, capture: true });
})();
