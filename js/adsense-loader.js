(function () {
    'use strict';

    if (window.__swaramAdsLoaderInitialized) return;
    window.__swaramAdsLoaderInitialized = true;

    const ADS_CLIENT = 'ca-pub-7438590583270235';
    const ADSENSE_MODE = 'emergency'; // BUILD: ADSENSE_EMERGENCY_MODE
    const BLOCKED_AD_COUNTRIES = new Set(['SG']);
    const EMERGENCY_ALLOWED_COUNTRIES = new Set([
        'US', 'GB', 'CA', 'AU', 'DE', 'NL', 'SE', 'FR',
        'ME', 'CH', 'AT', 'LC', 'NZ', 'IT'
    ]);
    const GEO_PROVIDERS = [
        { url: 'https://ipwho.is/', getCountry: data => data.country_code },
        { url: 'https://ipapi.co/json/', getCountry: data => data.country_code },
        { url: 'https://ipinfo.io/json', getCountry: data => data.country },
        { url: 'https://free.freeipapi.com/api/json', getCountry: data => data.countryCode }
    ];
    const GEO_CACHE_KEY = 'swaram-ads-country-v2';
    const GEO_CACHE_TTL = 24 * 60 * 60 * 1000;
    window.__swaramAdsEmergency = ADSENSE_MODE === 'emergency';
    window.__swaramAdsReady = false;
    let loaded = false;
    let emergencyObserver = null;

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

    async function isAdCountryAllowed() {
        let cached = null;
        try {
            cached = JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || 'null');
        } catch (error) {
            localStorage.removeItem(GEO_CACHE_KEY);
        }

        if (
            cached &&
            typeof cached.country === 'string' &&
            /^[A-Za-z]{2}$/.test(cached.country) &&
            cached.expires > Date.now()
        ) {
            const normalizedCountry = cached.country.toUpperCase();
            if (ADSENSE_MODE === 'emergency') {
                return EMERGENCY_ALLOWED_COUNTRIES.has(normalizedCountry);
            }
            return !BLOCKED_AD_COUNTRIES.has(normalizedCountry);
        }

        for (const provider of GEO_PROVIDERS) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 5000);
                const response = await fetch(provider.url, {
                    cache: 'no-store',
                    credentials: 'omit',
                    signal: controller.signal
                });
                clearTimeout(timeout);
                if (!response.ok) continue;

                const data = await response.json();
                const country = provider.getCountry(data);
                if (typeof country !== 'string' || !/^[A-Za-z]{2}$/.test(country)) continue;

                const normalizedCountry = country.toUpperCase();
                localStorage.setItem(GEO_CACHE_KEY, JSON.stringify({
                    country: normalizedCountry,
                    expires: Date.now() + GEO_CACHE_TTL
                }));
                if (ADSENSE_MODE === 'emergency') {
                    return EMERGENCY_ALLOWED_COUNTRIES.has(normalizedCountry);
                }
                return !BLOCKED_AD_COUNTRIES.has(normalizedCountry);
            } catch (error) {
                // Try the next provider before failing closed.
            }
        }

        return false;
    }

    function cleanupEmergencyAds(removeContainers) {
        document.querySelectorAll(
            'meta[name="google-adsense-account"], .adsbygoogle, script[src*="adsbygoogle"], #swaram-adsense-loader, iframe[src*="googleads"], iframe[src*="doubleclick"]'
        ).forEach(function (element) {
            element.remove();
        });
        if (removeContainers) {
            document.querySelectorAll('[data-swaram-ad-slot]').forEach(function (element) {
                element.remove();
            });
        }
        window.adsbygoogle = [];
        window.__swaramAdsReady = false;
    }

    function blockEmergencyAds() {
        cleanupEmergencyAds(true);
        if (emergencyObserver || !window.MutationObserver) return;
        emergencyObserver = new MutationObserver(function () {
            cleanupEmergencyAds(true);
        });
        emergencyObserver.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
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

    async function injectAdSenseScript() {
        if (loaded || isLikelyAutomation()) return;
        if (!await isAdCountryAllowed()) {
            if (ADSENSE_MODE === 'emergency') blockEmergencyAds();
            return;
        }
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

    if (ADSENSE_MODE === 'emergency') {
        cleanupEmergencyAds(false);
        injectAdSenseScript();
        return;
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
