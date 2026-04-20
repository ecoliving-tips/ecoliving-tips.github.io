/**
 * One-time backfill script — fetches YouTube metadata for existing
 * generated_chords rows that have video_id but no slug.
 *
 * Run: node backfill-slugs.js
 * Safe to re-run (skips rows that already have a slug).
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

function parseYouTubeTitle(videoTitle, channelName) {
    let title = videoTitle || '';
    const original = title;

    const noise = [
        /\s*[\(\[](?:official\s*(?:music\s*)?video|official\s*audio|lyric(?:s|al)?\s*video|audio|hd|hq|full\s*song|4k|remastered|visuali[sz]er|with\s*lyrics)[\)\]]/gi,
        /\s*\|\s*(?:official\s*(?:music\s*)?video|official\s*audio|lyric(?:s)?\s*video|audio|hd|hq|full\s*song)\s*$/gi,
        /\s*#\w+/g,
    ];
    for (const re of noise) title = title.replace(re, '');
    title = title.trim();

    const separators = [' - ', ' – ', ' — ', ' | '];
    for (const sep of separators) {
        const idx = title.indexOf(sep);
        if (idx > 0 && idx < title.length - sep.length) {
            const left = title.substring(0, idx).trim();
            const right = title.substring(idx + sep.length).trim();
            const chanLower = channelName.toLowerCase();
            if (right.toLowerCase().includes(chanLower) || chanLower.includes(right.toLowerCase())) {
                return { artist: right, title: left };
            }
            return { artist: left, title: right };
        }
    }

    return { artist: channelName || 'Unknown Artist', title: title || original };
}

function generateSlug(artist, title) {
    return `${artist} ${title}`
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

async function main() {
    // Fetch rows without slug
    const rows = await supabaseGet('generated_chords?select=video_id&slug=is.null&order=created_at.asc');
    console.log(`Found ${rows.length} rows without slug.\n`);

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
        const slug = generateSlug(parsed.artist, parsed.title);

        await supabaseUpdate(vid, {
            title: parsed.title,
            artist: parsed.artist,
            slug,
            youtube_title: meta.title,
        });

        updated++;
        console.log(`  OK ${vid} → ${slug}  (${parsed.artist} — ${parsed.title})`);

        // Small delay to be nice to YouTube oEmbed
        await new Promise(r => setTimeout(r, 200));
    }

    console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}, Failed: ${failed}`);
}

main().catch(err => { console.error(err); process.exit(1); });
