(function () {
    'use strict';

    function loadScriptOnce(scriptId, src, attrs) {
        if (document.getElementById(scriptId)) return;
        const script = document.createElement('script');
        script.id = scriptId;
        script.src = src;
        script.async = true;
        if (attrs) {
            Object.keys(attrs).forEach((key) => {
                script.setAttribute(key, attrs[key]);
            });
        }
        document.head.appendChild(script);
    }

    function initGoogleAnalytics() {
        const gaId = document.querySelector('meta[name="swaram-ga-id"]')?.getAttribute('content');
        if (!gaId) return;

        window.dataLayer = window.dataLayer || [];
        window.gtag = window.gtag || function gtag() {
            window.dataLayer.push(arguments);
        };

        loadScriptOnce('swaram-ga4-loader', `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`);
        window.gtag('js', new Date());
        window.gtag('config', gaId);
    }

    function shouldSkipAdsLoad() {
        return !!(
            navigator.webdriver ||
            window.__nightmare ||
            window._phantom ||
            window.callPhantom ||
            document.__selenium_unwrapped ||
            window.domAutomation ||
            window.domAutomationController
        );
    }

    function initAdSense() {
        const adsClient = document.querySelector('meta[name="google-adsense-account"]')?.getAttribute('content');
        if (!adsClient || shouldSkipAdsLoad()) return;

        let loaded = false;
        let waitingForVisible = false;

        function renderPendingAdSlots() {
            if (!window.adsbygoogle || !Array.isArray(window.adsbygoogle)) return;

            document.querySelectorAll('ins.adsbygoogle').forEach((slot) => {
                if (slot.getAttribute('data-adsbygoogle-status')) return;
                try {
                    window.adsbygoogle.push({});
                } catch {
                    // Ignore slot-level render failures to avoid breaking page scripts.
                }
            });
        }

        function onVisible() {
            waitingForVisible = false;
            loadAds();
        }

        function loadAds() {
            if (loaded) return;
            if (document.hidden) {
                if (!waitingForVisible) {
                    waitingForVisible = true;
                    document.addEventListener('visibilitychange', onVisible, { once: true });
                }
                return;
            }

            loaded = true;
            loadScriptOnce(
                'swaram-adsense-loader',
                `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(adsClient)}`,
                { crossorigin: 'anonymous' }
            );

            const loader = document.getElementById('swaram-adsense-loader');
            if (loader) {
                loader.addEventListener('load', renderPendingAdSlots, { once: true });
            }

            // Fallback trigger for browsers where script load event timing is inconsistent.
            setTimeout(renderPendingAdSlots, 1500);
        }

        const events = ['scroll', 'mousemove', 'click', 'touchstart', 'keydown'];
        function onInteraction() {
            events.forEach((eventName) => {
                document.removeEventListener(eventName, onInteraction);
            });
            setTimeout(loadAds, 1000);
        }

        events.forEach((eventName) => {
            document.addEventListener(eventName, onInteraction, { passive: true });
        });

        setTimeout(loadAds, 5000);
    }

    function init() {
        initGoogleAnalytics();
        initAdSense();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
