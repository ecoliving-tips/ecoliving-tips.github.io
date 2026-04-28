/**
 * Google Indexing API — Automated URL Submission Script
 * Submits all sitemap URLs to Google via the Indexing API.
 * Uses only Node.js built-ins (no npm dependencies).
 *
 * Prerequisites:
 *   1. Enable "Web Search Indexing API" in Google Cloud Console
 *   2. Create a service account and download the JSON key
 *   3. Save the key as google-indexing-key.json in the project root
 *   4. Add the service account email as Owner in Google Search Console
 *
 * Usage: node submit-google-indexing.js
 *        node submit-google-indexing.js --reset   (clear progress and start over)
 */

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEY_PATH = path.join(__dirname, 'google-indexing-key.json');
const SITEMAP_PATH = path.join(__dirname, 'sitemap.xml');
const PROGRESS_PATH = path.join(__dirname, 'indexing-progress.json');
const DAILY_QUOTA = 200;

// ── Helpers ──

function loadServiceAccountKey() {
  if (!fs.existsSync(KEY_PATH)) {
    console.error('ERROR: google-indexing-key.json not found.');
    console.error('Download your service account JSON key from Google Cloud Console');
    console.error('and place it in the project root as google-indexing-key.json');
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

function loadProgress() {
  if (fs.existsSync(PROGRESS_PATH)) {
    return JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf-8'));
  }
  return { submitted: [], lastRun: null };
}

function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2));
}

// ── JWT Auth (RS256) ──

function createJWT(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/indexing',
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
          reject(new Error(`Token request failed (HTTP ${res.statusCode}): ${data}`));
          return;
        }
        const parsed = JSON.parse(data);
        resolve(parsed.access_token);
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Indexing API ──

function submitUrl(url, accessToken, type = 'URL_UPDATED') {
  const body = JSON.stringify({ url, type });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'indexing.googleapis.com',
      path: '/v3/urlNotifications:publish',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function tryParseError(body) {
  try {
    const parsed = JSON.parse(body);
    return parsed.error?.message || body;
  } catch {
    return body;
  }
}

function getNotificationMetadata(url, accessToken) {
  const encodedUrl = encodeURIComponent(url);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'indexing.googleapis.com',
      path: `/v3/urlNotifications/metadata?url=${encodedUrl}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body: data });
      });
    });
    req.on('error', reject);
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

  const serviceAccount = loadServiceAccountKey();
  console.log(`Service account: ${serviceAccount.client_email}\n`);

  // Get access token
  console.log('Authenticating...');
  const jwt = createJWT(serviceAccount);
  const accessToken = await getAccessToken(jwt);
  console.log('Authenticated successfully.\n');

  // --status mode: check notification metadata for submitted URLs
  if (process.argv.includes('--status')) {
    const progress = loadProgress();
    const urls = progress.submitted;
    const sample = process.argv.includes('--all') ? urls : urls.slice(0, 20);

    console.log(`Checking status for ${sample.length} of ${urls.length} submitted URLs...\n`);

    let updated = 0, notFound = 0, errors = 0;
    for (let i = 0; i < sample.length; i++) {
      try {
        const result = await getNotificationMetadata(sample[i], accessToken);
        if (result.statusCode === 200) {
          const meta = JSON.parse(result.body);
          const notifyTime = meta.latestUpdate?.notifyTime || meta.latestRemove?.notifyTime || 'N/A';
          const type = meta.latestUpdate ? 'URL_UPDATED' : meta.latestRemove ? 'URL_DELETED' : 'UNKNOWN';
          console.log(`[${i + 1}/${sample.length}] ${type} @ ${notifyTime}`);
          console.log(`  ${sample[i]}`);
          updated++;
        } else if (result.statusCode === 404) {
          console.log(`[${i + 1}/${sample.length}] NOT FOUND (Google has no record)`);
          console.log(`  ${sample[i]}`);
          notFound++;
        } else {
          const msg = tryParseError(result.body);
          console.log(`[${i + 1}/${sample.length}] ERROR (${result.statusCode}): ${msg}`);
          console.log(`  ${sample[i]}`);
          errors++;
          if (result.statusCode === 429) {
            console.log('\nQuota exceeded. Try again later.');
            break;
          }
        }
      } catch (err) {
        console.log(`[${i + 1}/${sample.length}] ERROR: ${err.message}`);
        errors++;
      }
      if (i < sample.length - 1) await sleep(500);
    }

    console.log(`\n--- Summary ---`);
    console.log(`Has notification: ${updated}, Not found: ${notFound}, Errors: ${errors}`);
    if (!process.argv.includes('--all') && urls.length > 20) {
      console.log(`\nShowing first 20 only. Use --status --all to check all ${urls.length}.`);
    }
    return;
  }

  // --remove-dead mode: notify Google about URLs that were submitted but no longer in sitemap
  if (process.argv.includes('--remove-dead')) {
    const allUrls = new Set(getUrlsFromSitemap());
    const progress = loadProgress();
    const deadUrls = progress.submitted.filter(u => !allUrls.has(u));

    console.log(`Previously submitted: ${progress.submitted.length}`);
    console.log(`Currently in sitemap: ${allUrls.size}`);
    console.log(`Dead URLs to remove:  ${deadUrls.length}\n`);

    if (deadUrls.length === 0) {
      console.log('No dead URLs found. Nothing to do.');
      return;
    }

    const batch = deadUrls.slice(0, DAILY_QUOTA);
    console.log(`Sending URL_DELETED for ${batch.length} URLs...\n`);

    let ok = 0, fail = 0;
    for (let i = 0; i < batch.length; i++) {
      try {
        const result = await submitUrl(batch[i], accessToken, 'URL_DELETED');
        if (result.statusCode === 200) {
          console.log(`[${i + 1}/${batch.length}] DELETED: ${batch[i]}`);
          ok++;
          // Remove from submitted list so it won't be re-submitted
          const idx = progress.submitted.indexOf(batch[i]);
          if (idx !== -1) progress.submitted.splice(idx, 1);
        } else {
          const msg = tryParseError(result.body);
          console.log(`[${i + 1}/${batch.length}] FAIL (${result.statusCode}): ${batch[i]} — ${msg}`);
          fail++;
          if (result.statusCode === 429) {
            console.log('\nDaily quota exceeded. Stopping early. Run again tomorrow.');
            break;
          }
        }
      } catch (err) {
        console.log(`[${i + 1}/${batch.length}] ERROR: ${batch[i]} — ${err.message}`);
        fail++;
      }
      progress.lastRun = new Date().toISOString();
      saveProgress(progress);
      if (i < batch.length - 1) await sleep(1000);
    }

    console.log(`\n--- Summary ---`);
    console.log(`Deleted: ${ok}, Failed: ${fail}`);
    if (deadUrls.length > batch.length) {
      console.log(`Run again tomorrow for remaining ${deadUrls.length - batch.length} URLs.`);
    }
    return;
  }

  // Default mode: submit new URLs from sitemap
  const allUrls = getUrlsFromSitemap();
  const progress = loadProgress();
  const submittedSet = new Set(progress.submitted);
  const pending = allUrls.filter(u => !submittedSet.has(u));

  console.log(`Total URLs in sitemap: ${allUrls.length}`);
  console.log(`Already submitted:     ${progress.submitted.length}`);
  console.log(`Remaining:             ${pending.length}`);
  console.log(`Daily quota:           ${DAILY_QUOTA}\n`);

  if (pending.length === 0) {
    console.log('All URLs have been submitted! Nothing to do.');
    console.log('Run with --reset to re-submit all URLs.');
    return;
  }

  const batch = pending.slice(0, DAILY_QUOTA);
  console.log(`Submitting ${batch.length} URLs this run...\n`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < batch.length; i++) {
    const url = batch[i];
    const idx = progress.submitted.length + i + 1;
    const total = allUrls.length;

    try {
      const result = await submitUrl(url, accessToken);
      if (result.statusCode === 200) {
        console.log(`[${idx}/${total}] OK: ${url}`);
        successCount++;
        progress.submitted.push(url);
      } else {
        const msg = tryParseError(result.body);
        console.log(`[${idx}/${total}] FAIL (${result.statusCode}): ${url} — ${msg}`);
        failCount++;
        if (result.statusCode === 429) {
          console.log('\nDaily quota exceeded. Stopping early. Run again tomorrow.');
          break;
        }
      }
    } catch (err) {
      console.log(`[${idx}/${total}] ERROR: ${url} — ${err.message}`);
      failCount++;
    }

    progress.lastRun = new Date().toISOString();
    saveProgress(progress);
    if (i < batch.length - 1) await sleep(1000);
  }

  console.log(`\n--- Summary ---`);
  console.log(`Submitted: ${successCount}`);
  console.log(`Failed:    ${failCount}`);
  console.log(`Total done: ${progress.submitted.length}/${allUrls.length}`);

  if (progress.submitted.length < allUrls.length) {
    const remaining = allUrls.length - progress.submitted.length;
    console.log(`\nRun again tomorrow to submit the remaining ${remaining} URLs.`);
  } else {
    console.log('\nAll URLs submitted! Check Google Search Console in a few hours.');
  }
}

main().catch(err => { console.error('Fatal error:', err.message); process.exit(1); });
