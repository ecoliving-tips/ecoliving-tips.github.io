/**
 * Google Search Console URL Inspection — Check Index Status
 * Checks which sitemap URLs are indexed by Google.
 * Uses only Node.js built-ins (no npm dependencies).
 *
 * Prerequisites: Same as submit-google-indexing.js
 *   - google-indexing-key.json with service account
 *   - Service account as Owner in Google Search Console
 *
 * Usage: node check-google-index.js              (check new + re-check not-indexed)
 *        node check-google-index.js --new         (only check never-checked URLs)
 *        node check-google-index.js --not-indexed (show only non-indexed)
 *        node check-google-index.js --summary     (counts only)
 *        node check-google-index.js --force       (re-check everything)
 *
 * Results saved to index-status.json (resumable — safe to re-run).
 * Quota: ~2000 requests/day for URL Inspection API.
 */

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEY_PATH = path.join(__dirname, 'google-indexing-key.json');
const SITEMAP_PATH = path.join(__dirname, 'sitemap.xml');
const RESULTS_PATH = path.join(__dirname, 'index-status.json');
const SITE_URL = 'https://ecoliving-tips.github.io/';

// ── Helpers ──

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
      if (fs.existsSync(filePath)) {
        const childXml = fs.readFileSync(filePath, 'utf-8');
        const urlRegex = /<loc>(.*?)<\/loc>/g;
        let urlMatch;
        while ((urlMatch = urlRegex.exec(childXml)) !== null) {
          urls.push(urlMatch[1]);
        }
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
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── JWT Auth ──

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
      res.on('data', (chunk) => { data += chunk; });
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

// ── URL Inspection API ──

function inspectUrl(url, accessToken) {
  const body = JSON.stringify({
    inspectionUrl: url,
    siteUrl: SITE_URL,
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'searchconsole.googleapis.com',
      path: '/v1/urlInspection/index:inspect',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + accessToken,
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

// ── Token Manager (auto-refresh before expiry) ──

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

// ── Main ──

async function main() {
  const serviceAccount = loadServiceAccountKey();
  console.log('Service account: ' + serviceAccount.client_email + '\n');

  console.log('Authenticating...');
  const tokenManager = new TokenManager(serviceAccount);
  await tokenManager.getToken();
  console.log('Authenticated.\n');

  // Load previous results if resuming
  let results = {};
  if (fs.existsSync(RESULTS_PATH)) {
    results = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf-8'));
  }

  const allUrls = getUrlsFromSitemap();

  // --summary mode: just show counts from saved results
  if (process.argv.includes('--summary')) {
    const entries = Object.entries(results);
    if (entries.length === 0) {
      console.log('No results yet. Run without --summary first.');
      return;
    }
    const indexed = entries.filter(([, v]) => v.verdict === 'PASS');
    const notIndexed = entries.filter(([, v]) => v.verdict !== 'PASS');
    console.log('Total checked:   ' + entries.length);
    console.log('Indexed:         ' + indexed.length);
    console.log('Not indexed:     ' + notIndexed.length);
    if (notIndexed.length > 0) {
      console.log('\n--- Not Indexed URLs (submit these manually in GSC) ---');
      for (const [url, info] of notIndexed) {
        console.log('  ' + (info.coverageState || 'N/A') + ' | ' + url);
      }
    }
    return;
  }

  // --not-indexed mode: show non-indexed from saved results
  if (process.argv.includes('--not-indexed')) {
    const entries = Object.entries(results);
    const notIndexed = entries.filter(([, v]) => v.verdict !== 'PASS');
    console.log('Not indexed: ' + notIndexed.length + ' of ' + entries.length + ' checked\n');
    for (const [url, info] of notIndexed) {
      console.log(url);
      console.log('  Status: ' + (info.coverageState || 'N/A') + ' | Last crawl: ' + (info.lastCrawlTime || 'never'));
    }
    if (entries.length < allUrls.length) {
      console.log('\n(' + (allUrls.length - entries.length) + ' URLs not yet checked - run without flags to check all)');
    }
    return;
  }

  // Default: re-check not-indexed + check new URLs
  // --new: only check URLs never checked before (skip all previously checked)
  // --force: re-check everything including indexed ones
  const force = process.argv.includes('--force');
  const newOnly = process.argv.includes('--new');
  const toCheck = force
    ? allUrls
    : newOnly
      ? allUrls.filter(u => !results[u])
      : allUrls.filter(u => !results[u] || results[u].verdict !== 'PASS');

  console.log('Total URLs in sitemap: ' + allUrls.length);
  console.log('Already checked:       ' + Object.keys(results).length);
  console.log('To check:              ' + toCheck.length + (newOnly ? ' (--new: unchecked only)' : ''));
  console.log('(Quota: ~2000/day for URL Inspection API)\n');

  if (toCheck.length === 0) {
    console.log('All URLs checked. Use --summary or --not-indexed to view results.');
    console.log('Use --force to re-check all. Use --new to check only unchecked URLs.');
    return;
  }

  let indexed = 0, notIndexed = 0, errors = 0;

  for (let i = 0; i < toCheck.length; i++) {
    const url = toCheck[i];
    try {
      const token = await tokenManager.getToken();
      const result = await inspectUrl(url, token);

      if (result.statusCode === 200) {
        const data = JSON.parse(result.body);
        const inspection = data.inspectionResult?.indexStatusResult || {};
        const verdict = inspection.verdict || 'UNKNOWN';
        const coverageState = inspection.coverageState || 'N/A';
        const lastCrawlTime = inspection.lastCrawlTime || null;
        const crawledAs = inspection.crawledAs || 'N/A';

        results[url] = { verdict, coverageState, lastCrawlTime, crawledAs, checkedAt: new Date().toISOString() };

        const icon = verdict === 'PASS' ? 'OK' : 'NO';
        console.log('[' + (i + 1) + '/' + toCheck.length + '] ' + icon + ' | ' + coverageState + ' | ' + url);

        if (verdict === 'PASS') indexed++;
        else notIndexed++;
      } else if (result.statusCode === 429) {
        console.log('\n[' + (i + 1) + '/' + toCheck.length + '] Rate limited. Saving progress and stopping.');
        errors++;
        break;
      } else {
        let msg = result.body;
        try { msg = JSON.parse(result.body).error?.message || msg; } catch {}
        console.log('[' + (i + 1) + '/' + toCheck.length + '] ERR (' + result.statusCode + ') | ' + url + ' - ' + msg);
        errors++;
      }
    } catch (err) {
      console.log('[' + (i + 1) + '/' + toCheck.length + '] ERR | ' + url + ' - ' + err.message);
      errors++;
    }

    // Save progress after each URL
    fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));

    // Small delay to avoid rate limits
    if (i < toCheck.length - 1) await sleep(1200);
  }

  console.log('\n--- Summary ---');
  console.log('Indexed:     ' + indexed);
  console.log('Not indexed: ' + notIndexed);
  console.log('Errors:      ' + errors);
  console.log('Total done:  ' + Object.keys(results).length + '/' + allUrls.length);
  console.log('\nResults saved to index-status.json');
  console.log('Run with --not-indexed to see URLs needing manual submission.');
  console.log('Run with --summary for quick counts.');
}

main().catch(err => { console.error('Fatal error:', err.message); process.exit(1); });
