/**
 * Google Search Console URL Inspection — Check Index Status
 * Checks which sitemap URLs are indexed by Google.
 * Uses only Node.js built-ins (no npm dependencies).
 *
 * Prerequisites: Same as submit-google-indexing.js
 *   - google-indexing-key.json with service account
 *   - Service account as Owner in Google Search Console
 *
 * Usage: node check-google-index.js              (smart schedule: new + stale by tier)
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
const SITE_URL = 'https://swaram-app.netlify.app/';
const PRIORITY_PATH = path.join(__dirname, 'url-priority.json');
const RECHECK_PATH = path.join(__dirname, 'recheck-next-run.json');

// Re-check intervals (days) for not-indexed URLs by category
const RECHECK_TIERS = [
  { name: 'static-tools',     interval: 3,  match: url => /\/(chord-finder|chord-identifier|chord-progressions|songs|request|privacy-policy)\.html$/.test(url) || url === SITE_URL },
  { name: 'progression-keys', interval: 3,  match: url => url.includes('/chord-progressions/key-of-') },
  { name: 'category-artist',  interval: 5,  match: url => url.includes('/category/') || url.includes('/artist/') },
  { name: 'songs-lyrics',     interval: 5,  match: url => url.includes('/songs/') || url.includes('/lyrics/') },
];
const CHORD_DEMAND_INTERVAL = 7;
const CHORD_NO_DEMAND_INTERVAL = 14;

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

// ── Smart Scheduling ──

function loadUrlPriority() {
  if (!fs.existsSync(PRIORITY_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(PRIORITY_PATH, 'utf-8')); } catch { return {}; }
}

function classifyUrl(url, urlPriority) {
  for (const tier of RECHECK_TIERS) {
    if (tier.match(url)) return { tierName: tier.name, intervalDays: tier.interval };
  }
  if (url.includes('/chords/')) {
    const score = urlPriority[url]?.score || 0;
    return score > 0
      ? { tierName: 'chord-with-demand', intervalDays: CHORD_DEMAND_INTERVAL }
      : { tierName: 'chord-no-demand', intervalDays: CHORD_NO_DEMAND_INTERVAL };
  }
  return { tierName: 'other', intervalDays: CHORD_NO_DEMAND_INTERVAL };
}

function isStale(checkedAt, intervalDays) {
  if (!checkedAt) return true;
  return (Date.now() - new Date(checkedAt).getTime()) >= intervalDays * 86400000;
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

  // Default: smart scheduling — new URLs always, not-indexed re-checked by tier
  // --new: only check URLs never checked before
  // --force: re-check everything including indexed ones
  const force = process.argv.includes('--force');
  const newOnly = process.argv.includes('--new');

  let toCheck;
  let scheduleSummary = null;

  let recheckUrls = [];
  if (fs.existsSync(RECHECK_PATH)) {
    try { recheckUrls = JSON.parse(fs.readFileSync(RECHECK_PATH, 'utf-8')); } catch {}
  }
  const recheckSet = new Set(recheckUrls);

  if (force) {
    toCheck = allUrls;
  } else if (newOnly) {
    toCheck = allUrls.filter(u => !results[u]);
  } else {
    const urlPriority = loadUrlPriority();
    const buckets = { recheck: [], new: [], 'static-tools': [], 'progression-keys': [], 'category-artist': [], 'songs-lyrics': [], 'chord-with-demand': [], 'chord-no-demand': [], other: [] };
    let skippedIndexed = 0, skippedFresh = 0;

    for (const url of allUrls) {
      const entry = results[url];
      if (!entry) {
        buckets.new.push(url);
      } else if (entry.verdict === 'PASS') {
        skippedIndexed++;
      } else {
        if (recheckSet.has(url)) {
          buckets.recheck.push(url);
        } else {
          const { tierName, intervalDays } = classifyUrl(url, urlPriority);
          if (isStale(entry.checkedAt, intervalDays)) {
            buckets[tierName].push(url);
          } else {
            skippedFresh++;
          }
        }
      }
    }

    toCheck = [
      ...buckets.recheck,
      ...buckets.new,
      ...buckets['static-tools'],
      ...buckets['progression-keys'],
      ...buckets['category-artist'],
      ...buckets['songs-lyrics'],
      ...buckets['chord-with-demand'],
      ...buckets['chord-no-demand'],
      ...buckets.other,
    ];
    scheduleSummary = { buckets, skippedIndexed, skippedFresh };
  }

  console.log('Total URLs in sitemap: ' + allUrls.length);
  console.log('Already checked:       ' + Object.keys(results).length);

  if (scheduleSummary) {
    const { buckets, skippedIndexed, skippedFresh } = scheduleSummary;
    console.log('\n--- Smart Schedule Breakdown ---');
    if (buckets.recheck.length)               console.log('  Recheck (submitted yesterday): ' + buckets.recheck.length);
    if (buckets.new.length)                  console.log('  New (never checked):      ' + buckets.new.length);
    if (buckets['static-tools'].length)      console.log('  Stale static-tools:       ' + buckets['static-tools'].length + '  (every 3d)');
    if (buckets['progression-keys'].length)  console.log('  Stale progression-keys:   ' + buckets['progression-keys'].length + '  (every 3d)');
    if (buckets['category-artist'].length)   console.log('  Stale category-artist:    ' + buckets['category-artist'].length + '  (every 5d)');
    if (buckets['songs-lyrics'].length)      console.log('  Stale songs-lyrics:       ' + buckets['songs-lyrics'].length + '  (every 5d)');
    if (buckets['chord-with-demand'].length) console.log('  Stale chord-with-demand:  ' + buckets['chord-with-demand'].length + '  (every 7d)');
    if (buckets['chord-no-demand'].length)   console.log('  Stale chord-no-demand:    ' + buckets['chord-no-demand'].length + '  (every 14d)');
    if (buckets.other.length)                console.log('  Stale other:              ' + buckets.other.length + '  (every 14d)');
    console.log('  ─────────────────────────');
    console.log('  To check this run:        ' + toCheck.length);
    console.log('  Skipped (already indexed): ' + skippedIndexed);
    console.log('  Skipped (checked recently): ' + skippedFresh);
    console.log('  Est. runtime:             ~' + Math.max(1, Math.ceil(toCheck.length * 7.5 / 60)) + ' min');
  } else {
    console.log('To check:              ' + toCheck.length + (newOnly ? ' (--new: unchecked only)' : force ? ' (--force: all)' : ''));
  }

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

        const oldRecommendCount = results[url]?.recommendCount || 0;
        results[url] = { verdict, coverageState, lastCrawlTime, crawledAs, checkedAt: new Date().toISOString() };

        if (verdict !== 'PASS' && recheckSet.has(url)) {
          results[url].recommendCount = oldRecommendCount + 1;
          if (oldRecommendCount + 1 >= 2) {
            results[url].failedRecheck = new Date().toISOString();
          }
        } else if (verdict === 'PASS') {
          delete results[url].recommendCount;
          delete results[url].failedRecheck;
        }

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

  if (scheduleSummary) {
    const totalIndexed = Object.values(results).filter(v => v.verdict === 'PASS').length;
    const totalNotIndexed = Object.values(results).filter(v => v.verdict !== 'PASS').length;
    console.log('\n--- Overall Status ---');
    console.log('Indexed:        ' + totalIndexed);
    console.log('Not indexed:    ' + totalNotIndexed);
    console.log('Unchecked:      ' + (allUrls.length - Object.keys(results).length));
  }

  console.log('\nResults saved to index-status.json');
  console.log('Run with --not-indexed to see URLs needing manual submission.');
  console.log('Run with --summary for quick counts.');
}

main().catch(err => { console.error('Fatal error:', err.message); process.exit(1); });
