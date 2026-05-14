/**
 * Rank non-indexed URLs by search demand using Google Suggest.
 * Queries Google Autocomplete for "{song title} chords" — if Google
 * suggests it, people are actively searching for it.
 *
 * Results cached in url-priority.json (re-checks after 7 days).
 * Usage: node rank-unindexed.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const CHORDS_INDEX = path.join(__dirname, 'chords', 'index.json');
const INDEX_STATUS = path.join(__dirname, 'index-status.json');
const PRIORITY_FILE = path.join(__dirname, 'url-priority.json');
const BASE_URL = 'https://ecoliving-tips.github.io';
const CACHE_DAYS = 3;

function loadJSON(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanTitle(title) {
  return title
    .replace(/\(official\s*(music\s*)?video\)/gi, '')
    .replace(/\(lyric[s]?\s*video\)/gi, '')
    .replace(/\(audio\)/gi, '')
    .replace(/official\s*(music\s*)?video/gi, '')
    .replace(/lyric[s]?\s*video/gi, '')
    .replace(/\|.*$/g, '')
    .replace(/[-–—]\s*(official|audio|video|lyrics|hd|4k|remastered).*$/gi, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function fetchSuggestions(query) {
  return new Promise((resolve) => {
    const url = `https://suggestqueries.google.com/complete/search?q=${encodeURIComponent(query)}&client=firefox&hl=en`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed[1] || []);
        } catch {
          resolve([]);
        }
      });
    }).on('error', () => resolve([]));
  });
}

async function main() {
  const chordsIndex = loadJSON(CHORDS_INDEX);
  const indexStatus = loadJSON(INDEX_STATUS);

  if (!chordsIndex) {
    console.log('Missing chords/index.json — skipping ranking.');
    return;
  }
  if (!indexStatus) {
    console.log('Missing index-status.json — run check-google-index.js first.');
    return;
  }

  const titleMap = {};
  for (const entry of chordsIndex) {
    titleMap[entry.s] = { title: entry.t, artist: entry.a };
  }

  const nonIndexed = Object.entries(indexStatus)
    .filter(([url, info]) => info.verdict !== 'PASS' && url.includes('/chords/'))
    .map(([url]) => {
      const slug = url.replace(`${BASE_URL}/chords/`, '').replace(/\/$/, '');
      const meta = titleMap[slug];
      return { url, slug, title: meta?.title || slug, artist: meta?.artist || '' };
    });

  console.log(`Non-indexed chord URLs: ${nonIndexed.length}`);

  let priority = loadJSON(PRIORITY_FILE) || {};
  const now = new Date().toISOString();
  const staleDate = new Date(Date.now() - CACHE_DAYS * 86400000).toISOString();

  const toCheck = nonIndexed.filter(entry => {
    const cached = priority[entry.url];
    return !cached || cached.checkedAt < staleDate;
  });

  console.log(`To check (new/stale): ${toCheck.length}`);

  if (toCheck.length === 0) {
    console.log('All non-indexed URLs already ranked.');
    printTop(priority, nonIndexed);
    return;
  }

  let checked = 0;
  for (const entry of toCheck) {
    const cleaned = cleanTitle(entry.title);
    const query = cleaned + ' chords';
    const suggestions = await fetchSuggestions(query);

    const chordHits = suggestions.filter(s => s.toLowerCase().includes('chord'));
    const score = chordHits.length;

    priority[entry.url] = { score, query: cleaned, checkedAt: now };
    checked++;

    if (checked % 100 === 0) {
      console.log(`  Checked ${checked}/${toCheck.length}...`);
      fs.writeFileSync(PRIORITY_FILE, JSON.stringify(priority, null, 2));
    }

    await sleep(500);
  }

  fs.writeFileSync(PRIORITY_FILE, JSON.stringify(priority, null, 2));
  console.log(`\nRanked ${checked} URLs. Saved to url-priority.json`);
  printTop(priority, nonIndexed);
}

function printTop(priority, nonIndexed) {
  const ranked = nonIndexed
    .map(e => ({ ...e, score: priority[e.url]?.score || 0 }))
    .sort((a, b) => b.score - a.score);

  const withDemand = ranked.filter(r => r.score > 0);
  console.log(`\nURLs with search demand: ${withDemand.length} / ${ranked.length}`);
  console.log('\n--- Top 12 by Search Demand ---');
  ranked.slice(0, 12).forEach((entry, i) => {
    console.log(`${i + 1}. [score=${entry.score}] ${entry.title}`);
    console.log(`   ${entry.url}`);
  });
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
