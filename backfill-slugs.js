/**
 * Backfill script — fetches YouTube metadata for existing
 * generated_chords rows and populates slug/title/artist fields.
 *
 * Run: node backfill-slugs.js          (only rows without slug)
 *      node backfill-slugs.js --force   (re-process ALL rows)
 * Safe to re-run.
 */

const SUPABASE_URL = 'https://jfnccekkhffonkjkmxyf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_KJA4VzMAjt2WVEEg0JKMfg_lDrABAZK';

async function supabaseGet(query) {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/${query}`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
    });
    if (!resp.ok) throw new Error(`Supabase GET failed: ${resp.status}`);
    return resp.json();
}

async function supabaseUpdate(videoId, data) {
    const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/generated_chords?video_id=eq.${videoId}`,
        {
            method: 'PATCH',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal',
            },
            body: JSON.stringify(data),
        }
    );
    if (!resp.ok) throw new Error(`Supabase PATCH failed: ${resp.status}`);
}

async function fetchYouTubeMetadata(videoId) {
    try {
        const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
        const resp = await fetch(url);
        if (!resp.ok) return null;
        return await resp.json();
    } catch {
        return null;
    }
}

/**
 * Clean a YouTube video title for use as page title.
 * Minimal cleanup only — strip noise like "(Official Video)", hashtags,
 * and pipe-separated tags. Keep the rest as YouTube provides it.
 * Artist is always the channel name (most reliable source).
 */
function parseYouTubeTitle(videoTitle, channelName) {
    let title = videoTitle || '';
    const original = title;

    const noise = [
        /\s*[\(\[](?:official\s*(?:music\s*)?video|official\s*audio|lyric(?:s|al)?\s*video|audio|hd|hq|full\s*song|4k|remastered|visuali[sz]er|with\s*lyrics)[\)\]]/gi,
        /\s*\|\s*(?:official\s*(?:music\s*)?video|official\s*audio|lyric(?:s)?\s*video|audio|hd|hq|full\s*song)\s*$/gi,
        /\s*#\w+/g,
    ];
    for (const re of noise) title = title.replace(re, '');

    // Strip pipe-separated tags
    const pipeIdx = title.indexOf(' | ');
    if (pipeIdx > 0) title = title.substring(0, pipeIdx);
    title = title.trim();

    // Channel name as artist — strip YouTube's " - Topic" auto-suffix
    const artist = (channelName || 'Unknown Artist').replace(/\s*-\s*Topic$/i, '');

    return { artist, title: title || original };
}

function generateSlug(title, artist, videoId) {
    const slugify = (s) => (s || '')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

    let slug = slugify(title);
    const artistSlug = slugify(artist);

    // Append artist if not already part of the title slug (prevents collisions)
    if (slug && artistSlug && !slug.includes(artistSlug)) {
        slug = slug + '-' + artistSlug;
    }

    return slug || videoId || 'unknown';
}

async function main() {
    const force = process.argv.includes('--force');
    // Fetch rows — either all rows or only those without slug
    const query = force
        ? 'generated_chords?select=video_id&order=created_at.asc'
        : 'generated_chords?select=video_id&slug=is.null&order=created_at.asc';
    const rows = await supabaseGet(query);
    console.log(`Found ${rows.length} rows${force ? ' (--force: re-processing all)' : ' without slug'}.\n`);

    let updated = 0, skipped = 0, failed = 0;

    for (const row of rows) {
        const vid = row.video_id;
        if (!vid || vid === 'upload') {
            skipped++;
            continue;
        }

        const meta = await fetchYouTubeMetadata(vid);
        if (!meta) {
            console.log(`  SKIP ${vid} — oEmbed failed (video deleted/private?)`);
            failed++;
            continue;
        }

        const parsed = parseYouTubeTitle(meta.title, meta.author_name);
        const slug = generateSlug(parsed.title, parsed.artist, vid);

        await supabaseUpdate(vid, {
            title: parsed.title,
            artist: parsed.artist,
            slug,
            youtube_title: meta.title,
        });

        updated++;
        console.log(`  OK ${vid} → ${slug}  (${parsed.title} by ${parsed.artist})`);

        // Small delay to be nice to YouTube oEmbed
        await new Promise(r => setTimeout(r, 200));
    }

    console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}, Failed: ${failed}`);
}

main().catch(err => { console.error(err); process.exit(1); });
