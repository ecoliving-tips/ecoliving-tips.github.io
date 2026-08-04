/**
 * GSC Daily URL Selector (simple cursor + exclusion)
 *
 * Behavior:
 * 1) Walk sitemap URLs in strict order from saved cursor.
 * 2) Inspect each URL with GSC URL Inspection API.
 * 3) If URL is indexed/crawled, add it to exclusion and skip it.
 * 4) Collect next 11 unresolved URLs for manual submission.
 * 5) Save only cursor + exclusion updates.
 *
 * No recheck queue. No pending workflow.
 *
 * Usage:
 *   node check-google-index.js
 *   node check-google-index.js --summary
 */

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEY_PATH = path.join(__dirname, 'google-indexing-key.json');
const SITEMAP_PATH = path.join(__dirname, 'sitemap.xml');
const STATE_PATH = path.join(__dirname, 'index-check-state.json');
const EXCLUDED_PATH = path.join(__dirname, 'index-excluded.json');
const RESULTS_PATH = path.join(__dirname, 'index-status.json');
const SITE_URL = 'https://ecoliving-tips.github.io/';
const DAILY_TARGET = 11;
const REQUEST_DELAY_MS = 1200;

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadServiceAccountKey() {
  if (!fs.existsSync(KEY_PATH)) {
    throw new Error('google-indexing-key.json not found.');
  }
  return JSON.parse(fs.readFileSync(KEY_PATH, 'utf-8'));
}

function getUrlsFromSitemap() {
  if (!fs.existsSync(SITEMAP_PATH)) return [];

  const indexXml = fs.readFileSync(SITEMAP_PATH, 'utf-8');
  const urls = [];

  if (indexXml.includes('<sitemapindex')) {
    const locRegex = /<loc>(.*?)<\/loc>/g;
    let locMatch;
    while ((locMatch = locRegex.exec(indexXml)) !== null) {
      const filename = locMatch[1].split('/').pop();
      const filePath = path.join(__dirname, filename);
      if (!fs.existsSync(filePath)) continue;

      const childXml = fs.readFileSync(filePath, 'utf-8');
      const urlRegex = /<loc>(.*?)<\/loc>/g;
      let urlMatch;
      while ((urlMatch = urlRegex.exec(childXml)) !== null) {
        urls.push(urlMatch[1]);
      }
    }
  } else {
    const regex = /<loc>(.*?)<\/loc>/g;
    let match;
    while ((match = regex.exec(indexXml)) !== null) {
      urls.push(match[1]);
    }
  }

  return uniqueUrls(urls);
}

function uniqueUrls(urls) {
  const out = [];
  const seen = new Set();
  for (const url of urls) {
    if (typeof url !== 'string') continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

function isResolved(entry) {
  if (!entry) return false;
  if (entry.verdict === 'PASS') return true;
  const coverage = (entry.coverageState || '').toLowerCase();
  return coverage.includes('crawled');
}

function createJWT(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const encHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = encHeader + '.' + encPayload;

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = sign.sign(serviceAccount.private_key, 'base64url');
  return signingInput + '.' + signature;
}

function getAccessToken(jwt) {
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  }).toString();

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error('Token request failed (HTTP ' + res.statusCode + '): ' + data));
          return;
        }
        resolve(JSON.parse(data).access_token);
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function inspectUrl(url, accessToken) {
  const body = JSON.stringify({ inspectionUrl: url, siteUrl: SITE_URL });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'searchconsole.googleapis.com',
      path: '/v1/urlInspection/index:inspect',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + accessToken,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body: data });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

class TokenManager {
  constructor(serviceAccount) {
    this.serviceAccount = serviceAccount;
    this.accessToken = null;
    this.expiresAt = 0;
  }

  async getToken() {
    const now = Date.now();
    if (this.accessToken && now < this.expiresAt - 120000) {
      return this.accessToken;
    }
    const jwt = createJWT(this.serviceAccount);
    this.accessToken = await getAccessToken(jwt);
    this.expiresAt = now + 3600 * 1000;
    return this.accessToken;
  }
}

function normalizeCursor(cursor, total) {
  if (total <= 0) return 0;
  const n = Number.isInteger(cursor) ? cursor : Number.parseInt(cursor, 10);
  if (!Number.isFinite(n)) return 0;
  return ((n % total) + total) % total;
}

function printBatch(batch, startIndex, nextIndex, total, wrappedAround) {
  console.log('Total sitemap URLs:      ' + total);
  console.log('Start cursor index:      ' + startIndex);
  console.log('Next cursor index:       ' + nextIndex);
  console.log('Batch size:              ' + batch.length);
  console.log('Wrapped around:          ' + (wrappedAround ? 'yes' : 'no'));

  if (batch.length === 0) {
    console.log('\nNo URLs available in sitemap.');
    return;
  }

  console.log('\n--- 11 URLs for GSC Submission ---');
  for (let i = 0; i < batch.length; i++) {
    console.log((i + 1) + '. ' + batch[i]);
  }
}

function getPreviewBatch(allUrls, excluded, startIndex, size) {
  const batch = [];
  if (allUrls.length === 0 || size <= 0) {
    return { batch, nextIndex: 0, wrappedAround: false, scanned: 0 };
  }

  let cursor = startIndex;
  let scanned = 0;
  let wrappedAround = false;

  while (batch.length < size && scanned < allUrls.length) {
    const url = allUrls[cursor];
    cursor = (cursor + 1) % allUrls.length;
    if (cursor === 0) wrappedAround = true;
    scanned++;

    if (excluded.has(url)) {
      continue;
    }

    batch.push(url);
  }

  return { batch, nextIndex: cursor, wrappedAround, scanned };
}

function printSummaryBatch(batch, results) {
  if (batch.length === 0) {
    console.log('\nNo unresolved URLs found from current cursor.');
    return;
  }

  console.log('\n--- 11 URLs for GSC Submission (Preview) ---');
  for (let i = 0; i < batch.length; i++) {
    const url = batch[i];
    const entry = results[url] || {};
    const coverageState = entry.coverageState || 'N/A';
    const lastCrawlTime = entry.lastCrawlTime || 'never';
    console.log((i + 1) + '. ' + url);
    console.log('   Status: ' + coverageState + ' | Last crawl: ' + lastCrawlTime);
  }
}

async function main() {
  const summaryOnly = process.argv.includes('--summary');
  const allUrls = getUrlsFromSitemap();
  const excluded = new Set(loadJson(EXCLUDED_PATH, []));
  const results = loadJson(RESULTS_PATH, {});
  const state = loadJson(STATE_PATH, { nextIndex: 0 });
  const startIndex = normalizeCursor(state.nextIndex, allUrls.length || 1);

  if (allUrls.length === 0) {
    console.log('No URLs found in sitemap.xml');
    saveJson(STATE_PATH, {
      nextIndex: 0,
      updatedAt: new Date().toISOString(),
      totalUrls: 0,
      batchSize: 0,
    });
    return;
  }

  if (summaryOnly) {
    console.log('Summary mode does not call GSC API.');
    console.log('Current cursor index:    ' + startIndex);
    console.log('Excluded URLs:           ' + excluded.size);
    const preview = getPreviewBatch(allUrls, excluded, startIndex, DAILY_TARGET);
    console.log('Scanned for preview:     ' + preview.scanned);
    console.log('Preview next index:      ' + preview.nextIndex);
    console.log('Wrapped around:          ' + (preview.wrappedAround ? 'yes' : 'no'));
    printSummaryBatch(preview.batch, results);
    return;
  }

  const serviceAccount = loadServiceAccountKey();
  const tokenManager = new TokenManager(serviceAccount);
  await tokenManager.getToken();

  const batch = [];
  let cursor = startIndex;
  let scanned = 0;
  let wrappedAround = false;
  let resolvedAdded = 0;
  let skippedExcluded = 0;
  let errorCount = 0;

  while (batch.length < DAILY_TARGET && scanned < allUrls.length) {
    const url = allUrls[cursor];
    cursor = (cursor + 1) % allUrls.length;
    if (cursor === 0) wrappedAround = true;
    scanned++;

    if (excluded.has(url)) {
      skippedExcluded++;
      continue;
    }

    try {
      const token = await tokenManager.getToken();
      const response = await inspectUrl(url, token);

      if (response.statusCode !== 200) {
        let message = response.body;
        try {
          message = JSON.parse(response.body).error?.message || message;
        } catch {
          // Keep raw message.
        }
        console.log('ERR (' + response.statusCode + ') | ' + url + ' - ' + message);
        errorCount++;
        break;
      }

      const payload = JSON.parse(response.body);
      const inspection = payload.inspectionResult?.indexStatusResult || {};
      const entry = {
        verdict: inspection.verdict || 'UNKNOWN',
        coverageState: inspection.coverageState || 'N/A',
        lastCrawlTime: inspection.lastCrawlTime || null,
        crawledAs: inspection.crawledAs || 'N/A',
        checkedAt: new Date().toISOString(),
      };
      results[url] = entry;

      if (isResolved(entry)) {
        excluded.add(url);
        resolvedAdded++;
        console.log('SKIP  | resolved | ' + entry.coverageState + ' | ' + url);
      } else {
        batch.push(url);
        console.log('KEEP  | unresolved | ' + entry.coverageState + ' | ' + url);
      }

      saveJson(RESULTS_PATH, results);
      saveJson(EXCLUDED_PATH, Array.from(excluded));

      if (batch.length < DAILY_TARGET) {
        await sleep(REQUEST_DELAY_MS);
      }
    } catch (error) {
      console.log('ERR | ' + url + ' - ' + error.message);
      errorCount++;
      break;
    }
  }

  printBatch(batch, startIndex, cursor, allUrls.length, wrappedAround);

  saveJson(STATE_PATH, {
    nextIndex: cursor,
    updatedAt: new Date().toISOString(),
    totalUrls: allUrls.length,
    batchSize: batch.length,
    scannedThisRun: scanned,
    skippedExcluded,
    resolvedAddedToExclusion: resolvedAdded,
    errors: errorCount,
    wrappedAround,
  });

  console.log('\nSaved cursor state:      index-check-state.json');
  console.log('Updated exclusion file:  index-excluded.json');
}

main().catch((error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
