'use strict';

const fs = require('fs');
const path = require('path');
const {
    cleanMetadataText,
    formatChordPageDescription,
    formatChordPageSummary,
    formatChordPageTitle,
} = require('../build');

const ROOT = path.resolve(__dirname, '..');
const BASE_URL = 'https://ecoliving-tips.github.io';
const META_TITLE_MAX_LENGTH = 65;
const META_DESCRIPTION_MAX_LENGTH = 160;
const LOW_CHORD_EVENT_THRESHOLD = 2;
const strictMetadata = process.argv.includes('--strict');
const jsonOutput = process.argv.includes('--json');
const requestedSlugArgument = process.argv.find(argument => argument.startsWith('--slug='));
const requestedSlug = requestedSlugArgument ? requestedSlugArgument.slice('--slug='.length) : '';

function decodeHtml(value) {
    return value
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)));
}

function stripTags(value) {
    return decodeHtml(value.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

function getTags(html, tagName) {
    return html.match(new RegExp(`<${tagName}\\b[^>]*>`, 'gi')) || [];
}

function getAttribute(tag, name) {
    const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
    return match ? decodeHtml(match[1]) : '';
}

function getMetaValues(html, attribute, value) {
    return getTags(html, 'meta')
        .filter(tag => getAttribute(tag, attribute).toLowerCase() === value.toLowerCase())
        .map(tag => getAttribute(tag, 'content'));
}

function getClassText(html, tagName, className) {
    const matches = [...html.matchAll(new RegExp(
        `<${tagName}\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/${tagName}>`,
        'gi'
    ))];
    return matches.map(match => stripTags(match[1]));
}

function hasType(value, expectedType) {
    const types = Array.isArray(value?.['@type']) ? value['@type'] : [value?.['@type']];
    return types.includes(expectedType);
}

function addIssue(report, level, slug, message) {
    report[level].push({ slug, message });
}

function addMetadataIssue(report, slug, message) {
    addIssue(report, strictMetadata ? 'errors' : 'warnings', slug, message);
}

function addDuplicateGroups(report, values, propertyName) {
    const duplicateGroups = [...values.entries()]
        .filter(([, slugs]) => slugs.length > 1)
        .map(([value, slugs]) => ({ value, slugs }))
        .sort((left, right) => right.slugs.length - left.slugs.length || left.value.localeCompare(right.value));

    report[propertyName] = duplicateGroups.slice(0, 20);
    if (duplicateGroups.length > 0) {
        report.warnings.push({
            slug: '*',
            message: `${duplicateGroups.length} duplicate ${propertyName === 'duplicateTitles' ? 'title' : 'description'} group(s) found`,
        });
    }
}

const indexPath = path.join(ROOT, 'chords', 'index.json');
if (!fs.existsSync(indexPath)) {
    console.error(`Missing generated chord index: ${indexPath}`);
    process.exit(1);
}

let entries;
try {
    entries = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
} catch (error) {
    console.error(`Unable to parse ${indexPath}: ${error.message}`);
    process.exit(1);
}

if (!Array.isArray(entries)) {
    console.error(`${indexPath} must contain an array`);
    process.exit(1);
}

if (requestedSlug && !entries.some(entry => entry.s === requestedSlug)) {
    console.error(`Chord slug not found in ${indexPath}: ${requestedSlug}`);
    process.exit(1);
}

const entriesToCheck = requestedSlug ? entries.filter(entry => entry.s === requestedSlug) : entries;

const report = {
    strictMetadata,
    indexedEntries: entriesToCheck.length,
    checkedPages: 0,
    errors: [],
    warnings: [],
    lowChordEventPages: [],
    pagesWithoutVideoMetadata: [],
    duplicateTitles: [],
    duplicateDescriptions: [],
};
const seenSlugs = new Set();
const titleValues = new Map();
const descriptionMap = new Map();

for (const entry of entriesToCheck) {
    const slug = typeof entry.s === 'string' ? entry.s : '';
    const sourceTitle = typeof entry.t === 'string' ? entry.t : '';
    const sourceArtist = typeof entry.a === 'string' ? entry.a : '';
    const expectedTitle = formatChordPageTitle(sourceTitle, sourceArtist);
    const expectedDescription = formatChordPageDescription(sourceTitle, sourceArtist);
    const cleanedSourceTitle = cleanMetadataText(sourceTitle, '');
    const cleanedSourceArtist = cleanMetadataText(sourceArtist, '');

    if (!slug) {
        addIssue(report, 'errors', '(missing slug)', 'Source entry has no slug');
        continue;
    }
    if (seenSlugs.has(slug)) {
        addIssue(report, 'errors', slug, 'Duplicate slug in chords/index.json');
        continue;
    }
    seenSlugs.add(slug);

    if (!/^[a-z0-9_-]+$/i.test(slug)) {
        addIssue(report, 'errors', slug, 'Slug is not safe for a generated chord URL');
        continue;
    }

    const pagePath = path.join(ROOT, 'chords', slug, 'index.html');
    if (!fs.existsSync(pagePath)) {
        addIssue(report, 'errors', slug, 'Generated page is missing');
        continue;
    }

    const html = fs.readFileSync(pagePath, 'utf8');
    report.checkedPages++;

    if (!cleanedSourceTitle) addIssue(report, 'warnings', slug, 'Source entry has no song title');
    if (!cleanedSourceArtist) addIssue(report, 'warnings', slug, 'Source entry has no artist');
    if (/\{\{[A-Z0-9_]+\}\}/.test(html)) {
        addIssue(report, 'errors', slug, 'Unresolved template token found');
    }

    const titleMatches = [...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)];
    if (titleMatches.length !== 1) {
        addIssue(report, 'errors', slug, `Expected exactly one title element, found ${titleMatches.length}`);
    } else {
        const pageTitle = stripTags(titleMatches[0][1]);
        titleValues.set(pageTitle, [...(titleValues.get(pageTitle) || []), slug]);
        if (pageTitle.length > META_TITLE_MAX_LENGTH) {
            addIssue(report, 'errors', slug, `Title is ${pageTitle.length} characters; maximum is ${META_TITLE_MAX_LENGTH}`);
        }
        if (pageTitle !== expectedTitle) {
            addMetadataIssue(report, slug, 'Title does not match the generated song-and-artist metadata formatter');
        }
    }

    const descriptionMetaValues = getMetaValues(html, 'name', 'description');
    if (descriptionMetaValues.length !== 1) {
        addIssue(report, 'errors', slug, `Expected exactly one description meta tag, found ${descriptionMetaValues.length}`);
    } else {
        const pageDescription = descriptionMetaValues[0].trim();
        descriptionMap.set(pageDescription, [...(descriptionMap.get(pageDescription) || []), slug]);
        if (pageDescription.length === 0) addIssue(report, 'errors', slug, 'Description is empty');
        if (pageDescription.length > META_DESCRIPTION_MAX_LENGTH) {
            addIssue(report, 'errors', slug, `Description is ${pageDescription.length} characters; maximum is ${META_DESCRIPTION_MAX_LENGTH}`);
        }
        if (pageDescription !== expectedDescription) {
            addMetadataIssue(report, slug, 'Description does not match the generated song-and-artist metadata formatter');
        }
    }

    const expectedCanonical = `${BASE_URL}/chords/${slug}/`;
    const canonicalLinks = getTags(html, 'link').filter(tag =>
        getAttribute(tag, 'rel').toLowerCase().split(/\s+/).includes('canonical')
    );
    if (canonicalLinks.length !== 1) {
        addIssue(report, 'errors', slug, `Expected exactly one canonical link, found ${canonicalLinks.length}`);
    } else if (getAttribute(canonicalLinks[0], 'href') !== expectedCanonical) {
        addIssue(report, 'errors', slug, 'Canonical URL does not match the generated page URL');
    }

    const h1Values = getClassText(html, 'h1', 'chords-page-title');
    if (h1Values.length !== 1 || !h1Values[0]) {
        addIssue(report, 'errors', slug, 'Visible chord-page H1 is missing or duplicated');
    } else if (!h1Values[0].endsWith(' Chords')) {
        addIssue(report, 'errors', slug, 'Visible chord-page H1 does not identify chords');
    }

    const artistValues = getClassText(html, 'p', 'artist');
    if (artistValues.length !== 1 || !artistValues[0]) {
        addIssue(report, 'errors', slug, 'Visible artist is missing or duplicated');
    }

    const summaryValues = getClassText(html, 'p', 'chord-page-summary');
    if (summaryValues.length !== 1 || !summaryValues[0]) {
        addIssue(report, 'errors', slug, 'Generated chord-page summary is missing or duplicated');
    }

    const headMetadataPairs = [
        ['property', 'og:title', 'title'],
        ['property', 'og:description', 'description'],
        ['name', 'twitter:title', 'title'],
        ['name', 'twitter:description', 'description'],
    ];
    for (const [attribute, value, source] of headMetadataPairs) {
        const values = getMetaValues(html, attribute, value);
        if (values.length !== 1) {
            addIssue(report, 'errors', slug, `Expected exactly one ${value} meta tag, found ${values.length}`);
        } else {
            const titleMatches = [...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)];
            const expectedValue = source === 'title'
                ? (titleMatches.length === 1 ? stripTags(titleMatches[0][1]) : '')
                : (descriptionMetaValues.length === 1 ? descriptionMetaValues[0].trim() : '');
            if (values[0].trim() !== expectedValue) {
                addIssue(report, 'errors', slug, `${value} does not match the page ${source}`);
            }
        }
    }

    const jsonLdBlocks = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    const jsonLdObjects = [];
    if (jsonLdBlocks.length === 0) {
        addIssue(report, 'errors', slug, 'No JSON-LD structured data found');
    } else {
        for (const block of jsonLdBlocks) {
            try {
                jsonLdObjects.push(JSON.parse(block[1].trim()));
            } catch (error) {
                addIssue(report, 'errors', slug, `Invalid JSON-LD: ${error.message}`);
            }
        }
    }

    const composition = jsonLdObjects.find(value => hasType(value, 'MusicComposition'));
    if (!composition) {
        addIssue(report, 'errors', slug, 'MusicComposition JSON-LD is missing');
    } else {
        if (composition.url !== expectedCanonical) addIssue(report, 'errors', slug, 'MusicComposition URL does not match canonical');
        if (composition.name !== cleanMetadataText(sourceTitle, 'Unknown Song')) {
            addMetadataIssue(report, slug, 'MusicComposition name does not match cleaned source title');
        }
    }

    const breadcrumb = jsonLdObjects.find(value => hasType(value, 'BreadcrumbList'));
    if (!breadcrumb || !Array.isArray(breadcrumb.itemListElement)) {
        addIssue(report, 'errors', slug, 'BreadcrumbList JSON-LD is missing or malformed');
    } else {
        const lastItem = breadcrumb.itemListElement[breadcrumb.itemListElement.length - 1];
        if (!lastItem || lastItem.item !== expectedCanonical) {
            addIssue(report, 'errors', slug, 'BreadcrumbList does not end at the canonical URL');
        }
    }

    const hasYoutubePlayer = html.includes('id="youtube-player-container"');
    const videoObject = jsonLdObjects.find(value => hasType(value, 'VideoObject'));
    if (hasYoutubePlayer !== Boolean(videoObject)) {
        addIssue(report, 'errors', slug, 'YouTube player and VideoObject metadata are inconsistent');
    }
    if (!videoObject) report.pagesWithoutVideoMetadata.push(slug);

    const chordDataMatch = html.match(/window\.CHORD_DATA\s*=\s*(\[[\s\S]*?\]);\s*window\.YOUTUBE_VIDEO_ID/);
    if (!chordDataMatch) {
        addIssue(report, 'errors', slug, 'Chord event data is missing');
    } else {
        try {
            const chordEvents = JSON.parse(chordDataMatch[1]);
            if (!Array.isArray(chordEvents)) {
                addIssue(report, 'errors', slug, 'Chord event data is not an array');
            } else {
                if (chordEvents.length <= LOW_CHORD_EVENT_THRESHOLD) {
                    report.lowChordEventPages.push({ slug, count: chordEvents.length });
                    addIssue(report, 'warnings', slug, `Only ${chordEvents.length} chord event(s) detected`);
                }
                if (summaryValues.length === 1) {
                    const expectedSummary = formatChordPageSummary(sourceTitle, sourceArtist, chordEvents.length, hasYoutubePlayer);
                    if (summaryValues[0] !== expectedSummary) {
                        addMetadataIssue(report, slug, 'Generated chord-page summary does not match source data');
                    }
                }
            }
        } catch (error) {
            addIssue(report, 'errors', slug, `Invalid chord event data: ${error.message}`);
        }
    }
}

addDuplicateGroups(report, titleValues, 'duplicateTitles');
addDuplicateGroups(report, descriptionMap, 'duplicateDescriptions');

if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
} else {
    console.log(`Checked ${report.checkedPages}/${report.indexedEntries} generated chord pages.`);
    console.log(`Errors: ${report.errors.length}`);
    console.log(`Warnings: ${report.warnings.length}`);
    console.log(`Low chord-event pages: ${report.lowChordEventPages.length}`);
    console.log(`Pages without video metadata: ${report.pagesWithoutVideoMetadata.length}`);
    if (report.duplicateTitles.length > 0) console.log(`Duplicate title groups: ${report.duplicateTitles.length}`);
    if (report.duplicateDescriptions.length > 0) console.log(`Duplicate description groups: ${report.duplicateDescriptions.length}`);

    for (const issue of [...report.errors, ...report.warnings].slice(0, 20)) {
        console.log(`${report.errors.includes(issue) ? 'ERROR' : 'WARN'} ${issue.slug}: ${issue.message}`);
    }
    if (report.errors.length + report.warnings.length > 20) {
        console.log(`... ${report.errors.length + report.warnings.length - 20} additional issue(s) omitted; use --json for the full report.`);
    }
}

process.exitCode = report.errors.length > 0 ? 1 : 0;