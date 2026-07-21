#!/usr/bin/env node
/**
 * Retention classifier for no-build SEO/AdSense workflow.
 *
 * Inputs:
 * - sitemap.xml (+ child sitemap files)
 * - index-status.json (optional)
 * - Optional GSC URL report CSV
 *
 * Output directory (default: retention-output):
 * - retention-report.json
 * - retention-report.md
 * - keep-strategic.txt
 * - keep-high-value.txt
 * - keep-monitor.txt
 * - noindex-candidates.txt
 * - prune-candidates.txt
 * - review-unknown.txt
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DEFAULTS = {
  sitemapPath: path.join(ROOT, 'sitemap.xml'),
  indexStatusPath: path.join(ROOT, 'index-status.json'),
  outputDir: path.join(ROOT, 'retention-output'),
  gscCsvPath: '',
  minGoodClicks: 3,
  minHighImpressions: 50,
  maxGoodPosition: 35,
  minMonitorImpressions: 5,
};

function parseArgs(argv) {
  const args = { ...DEFAULTS };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--gsc' && argv[i + 1]) {
      args.gscCsvPath = path.resolve(ROOT, argv[++i]);
      continue;
    }
    if (arg === '--out' && argv[i + 1]) {
      args.outputDir = path.resolve(ROOT, argv[++i]);
      continue;
    }
    if (arg === '--min-clicks' && argv[i + 1]) {
      args.minGoodClicks = Number(argv[++i]);
      continue;
    }
    if (arg === '--min-impressions' && argv[i + 1]) {
      args.minHighImpressions = Number(argv[++i]);
      continue;
    }
    if (arg === '--max-position' && argv[i + 1]) {
      args.maxGoodPosition = Number(argv[++i]);
      continue;
    }
    if (arg === '--min-monitor-impressions' && argv[i + 1]) {
      args.minMonitorImpressions = Number(argv[++i]);
      continue;
    }
  }
  return args;
}

function loadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function getUrlsFromSitemap(sitemapPath) {
  if (!fs.existsSync(sitemapPath)) {
    throw new Error('sitemap.xml not found at ' + sitemapPath);
  }

  const indexXml = fs.readFileSync(sitemapPath, 'utf-8');
  const urls = [];

  if (indexXml.includes('<sitemapindex')) {
    const locRegex = /<loc>(.*?)<\/loc>/g;
    let match;
    while ((match = locRegex.exec(indexXml)) !== null) {
      const locUrl = match[1];
      const filename = locUrl.split('/').pop();
      const childPath = path.join(path.dirname(sitemapPath), filename);
      if (!fs.existsSync(childPath)) continue;
      const childXml = fs.readFileSync(childPath, 'utf-8');
      const childRegex = /<loc>(.*?)<\/loc>/g;
      let childMatch;
      while ((childMatch = childRegex.exec(childXml)) !== null) {
        urls.push(childMatch[1]);
      }
    }
  } else {
    const regex = /<loc>(.*?)<\/loc>/g;
    let match;
    while ((match = regex.exec(indexXml)) !== null) {
      urls.push(match[1]);
    }
  }

  return Array.from(new Set(urls));
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function normalizeHeader(header) {
  return header.trim().toLowerCase().replace(/\s+/g, ' ');
}

function parseNumberSafe(value) {
  if (value == null) return 0;
  const cleaned = String(value).replace(/[%,$]/g, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseGscCsv(csvPath) {
  if (!csvPath || !fs.existsSync(csvPath)) return new Map();
  const lines = fs.readFileSync(csvPath, 'utf-8').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return new Map();

  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  const idxUrl = headers.findIndex((h) => h === 'page' || h === 'url');
  const idxClicks = headers.findIndex((h) => h === 'clicks');
  const idxImpr = headers.findIndex((h) => h === 'impressions');
  const idxCtr = headers.findIndex((h) => h === 'ctr');
  const idxPos = headers.findIndex((h) => h === 'position' || h === 'average position');

  if (idxUrl === -1) return new Map();

  const map = new Map();
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const url = (cols[idxUrl] || '').trim();
    if (!url) continue;
    map.set(normalizeUrl(url), {
      clicks: idxClicks === -1 ? 0 : parseNumberSafe(cols[idxClicks]),
      impressions: idxImpr === -1 ? 0 : parseNumberSafe(cols[idxImpr]),
      ctr: idxCtr === -1 ? 0 : parseNumberSafe(cols[idxCtr]),
      position: idxPos === -1 ? 0 : parseNumberSafe(cols[idxPos]),
    });
  }

  return map;
}

function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = '';
    u.search = '';
    return u.toString().replace(/\/$/, '') || u.toString();
  } catch {
    return raw.trim().replace(/\/$/, '');
  }
}

function getPathname(rawUrl) {
  try {
    return new URL(rawUrl).pathname || '/';
  } catch {
    return '/';
  }
}

function isResolved(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.verdict === 'PASS') return true;
  const coverage = String(entry.coverageState || '').toLowerCase();
  return coverage.includes('crawled') || coverage.includes('indexed');
}

function isFeaturePath(pathname) {
  const core = new Set([
    '/',
    '/index.html',
    '/chord-finder.html',
    '/chord-identifier.html',
    '/chord-progressions.html',
    '/songs.html',
    '/request.html',
    '/privacy-policy.html',
  ]);
  return core.has(pathname);
}

function isGeneratedPath(pathname) {
  return (
    pathname.startsWith('/chords/') ||
    pathname.startsWith('/lyrics/') ||
    pathname.startsWith('/songs/') ||
    pathname.startsWith('/artist/') ||
    pathname.startsWith('/category/') ||
    pathname.startsWith('/chord-progressions/')
  );
}

function extractSegments(pathname) {
  return pathname.split('/').filter(Boolean);
}

function hasLowQualitySlug(pathname) {
  const segments = extractSegments(pathname);
  if (segments.length === 0) return false;

  for (const seg of segments) {
    if (seg.length > 70) return true;
    const hyphenCount = (seg.match(/-/g) || []).length;
    if (hyphenCount > 8) return true;
    if (/^[_-]/.test(seg)) return true;
    if (/^[A-Za-z0-9_-]{11}$/.test(seg)) return true;
  }

  return false;
}

function classifyPage(input, thresholds) {
  const {
    pathname,
    impressions,
    clicks,
    position,
    indexed,
    hasIndexData,
    generated,
    strategic,
    lowQualitySlug,
  } = input;

  if (strategic) {
    return { bucket: 'KEEP_STRATEGIC', reason: 'Core feature/business page' };
  }

  if (clicks >= thresholds.minGoodClicks) {
    return { bucket: 'KEEP_HIGH_VALUE', reason: 'Clicks above threshold' };
  }

  if (impressions >= thresholds.minHighImpressions && position > 0 && position <= thresholds.maxGoodPosition) {
    return { bucket: 'KEEP_HIGH_VALUE', reason: 'Strong impressions with rank potential' };
  }

  if (impressions >= thresholds.minMonitorImpressions) {
    return { bucket: 'KEEP_MONITOR', reason: 'Early demand signal; keep and monitor' };
  }

  if (!hasIndexData) {
    return { bucket: 'REVIEW_UNKNOWN', reason: 'Missing index status data' };
  }

  if (!generated) {
    return { bucket: 'KEEP_MONITOR', reason: 'Non-generated page with low demand; monitor first' };
  }

  if (!indexed && impressions === 0 && lowQualitySlug) {
    return { bucket: 'PRUNE_CANDIDATE', reason: 'Generated + zero demand + not indexed + low-quality slug' };
  }

  if (!indexed && impressions === 0) {
    return { bucket: 'NOINDEX_CANDIDATE', reason: 'Generated + zero demand + not indexed' };
  }

  if (indexed && impressions === 0) {
    return { bucket: 'NOINDEX_CANDIDATE', reason: 'Generated + indexed but no demand' };
  }

  return { bucket: 'KEEP_MONITOR', reason: 'No strong keep/prune signal' };
}

function summarize(rows) {
  const counts = {};
  for (const row of rows) {
    counts[row.bucket] = (counts[row.bucket] || 0) + 1;
  }
  return counts;
}

function writeBucketList(outputDir, rows, bucket, fileName) {
  const lines = rows
    .filter((r) => r.bucket === bucket)
    .map((r) => r.url)
    .sort();
  fs.writeFileSync(path.join(outputDir, fileName), lines.join('\n') + (lines.length ? '\n' : ''));
}

function writeMarkdownReport(filePath, context, rows, counts) {
  const lines = [];
  lines.push('# Retention Classification Report');
  lines.push('');
  lines.push('Generated at: ' + new Date().toISOString());
  lines.push('Total URLs analyzed: ' + rows.length);
  lines.push('GSC CSV used: ' + (context.gscCsvPath || 'No'));
  lines.push('');
  lines.push('## Thresholds');
  lines.push('- minGoodClicks: ' + context.minGoodClicks);
  lines.push('- minHighImpressions: ' + context.minHighImpressions);
  lines.push('- maxGoodPosition: ' + context.maxGoodPosition);
  lines.push('- minMonitorImpressions: ' + context.minMonitorImpressions);
  lines.push('');
  lines.push('## Bucket Counts');
  for (const key of Object.keys(counts).sort()) {
    lines.push('- ' + key + ': ' + counts[key]);
  }
  lines.push('');
  lines.push('## Top Noindex Candidates');
  rows
    .filter((r) => r.bucket === 'NOINDEX_CANDIDATE')
    .slice(0, 100)
    .forEach((r) => {
      lines.push('- ' + r.url + '  (' + r.reason + ')');
    });
  lines.push('');
  lines.push('## Top Prune Candidates');
  rows
    .filter((r) => r.bucket === 'PRUNE_CANDIDATE')
    .slice(0, 100)
    .forEach((r) => {
      lines.push('- ' + r.url + '  (' + r.reason + ')');
    });

  fs.writeFileSync(filePath, lines.join('\n') + '\n');
}

function main() {
  const args = parseArgs(process.argv);
  const urls = getUrlsFromSitemap(args.sitemapPath);
  const statusMap = loadJson(args.indexStatusPath, {});
  const gscMap = parseGscCsv(args.gscCsvPath);

  const rows = [];
  for (const rawUrl of urls) {
    const url = normalizeUrl(rawUrl);
    const pathname = getPathname(rawUrl);
    const gsc = gscMap.get(url) || { clicks: 0, impressions: 0, ctr: 0, position: 0 };
    const indexEntry = statusMap[rawUrl] || statusMap[url] || null;
    const hasIndexData = !!indexEntry;
    const indexed = isResolved(indexEntry);
    const generated = isGeneratedPath(pathname);
    const strategic = isFeaturePath(pathname);
    const lowQualitySlug = hasLowQualitySlug(pathname);

    const classification = classifyPage(
      {
        pathname,
        impressions: gsc.impressions,
        clicks: gsc.clicks,
        position: gsc.position,
        indexed,
        hasIndexData,
        generated,
        strategic,
        lowQualitySlug,
      },
      args,
    );

    rows.push({
      url,
      pathname,
      clicks: gsc.clicks,
      impressions: gsc.impressions,
      ctr: gsc.ctr,
      position: gsc.position,
      indexed,
      hasIndexData,
      generated,
      strategic,
      lowQualitySlug,
      bucket: classification.bucket,
      reason: classification.reason,
    });
  }

  rows.sort((a, b) => {
    const p = b.impressions - a.impressions;
    if (p !== 0) return p;
    return b.clicks - a.clicks;
  });

  const counts = summarize(rows);
  ensureDir(args.outputDir);

  fs.writeFileSync(
    path.join(args.outputDir, 'retention-report.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        config: {
          gscCsvPath: args.gscCsvPath || '',
          minGoodClicks: args.minGoodClicks,
          minHighImpressions: args.minHighImpressions,
          maxGoodPosition: args.maxGoodPosition,
          minMonitorImpressions: args.minMonitorImpressions,
        },
        counts,
        rows,
      },
      null,
      2,
    ),
  );

  writeMarkdownReport(path.join(args.outputDir, 'retention-report.md'), args, rows, counts);
  writeBucketList(args.outputDir, rows, 'KEEP_STRATEGIC', 'keep-strategic.txt');
  writeBucketList(args.outputDir, rows, 'KEEP_HIGH_VALUE', 'keep-high-value.txt');
  writeBucketList(args.outputDir, rows, 'KEEP_MONITOR', 'keep-monitor.txt');
  writeBucketList(args.outputDir, rows, 'NOINDEX_CANDIDATE', 'noindex-candidates.txt');
  writeBucketList(args.outputDir, rows, 'PRUNE_CANDIDATE', 'prune-candidates.txt');
  writeBucketList(args.outputDir, rows, 'REVIEW_UNKNOWN', 'review-unknown.txt');

  console.log('Retention classification completed.');
  console.log('Total URLs analyzed:', rows.length);
  console.log('Output directory:', args.outputDir);
  Object.keys(counts)
    .sort()
    .forEach((k) => {
      console.log(k + ':', counts[k]);
    });
}

main();
