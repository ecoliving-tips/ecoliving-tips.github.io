const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GENERATED_DIRS = new Set([
    'artist',
    'category',
    'chord-progressions',
    'chords',
    'lyrics',
    'songs',
]);
let updated = 0;
let slots = 0;

function collectHtmlFiles(directory) {
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (directory !== ROOT || GENERATED_DIRS.has(entry.name)) {
                files.push(...collectHtmlFiles(path.join(directory, entry.name)));
            }
        } else if (entry.isFile() && entry.name.endsWith('.html')) {
            files.push(path.join(directory, entry.name));
        }
    }
    return files;
}

function attribute(attributes, name) {
    const match = attributes.match(new RegExp(`${name}=["']([^"']+)["']`, 'i'));
    return match ? match[1] : '';
}

function placeholder(attributes, insAttributes) {
    const style = attribute(attributes, 'style');
    const layout = attribute(insAttributes, 'data-ad-layout');
    const format = attribute(insAttributes, 'data-ad-format');
    const layoutKey = attribute(insAttributes, 'data-ad-layout-key');
    const slot = attribute(insAttributes, 'data-ad-slot');
    if (!slot) return null;

    const data = [
        layout && ` data-swaram-ad-layout="${layout}"`,
        format && ` data-swaram-ad-format="${format}"`,
        layoutKey && ` data-swaram-ad-layout-key="${layoutKey}"`,
        ` data-swaram-ad-slot="${slot}"`,
    ].filter(Boolean).join('');
    return `<div class="ad-container"${data}${style ? ` style="${style}"` : ''}></div>`;
}

function replaceStandardSlot(match, containerAttributes, insAttributes) {
    const result = placeholder(containerAttributes, insAttributes);
    if (!result) return match;
    slots++;
    return result;
}

function replaceHomepageSlot(match, containerAttributes, insAttributes) {
    const result = placeholder(containerAttributes, insAttributes);
    if (!result) return match;
    slots++;
    return result.replace('class="ad-container"', 'class="recently-added-card"');
}

for (const filePath of collectHtmlFiles(ROOT)) {
    const original = fs.readFileSync(filePath, 'utf8');
    let content = original;
    content = content.replace(
        /<div\s+class="ad-container"([^>]*)>\s*<ins\s+class="adsbygoogle"([^>]*)><\/ins>\s*<script>[\s\S]*?<\/script>\s*<\/div>/gi,
        replaceStandardSlot
    );
    content = content.replace(
        /<div\s+class="recently-added-card"([^>]*)>\s*<ins\s+class="adsbygoogle"([^>]*)><\/ins>\s*<script>[\s\S]*?<\/script>\s*<\/div>/gi,
        replaceHomepageSlot
    );
    if (content !== original) {
        fs.writeFileSync(filePath, content);
        updated++;
    }
}

console.log(`Updated ${updated} HTML page(s) and ${slots} AdSense slot(s).`);
