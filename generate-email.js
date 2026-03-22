const fs = require('fs');
const path = require('path');

const songId = process.argv[2];
const userName = process.argv[3] || '{{USER_NAME}}';

if (!songId) {
  console.log('Usage: node generate-email.js <song-id> [user-name]');
  console.log('Example: node generate-email.js kurishil-marichavane John');
  process.exit(1);
}

const indexPath = path.join(__dirname, 'songs', 'index.json');
const songs = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
const song = songs.find(s => s.id === songId);

if (!song) {
  console.error(`Song "${songId}" not found in songs/index.json`);
  console.log('Available songs:', songs.map(s => s.id).join(', '));
  process.exit(1);
}

const BASE_URL = 'https://ecoliving-tips.github.io';

const subject = `Your requested song "${song.title}" is now live on Swaram!`;

const body = `Hi ${userName},

Great news! The song you requested is now live on Swaram.

${song.title} — ${song.artist}
Key: ${song.key} | Time: ${song.time} | ${song.category}

View Chords: ${BASE_URL}/songs/${song.id}/
View Lyrics: ${BASE_URL}/lyrics/${song.id}/

Have another song in mind? Request anytime:
${BASE_URL}/request.html

Thank you for helping us grow our collection. God bless!

Warm regards,
Swaram
${BASE_URL}`;

console.log('SUBJECT:');
console.log(subject);
console.log('\nBODY:');
console.log(body);
