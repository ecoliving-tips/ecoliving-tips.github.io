'use strict';

const fs = require('fs');
const path = require('path');

const mode = process.argv[2];
if (!['normal', 'emergency'].includes(mode)) {
    throw new Error('Usage: node scripts/set-adsense-mode.js normal|emergency');
}

const loaderPath = path.join(__dirname, '..', 'js', 'adsense-loader.js');
const loader = fs.readFileSync(loaderPath, 'utf8');
const marker = /const ADSENSE_MODE = '[^']*'; \/\/ BUILD: ADSENSE_EMERGENCY_MODE/;
if (!marker.test(loader)) {
    throw new Error('AdSense loader build marker is missing');
}

const configuredLoader = loader.replace(
    marker,
    `const ADSENSE_MODE = '${mode}'; // BUILD: ADSENSE_EMERGENCY_MODE`
);
fs.writeFileSync(loaderPath, configuredLoader);
console.log(`AdSense mode set to ${mode}`);