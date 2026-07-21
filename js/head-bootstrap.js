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
        function loadAds() {
            if (loaded || document.hidden) return;
            loaded = true;
            loadScriptOnce(
                'swaram-adsense-loader',
                `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(adsClient)}`,
                { crossorigin: 'anonymous' }
            );
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
