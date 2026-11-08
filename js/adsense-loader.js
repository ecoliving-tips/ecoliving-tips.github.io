(function () {
    'use strict';

    if (window.__swaramAdsLoaderInitialized) return;
    window.__swaramAdsLoaderInitialized = true;

    const ADS_CLIENT = 'ca-pub-7438590583270235';
    const BLOCKED_AD_COUNTRIES = new Set(['SG']);
    const GEO_CACHE_KEY = 'swaram-ads-country-v2';
    const GEO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
    const AD_VIEWPORT_MARGIN_PX = 200;
    const GEO_PROVIDERS = [
        { url: 'https://ipwho.is/', getCountry: data => data.country_code },
        { url: 'https://api.ipapi.is/', getCountry: data => data.cc },
        { url: 'https://ipinfo.io/json', getCountry: data => data.country },
        { url: 'https://free.freeipapi.com/api/json', getCountry: data => data.countryCode },
        { url: 'https://api.country.is/', getCountry: data => data.country },
        { url: 'https://api.ip.sb/geoip', getCountry: data => data.country_code }
    ];
    window.__swaramAdsReady = false;
    let loaded = false;
    let blockedAdsObserver = null;

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
            /headlesschrome|phantomjs|playwright|selenium|puppeteer|nightmare|curl|wget|python-requests|httpclient|okhttp|bot|crawler|spider|slurp|bingpreview|facebookexternalhit|twitterbot|linkedinbot|whatsapp/i.test(ua)
        );
    }

    function getCachedCountries(includeExpired) {
        try {
            const cached = JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || 'null');
            if (!cached || typeof cached.timestamp !== 'number') return null;
            if (!includeExpired && Date.now() - cached.timestamp > GEO_CACHE_TTL_MS) return null;
            if (!Array.isArray(cached.countries) || !cached.countries.length) return null;
            if (!cached.countries.every(country => typeof country === 'string' && /^[A-Z]{2}$/.test(country))) return null;
            return cached.countries;
        } catch (error) {
            return null;
        }
    }

    function cacheCountries(countries) {
        try {
            localStorage.setItem(GEO_CACHE_KEY, JSON.stringify({
                timestamp: Date.now(),
                countries
            }));
        } catch (error) {
        }
    }

    async function isAdCountryAllowed() {
        const cachedCountries = getCachedCountries();
        if (cachedCountries) return !isBlockedCountry(cachedCountries);

        const controllers = GEO_PROVIDERS.map(() => new AbortController());
        let rejectCountry;
        const blockedCountry = new Promise(resolve => { rejectCountry = resolve; });
        const lookup = Promise.all(GEO_PROVIDERS.map(async (provider, index) => {
            try {
                const controller = controllers[index];
                const timeout = setTimeout(() => controller.abort(), 5000);
                try {
                    const response = await fetch(provider.url, {
                        cache: 'no-store',
                        credentials: 'omit',
                        signal: controller.signal
                    });
                    if (!response.ok) return null;

                    const data = await response.json();
                    const country = provider.getCountry(data);
                    if (typeof country !== 'string' || !/^[A-Za-z]{2}$/.test(country)) return null;
                    const normalizedCountry = country.toUpperCase();
                    if (BLOCKED_AD_COUNTRIES.has(normalizedCountry)) {
                        cacheCountries([normalizedCountry]);
                        rejectCountry(false);
                        controllers.forEach(other => other.abort());
                    }
                    return normalizedCountry;
                } finally {
                    clearTimeout(timeout);
                }
            } catch (error) {
                return null;
            }
        })).then(results => {

            const countries = results.filter(Boolean);
            if (!countries.length) {
                const staleCountries = getCachedCountries(true);
                console.warn('[AdSense] Country lookup unavailable; using cached country or the existing allow fallback.');
                if (staleCountries) return !isBlockedCountry(staleCountries);
                return true;
            }
            cacheCountries(countries);
            return !isBlockedCountry(countries);
        });

        // Never allow an early non-SG response to override a later SG response.
        return Promise.race([blockedCountry, lookup]);
    }

    function isBlockedCountry(countries) {
        return countries.some(country => BLOCKED_AD_COUNTRIES.has(country));
    }

    function cleanupAds(removeContainers) {
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

    function blockAds() {
        cleanupAds(true);
        if (blockedAdsObserver || !window.MutationObserver) return;
        blockedAdsObserver = new MutationObserver(function () {
            cleanupAds(true);
        });
        blockedAdsObserver.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }

    function hasAdRenderSpace(container) {
        const style = window.getComputedStyle(container);
        return style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            container.getBoundingClientRect().width > 0;
    }

    function renderAdSlot(container) {
        if (container.querySelector('.adsbygoogle')) return true;
        if (!hasAdRenderSpace(container)) return false;
        if (
            container.dataset.swaramAdFormat === 'fluid' &&
            container.getBoundingClientRect().width < 250
        ) return false;

        const ad = document.createElement('ins');
        ad.className = 'adsbygoogle';
        ad.style.display = 'block';
        ad.dataset.adClient = ADS_CLIENT;
        ad.dataset.adSlot = container.dataset.swaramAdSlot;
        if (container.dataset.swaramAdLayout) ad.dataset.adLayout = container.dataset.swaramAdLayout;
        if (container.dataset.swaramAdLayoutKey) ad.dataset.adLayoutKey = container.dataset.swaramAdLayoutKey;
        if (container.dataset.swaramAdFormat) ad.dataset.adFormat = container.dataset.swaramAdFormat;
        if (container.dataset.swaramAdFullWidthResponsive) {
            ad.dataset.fullWidthResponsive = container.dataset.swaramAdFullWidthResponsive;
        }
        if (container.dataset.swaramAdLayout === 'in-article') ad.style.textAlign = 'center';
        container.appendChild(ad);
        if (window.MutationObserver) {
            const adStatusObserver = new MutationObserver(function () {
                const status = ad.dataset.adStatus;
                if (status === 'unfilled' || status === 'unfill-optimized') {
                    container.classList.add('ad-slot-unfilled');
                    adStatusObserver.disconnect();
                } else if (status === 'filled') {
                    adStatusObserver.disconnect();
                }
            });
            adStatusObserver.observe(ad, { attributes: true, attributeFilter: ['data-ad-status'] });
        }
        (window.adsbygoogle = window.adsbygoogle || []).push({});
        return true;
    }

    function renderVisibleAdSlots() {
        document.querySelectorAll('[data-swaram-ad-slot]').forEach(function (container) {
            const rect = container.getBoundingClientRect();
            if (rect.bottom >= -AD_VIEWPORT_MARGIN_PX &&
                rect.top <= window.innerHeight + AD_VIEWPORT_MARGIN_PX &&
                rect.right > 0 && rect.left < window.innerWidth) {
                renderAdSlot(container);
            }
        });
    }

    function observeAdSlots() {
        let scheduled = false;
        function scheduleVisibleAds() {
            if (scheduled) return;
            scheduled = true;
            window.requestAnimationFrame(function () {
                scheduled = false;
                renderVisibleAdSlots();
            });
        }
        window.addEventListener('resize', scheduleVisibleAds, { passive: true });
        window.addEventListener('swaram:ads-visibility-changed', scheduleVisibleAds);
        if (!window.IntersectionObserver) {
            window.addEventListener('scroll', scheduleVisibleAds, { passive: true });
            return;
        }
        const observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                if (renderAdSlot(entry.target)) observer.unobserve(entry.target);
            });
        }, { rootMargin: `${AD_VIEWPORT_MARGIN_PX}px` });

        document.querySelectorAll('[data-swaram-ad-slot]').forEach(function (container) {
            if (!container.querySelector('.adsbygoogle')) observer.observe(container);
        });
    }

    async function injectAdSenseScript() {
        if (loaded || isLikelyAutomation()) return;
        if (!await isAdCountryAllowed()) {
            blockAds();
            return;
        }
        loaded = true;
        window.__swaramAdsReady = true;

        function appendScript() {
            if (document.getElementById('swaram-adsense-loader')) return;
            renderVisibleAdSlots();
            observeAdSlots();
            const script = document.createElement('script');
            script.id = 'swaram-adsense-loader';
            script.async = true;
            script.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + ADS_CLIENT;
            script.crossOrigin = 'anonymous';
            script.addEventListener('error', function () {
                console.error('[AdSense] Ad script could not load. Check network access or content blocking.');
            });
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

    cleanupAds(false);
    window.addEventListener('pointerdown', onHumanSignal, { once: true, passive: true, capture: true });
    window.addEventListener('keydown', onHumanSignal, { once: true, passive: true, capture: true });
    window.addEventListener('touchstart', onHumanSignal, { once: true, passive: true, capture: true });
    window.addEventListener('scroll', onHumanSignal, { once: true, passive: true, capture: true });
})();
