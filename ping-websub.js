/**
 * WebSub (PubSubHubbub) Ping — Notify Google of RSS Feed Update
 * Sends a push notification to Google's WebSub hub so it fetches
 * the feed immediately instead of waiting for the next crawl.
 *
 * No auth, no API key, no quota.
 * Google's hub returns 204 on success.
 *
 * Usage: node ping-websub.js
 */

const https = require('https');

const FEED_URL = 'https://ecoliving-tips.github.io/feed.xml';
const HUB_URL = 'pubsubhubbub.appspot.com';

const body = 'hub.mode=publish&hub.url=' + encodeURIComponent(FEED_URL);

const req = https.request({
    hostname: HUB_URL,
    path: '/',
    method: 'POST',
    headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
    },
}, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        if (res.statusCode === 204 || res.statusCode === 200) {
            console.log('SUCCESS — Google WebSub hub notified.');
            console.log('Google will fetch ' + FEED_URL + ' shortly.');
        } else {
            console.log('HTTP ' + res.statusCode + ': ' + (data || 'No response body'));
        }
    });
});

req.on('error', (err) => {
    console.error('Request failed:', err.message);
});

req.write(body);
req.end();
