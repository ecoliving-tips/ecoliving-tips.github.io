/**
 * IndexNow URL Submission Script
 * Submits all sitemap URLs to search engines via the IndexNow protocol.
 * Uses only Node.js built-ins (no npm dependencies).
 *
 * Usage: node submit-indexnow.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const HOST = 'ecoliving-tips.github.io';
const KEY = '62e137d8c1c846e48a4d513948923f87';
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;

// Parse sitemap.xml to extract URLs
function getUrlsFromSitemap() {
  const sitemapPath = path.join(__dirname, 'sitemap.xml');
  const xml = fs.readFileSync(sitemapPath, 'utf-8');
  const urls = [];
  const regex = /<loc>(.*?)<\/loc>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

function submitToIndexNow(urls) {
  const body = JSON.stringify({
    host: HOST,
    key: KEY,
    keyLocation: KEY_LOCATION,
    urlList: urls
  });

  const options = {
    hostname: 'api.indexnow.org',
    port: 443,
    path: '/IndexNow',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body)
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body: data });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const urls = getUrlsFromSitemap();
  console.log(`Found ${urls.length} URLs in sitemap.xml:`);
  urls.forEach((url) => console.log(`  ${url}`));
  console.log();

  console.log('Submitting to IndexNow (api.indexnow.org)...');
  try {
    const result = await submitToIndexNow(urls);
    console.log(`Response: HTTP ${result.statusCode}`);
    if (result.body) console.log(`Body: ${result.body}`);

    if (result.statusCode === 200) {
      console.log('\nURLs submitted successfully!');
    } else if (result.statusCode === 202) {
      console.log('\nURLs accepted for processing.');
    } else {
      console.log(`\nUnexpected status. See https://www.indexnow.org/documentation for details.`);
    }
  } catch (err) {
    console.error('Submission failed:', err.message);
    process.exit(1);
  }
}

main();
