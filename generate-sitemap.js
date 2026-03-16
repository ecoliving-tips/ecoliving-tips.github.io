/**
 * Swaram - Auto Sitemap Generator
 *
 * Reads songs/index.json and generates sitemap.xml with all song pages.
 * Run this after adding new songs:   node generate-sitemap.js
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://ecoliving-tips.github.io';
const today = new Date().toISOString().split('T')[0];

// Static pages
const staticPages = [
    { loc: '/', changefreq: 'weekly', priority: '1.0' },
    { loc: '/songs.html', changefreq: 'weekly', priority: '0.9' },
    { loc: '/request.html', changefreq: 'monthly', priority: '0.7' },
    { loc: '/privacy-policy.html', changefreq: 'yearly', priority: '0.3' },
];

// Read songs index
const indexPath = path.join(__dirname, 'songs', 'index.json');
const songs = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));

// Build XML
let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

// Add static pages
for (const page of staticPages) {
    xml += `  <url>\n`;
    xml += `    <loc>${BASE_URL}${page.loc}</loc>\n`;
    xml += `    <lastmod>${today}</lastmod>\n`;
    xml += `    <changefreq>${page.changefreq}</changefreq>\n`;
    xml += `    <priority>${page.priority}</priority>\n`;
    xml += `  </url>\n\n`;
}

// Add each song as its own page
for (const song of songs) {
    xml += `  <url>\n`;
    xml += `    <loc>${BASE_URL}/song.html?file=${song.file}</loc>\n`;
    xml += `    <lastmod>${today}</lastmod>\n`;
    xml += `    <changefreq>monthly</changefreq>\n`;
    xml += `    <priority>0.8</priority>\n`;
    xml += `  </url>\n\n`;
}

xml += '</urlset>\n';

// Write sitemap
const sitemapPath = path.join(__dirname, 'sitemap.xml');
fs.writeFileSync(sitemapPath, xml);

console.log(`Sitemap generated with ${staticPages.length + songs.length} URLs (${songs.length} songs)`);
