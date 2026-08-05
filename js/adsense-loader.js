(function () {
    'use strict';

    if (window.__swaramAdsLoaderInitialized) return;
    window.__swaramAdsLoaderInitialized = true;

    const ADS_CLIENT = 'ca-pub-7438590583270235';
    const MIN_DWELL_MS = 7000;
    const PRIMARY_ONLY_WAIT_MS = 15000;
    const MIN_SCROLL_PX = 220;

    const startedAt = Date.now();
    let loaded = false;
    let hasPrimarySignal = false;
    let hasMeaningfulScroll = false;
    let gateTimer = null;

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

    function elapsedMs() {
        return Date.now() - startedAt;
    }

    function clearGateTimer() {
        if (!gateTimer) return;
        clearTimeout(gateTimer);
        gateTimer = null;
    }

    function cleanupListeners() {
        clearGateTimer();
        window.removeEventListener('pointerdown', onPrimarySignal, true);
        window.removeEventListener('keydown', onPrimarySignal, true);
        window.removeEventListener('touchstart', onPrimarySignal, true);
        window.removeEventListener('scroll', onScrollSignal, true);
        document.removeEventListener('visibilitychange', onVisibilityChange, true);
    }

    function maybeLoadAds() {
        if (loaded || isLikelyAutomation()) {
            cleanupListeners();
            return;
        }

        if (!hasPrimarySignal) return;
        if (document.visibilityState !== 'visible') return;

        const elapsed = elapsedMs();
        if (elapsed < MIN_DWELL_MS) {
            if (!gateTimer) {
                gateTimer = setTimeout(function () {
                    gateTimer = null;
                    maybeLoadAds();
                }, MIN_DWELL_MS - elapsed);
            }
            return;
        }

        // Stronger protection: require either meaningful scroll or extra dwell time.
        if (!hasMeaningfulScroll && elapsed < PRIMARY_ONLY_WAIT_MS) {
            if (!gateTimer) {
                gateTimer = setTimeout(function () {
                    gateTimer = null;
                    maybeLoadAds();
                }, PRIMARY_ONLY_WAIT_MS - elapsed);
            }
            return;
        }

        cleanupListeners();
        injectAdSenseScript();
    }

    function onPrimarySignal() {
        hasPrimarySignal = true;
        maybeLoadAds();
    }

    function onScrollSignal() {
        if (window.scrollY >= MIN_SCROLL_PX) {
            hasMeaningfulScroll = true;
            maybeLoadAds();
        }
    }

    function onVisibilityChange() {
        if (document.visibilityState === 'visible') {
            maybeLoadAds();
        }
    }

    // Optional manual override for debugging: ?ads=force
    if (new URLSearchParams(window.location.search).get('ads') === 'force') {
        injectAdSenseScript();
        return;
    }

    window.addEventListener('pointerdown', onPrimarySignal, { passive: true, capture: true });
    window.addEventListener('keydown', onPrimarySignal, { passive: true, capture: true });
    window.addEventListener('touchstart', onPrimarySignal, { passive: true, capture: true });
    window.addEventListener('scroll', onScrollSignal, { passive: true, capture: true });
    document.addEventListener('visibilitychange', onVisibilityChange, { capture: true });
})();
