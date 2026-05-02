/**
 * youtube-player.js — Shared lazy YouTube player for Swaram.
 * Shows a thumbnail with play button; loads IFrame API on tap (guaranteed user gesture).
 * Exposes window.SwaramYT for integration with chord-page-player.js and chord-finder.js.
 */
(function () {
    'use strict';

    var player = null;
    var containerId = '';
    var stateCallbacks = [];
    var apiLoading = false;

    function loadAPI(cb) {
        if (window.YT && window.YT.Player) { cb(); return; }
        if (!document.getElementById('yt-iframe-api')) {
            var tag = document.createElement('script');
            tag.id = 'yt-iframe-api';
            tag.src = 'https://www.youtube.com/iframe_api';
            document.head.appendChild(tag);
        }
        if (!apiLoading) {
            apiLoading = true;
            var prev = window.onYouTubeIframeAPIReady;
            window.onYouTubeIframeAPIReady = function () {
                apiLoading = false;
                if (prev) prev();
                cb();
            };
        }
        var check = setInterval(function () {
            if (window.YT && window.YT.Player) {
                clearInterval(check);
                cb();
            }
        }, 200);
        setTimeout(function () { clearInterval(check); }, 15000);
    }

    function createPlayer(container, videoId, autoplay) {
        container.classList.remove('yt-lazy-thumb');
        container.innerHTML = '';

        player = new YT.Player(container.id, {
            width: '100%',
            height: '100%',
            videoId: videoId,
            playerVars: {
                autoplay: autoplay ? 1 : 0,
                modestbranding: 1,
                rel: 0,
                playsinline: 1,
                origin: window.location.origin
            },
            events: {
                onReady: function () {
                    if (autoplay && player && typeof player.playVideo === 'function') {
                        player.playVideo();
                    }
                },
                onStateChange: function (event) {
                    for (var i = 0; i < stateCallbacks.length; i++) {
                        stateCallbacks[i](event);
                    }
                }
            }
        });
    }

    function renderThumbnail(container, videoId) {
        container.innerHTML = '';
        container.className = (container.className.replace(/\byt-lazy-thumb\b/, '') + ' yt-lazy-thumb').trim();

        var img = document.createElement('img');
        img.src = 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg';
        img.alt = 'Play video';
        img.loading = 'lazy';
        container.appendChild(img);

        var btn = document.createElement('button');
        btn.className = 'yt-play-btn';
        btn.setAttribute('aria-label', 'Play video');
        btn.innerHTML = '<svg width="68" height="48" viewBox="0 0 68 48"><path d="M66.52 7.74c-.78-2.93-2.49-5.41-5.42-6.19C55.79.13 34 0 34 0S12.21.13 6.9 1.55c-2.93.78-4.63 3.26-5.42 6.19C.06 13.05 0 24 0 24s.06 10.95 1.48 16.26c.78 2.93 2.49 5.41 5.42 6.19C12.21 47.87 34 48 34 48s21.79-.13 27.1-1.55c2.93-.78 4.63-3.26 5.42-6.19C67.94 34.95 68 24 68 24s-.06-10.95-1.48-16.26z" fill="#f00"/><path d="M45 24L27 14v20" fill="#fff"/></svg>';
        container.appendChild(btn);

        container.addEventListener('click', function handler() {
            container.removeEventListener('click', handler);
            container.classList.remove('yt-lazy-thumb');
            container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:#aaa;">Loading...</div>';
            loadAPI(function () {
                createPlayer(container, videoId, true);
            });
        }, { once: true });
    }

    window.SwaramYT = {
        init: function (id, videoId, options) {
            if (!videoId) return;
            containerId = id;
            options = options || {};
            stateCallbacks = [];
            if (options.onStateChange) stateCallbacks.push(options.onStateChange);

            var container = document.getElementById(id);
            if (!container) return;

            if (options.noThumbnail) {
                loadAPI(function () { createPlayer(container, videoId, false); });
            } else {
                renderThumbnail(container, videoId);
            }
        },

        seekTo: function (time) {
            if (player && typeof player.seekTo === 'function') {
                player.seekTo(time, true);
            }
        },

        getCurrentTime: function () {
            if (player && typeof player.getCurrentTime === 'function') {
                return player.getCurrentTime();
            }
            return 0;
        },

        onStateChange: function (cb) {
            if (cb) stateCallbacks.push(cb);
        },

        isReady: function () {
            return player && typeof player.getCurrentTime === 'function';
        },

        destroy: function () {
            if (player && typeof player.destroy === 'function') {
                player.destroy();
            }
            player = null;
            stateCallbacks = [];
        }
    };
})();
