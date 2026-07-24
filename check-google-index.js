/**
 * Google Search Console URL Inspection - Incremental Checker
 *
 * Daily behavior:
 * 1) Iterate sitemap URLs one-by-one from a saved cursor.
 * 2) Skip URLs already resolved (indexed or crawled).
 * 3) Re-check unresolved URLs from yesterday first.
 * 4) Fill remaining slots from sitemap cursor order.
 * 5) Stop as soon as we collect 11 unresolved, not-crawled URLs.
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
const RESULTS_PATH = path.join(__dirname, 'index-status.json');
const EXCLUDED_PATH = path.join(__dirname, 'index-excluded.json');
const STATE_PATH = path.join(__dirname, 'index-check-state.json');
const RECHECK_PATH = path.join(__dirname, 'recheck-next-run.json');
const PENDING_PATH = path.join(__dirname, 'pending-index-check.json');
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

function loadServiceAccountKey() {
  if (!fs.existsSync(KEY_PATH)) {
    console.error('ERROR: google-indexing-key.json not found.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(KEY_PATH, 'utf-8'));
}

function getUrlsFromSitemap() {
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

  return urls;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isResolved(entry) {
  if (!entry) return false;
  if (entry.verdict === 'PASS') return true;
  const coverage = (entry.coverageState || '').toLowerCase();
  return coverage.includes('crawled');
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

function writePendingSummary(allUrls, excluded, batch, checkedThisRun, wrappedAround, cursor) {
  const results = loadJson(RESULTS_PATH, {});
  const candidates = batch.map((url) => {
    const entry = results[url] || {};
    return {
      url,
      coverageState: entry.coverageState || 'N/A',
      lastCrawlTime: entry.lastCrawlTime || 'never',
      verdict: entry.verdict || 'UNKNOWN',
    };
  });

  saveJson(PENDING_PATH, {
    generatedAt: new Date().toISOString(),
    totalInSitemap: allUrls.length,
    excludedCount: excluded.size,
    checkedThisRun,
    wrappedAround,
    nextCursorIndex: cursor,
    notIndexedCandidates: candidates,
  });
}

function printSummaryOnly() {
  const p = loadJson(PENDING_PATH, null);
  if (!p) {
    console.log('No pending-index-check.json found yet. Run without --summary first.');
    return;
  }

  const candidates = Array.isArray(p.notIndexedCandidates) ? p.notIndexedCandidates : [];
  console.log('Sitemap URLs:            ' + (p.totalInSitemap || 0));
  console.log('Excluded (resolved):     ' + (p.excludedCount || 0));
  console.log('Checked in last run:     ' + (p.checkedThisRun || 0));
  console.log('Need manual submission:  ' + candidates.length);

  if (candidates.length > 0) {
    console.log('\n--- Current 11 URLs to Submit ---');
    for (let i = 0; i < candidates.length; i++) {
      const entry = candidates[i];
      console.log((i + 1) + '. ' + entry.url);
      console.log('   Status: ' + (entry.coverageState || 'N/A') + ' | Last crawl: ' + (entry.lastCrawlTime || 'never'));
    }
  }
}

async function main() {
  if (process.argv.includes('--summary')) {
    printSummaryOnly();
    return;
  }

  const allUrls = getUrlsFromSitemap();
  if (allUrls.length === 0) {
    console.log('No URLs found in sitemap.xml');
    saveJson(RECHECK_PATH, []);
    saveJson(PENDING_PATH, {
      generatedAt: new Date().toISOString(),
      totalInSitemap: 0,
      excludedCount: 0,
      checkedThisRun: 0,
      wrappedAround: false,
      nextCursorIndex: 0,
      notIndexedCandidates: [],
    });
    return;
  }

  const results = loadJson(RESULTS_PATH, {});
  const excluded = new Set(loadJson(EXCLUDED_PATH, []));
  const unresolvedFromYesterday = uniqueUrls(loadJson(RECHECK_PATH, []));
  const state = loadJson(STATE_PATH, { nextIndex: 0 });

  let cursor = Number.isInteger(state.nextIndex) ? state.nextIndex : 0;
  if (cursor < 0 || cursor >= allUrls.length) cursor = 0;

  const serviceAccount = loadServiceAccountKey();
  console.log('Service account: ' + serviceAccount.client_email + '\n');

  console.log('Authenticating...');
  const tokenManager = new TokenManager(serviceAccount);
  await tokenManager.getToken();
  console.log('Authenticated.\n');

  console.log('Total URLs in sitemap:   ' + allUrls.length);
  console.log('Already excluded:        ' + excluded.size + ' (indexed or crawled)');
  console.log('Carry-over unresolved:   ' + unresolvedFromYesterday.length);
  console.log('Starting cursor index:   ' + cursor);
  console.log('Target unresolved URLs:  ' + DAILY_TARGET + '\n');

  const batch = [];
  const batchSet = new Set();
  let inspectedCount = 0;
  let errorCount = 0;
  let skippedExcluded = 0;
  let wrapped = false;
  let recheckedFromYesterday = 0;
  let checkedFromCursor = 0;
  let rateLimited = false;

  async function inspectAndRecord(url, sourceLabel) {
    inspectedCount++;

    try {
      const token = await tokenManager.getToken();
      const response = await inspectUrl(url, token);

      if (response.statusCode === 200) {
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
          console.log('[' + inspectedCount + '] SKIP  | ' + sourceLabel + ' | ' + entry.coverageState + ' | ' + url);
        } else if (!batchSet.has(url) && batch.length < DAILY_TARGET) {
          batch.push(url);
          batchSet.add(url);
          console.log('[' + inspectedCount + '] KEEP  | ' + sourceLabel + ' | ' + entry.coverageState + ' | ' + url);
        }
      } else if (response.statusCode === 429) {
        console.log('[' + inspectedCount + '] RATE LIMIT | saving progress and stopping.');
        errorCount++;
        rateLimited = true;
      } else {
        let message = response.body;
        try {
          message = JSON.parse(response.body).error?.message || message;
        } catch {
          // Keep raw message.
        }
        console.log('[' + inspectedCount + '] ERR (' + response.statusCode + ') | ' + sourceLabel + ' | ' + url + ' - ' + message);
        errorCount++;
      }
    } catch (error) {
      console.log('[' + inspectedCount + '] ERR | ' + sourceLabel + ' | ' + url + ' - ' + error.message);
      errorCount++;
    }

    saveJson(RESULTS_PATH, results);
    saveJson(EXCLUDED_PATH, Array.from(excluded));
  }

  // Phase 1: Re-check unresolved carry-over from yesterday, in order.
  for (const url of unresolvedFromYesterday) {
    if (batch.length >= DAILY_TARGET || rateLimited) break;
    if (excluded.has(url)) {
      skippedExcluded++;
      continue;
    }

    recheckedFromYesterday++;
    await inspectAndRecord(url, 'recheck');

    if (batch.length < DAILY_TARGET && !rateLimited) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  // Phase 2: Fill remaining slots by walking sitemap cursor one-by-one.
  let scannedFromCursor = 0;
  while (batch.length < DAILY_TARGET && checkedFromCursor < allUrls.length && !rateLimited) {
    const url = allUrls[cursor];
    cursor = (cursor + 1) % allUrls.length;
    if (cursor === 0) wrapped = true;

    if (excluded.has(url) || batchSet.has(url)) {
      skippedExcluded++;
      continue;
    }

    checkedFromCursor++;
    scannedFromCursor++;
    await inspectAndRecord(url, 'cursor');

    if (batch.length < DAILY_TARGET && checkedFromCursor < allUrls.length && !rateLimited) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  saveJson(RECHECK_PATH, batch);
  saveJson(STATE_PATH, {
    nextIndex: cursor,
    checkedAt: new Date().toISOString(),
    inspectedThisRun: inspectedCount,
    recheckedFromYesterday,
    checkedFromCursor,
    skippedExcludedThisRun: skippedExcluded,
    unresolvedCollected: batch.length,
    wrappedAround: wrapped,
  });

  writePendingSummary(allUrls, excluded, batch, inspectedCount, wrapped, cursor);

  console.log('\n--- Summary ---');
  console.log('Inspected this run:      ' + inspectedCount);
  console.log('Rechecked carry-over:    ' + recheckedFromYesterday);
  console.log('Checked from cursor:     ' + checkedFromCursor);
  console.log('Skipped (excluded):      ' + skippedExcluded);
  console.log('Unresolved collected:    ' + batch.length + '/' + DAILY_TARGET);
  console.log('Errors:                  ' + errorCount);
  console.log('Next cursor index:       ' + cursor);
  console.log('Total excluded:          ' + excluded.size);
  console.log('Saved batch file:        recheck-next-run.json');
  console.log('Saved summary file:      pending-index-check.json');
}

main().catch((error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
