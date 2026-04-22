/**
 * IndexNow — Automated URL Submission Script
 * Submits all sitemap URLs to Bing, Yandex, Seznam, Naver via IndexNow protocol.
 * Uses only Node.js built-ins (no npm dependencies).
 *
 * IndexNow is supported by: Bing, Yandex, Seznam.cz, Naver, Yep
 * (DuckDuckGo uses Bing's index, so it benefits indirectly)
 *
 * Usage: node submit-indexnow.js            (submit new URLs)
 *        node submit-indexnow.js --reset     (clear progress and start over)
 *        node submit-indexnow.js --status    (show submission stats)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const SITEMAP_PATH = path.join(__dirname, 'sitemap.xml');
const PROGRESS_PATH = path.join(__dirname, 'indexnow-progress.json');
const HOST = 'ecoliving-tips.github.io';
const KEY = '06cd40f31a5c5966384e2e2709d24bcc';
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const BATCH_SIZE = 10000; // IndexNow allows up to 10,000 per request

// ── Helpers ──

function getUrlsFromSitemap() {
  const xml = fs.readFileSync(SITEMAP_PATH, 'utf-8');
  const urls = [];
  const regex = /<loc>(.*?)<\/loc>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

function loadProgress() {
  if (fs.existsSync(PROGRESS_PATH)) {
    return JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf-8'));
  }
  return { submitted: [], lastRun: null };
}

function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2));
}

// ── IndexNow API ──

function submitBatch(urls) {
  const body = JSON.stringify({
    host: HOST,
    key: KEY,
    keyLocation: KEY_LOCATION,
    urlList: urls,
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.indexnow.org',
      path: '/indexnow',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
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

// ── Main ──

async function main() {
  if (process.argv.includes('--reset')) {
    if (fs.existsSync(PROGRESS_PATH)) {
      fs.unlinkSync(PROGRESS_PATH);
      console.log('Progress reset. Starting fresh.\n');
    }
  }

  const allUrls = getUrlsFromSitemap();
  const progress = loadProgress();

  if (process.argv.includes('--status')) {
    console.log(`Total URLs in sitemap:  ${allUrls.length}`);
    console.log(`Already submitted:      ${progress.submitted.length}`);
    console.log(`Remaining:              ${allUrls.length - progress.submitted.length}`);
    console.log(`Last run:               ${progress.lastRun || 'never'}`);
    return;
  }

  const submittedSet = new Set(progress.submitted);
  const pending = allUrls.filter(u => !submittedSet.has(u));

  console.log(`Total URLs in sitemap: ${allUrls.length}`);
  console.log(`Already submitted:     ${progress.submitted.length}`);
  console.log(`Remaining:             ${pending.length}\n`);

  if (pending.length === 0) {
    console.log('All URLs have been submitted! Nothing to do.');
    console.log('Run with --reset to re-submit all URLs.');
    return;
  }

  const batch = pending.slice(0, BATCH_SIZE);
  console.log(`Submitting ${batch.length} URLs to IndexNow...\n`);

  try {
    const result = await submitBatch(batch);

    // IndexNow response codes:
    // 200 = OK (URLs submitted successfully)
    // 202 = Accepted (URLs will be processed later)
    // 400 = Bad request (invalid format)
    // 403 = Forbidden (key not valid for this host)
    // 422 = Unprocessable (URLs don't match host)
    // 429 = Too many requests

    if (result.statusCode === 200 || result.statusCode === 202) {
      console.log(`SUCCESS (HTTP ${result.statusCode}): ${batch.length} URLs submitted`);
      progress.submitted.push(...batch);
    } else {
      console.log(`FAILED (HTTP ${result.statusCode}): ${result.body}`);
      if (result.statusCode === 403) {
        console.log(`\nVerify that ${KEY_LOCATION} is accessible on your live site.`);
      }
      if (result.statusCode === 429) {
        console.log('\nRate limited. Try again later.');
      }
    }
  } catch (err) {
    console.log(`ERROR: ${err.message}`);
  }

  progress.lastRun = new Date().toISOString();
  saveProgress(progress);

  console.log(`\n--- Summary ---`);
  console.log(`Total done: ${progress.submitted.length}/${allUrls.length}`);

  if (progress.submitted.length < allUrls.length) {
    console.log(`Run again to submit remaining ${allUrls.length - progress.submitted.length} URLs.`);
  } else {
    console.log('All URLs submitted! Bing/Yandex should index within 24-48 hours.');
  }
}

main().catch(err => { console.error('Fatal error:', err.message); process.exit(1); });
