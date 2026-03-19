// Supabase Edge Function: generate-chords
// Proxies chord detection requests to Python microservice + caches results

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Python chord detection microservice URL (set via Supabase secrets)
const CHORD_SERVICE_URL = Deno.env.get('CHORD_SERVICE_URL') || 'http://localhost:8000';

interface ChordEntry {
  time: number;
  duration: number;
  chord: string;
}

interface ChordData {
  videoId: string;
  key: string;
  bpm: number;
  timeSignature: string;
  chords: ChordEntry[];
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();

    if (!url) {
      return new Response(
        JSON.stringify({ error: 'YouTube URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract video ID from URL
    const videoId = extractVideoId(url);
    if (!videoId) {
      return new Response(
        JSON.stringify({ error: 'Invalid YouTube URL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Check cache first
    const { data: cachedResult, error: cacheError } = await supabaseClient
      .from('generated_chords')
      .select('*')
      .eq('video_id', videoId)
      .single();

    if (cacheError && cacheError.code !== 'PGRST116') {
      console.error('Cache lookup error:', cacheError);
    }

    // If we have cached results, return them
    if (cachedResult) {
      return new Response(
        JSON.stringify({
          videoId: cachedResult.video_id,
          key: cachedResult.key,
          bpm: cachedResult.bpm,
          timeSignature: cachedResult.time_signature,
          chords: cachedResult.chords,
          cached: true
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Call Python chord detection microservice
    const chordData = await callChordService(url);

    // Cache the results
    const { error: insertError } = await supabaseClient
      .from('generated_chords')
      .insert({
        video_id: chordData.videoId,
        youtube_url: url,
        key: chordData.key,
        bpm: chordData.bpm,
        time_signature: chordData.timeSignature,
        chords: chordData.chords,
        generated_at: new Date().toISOString()
      });

    if (insertError) {
      console.error('Cache insert error:', insertError);
    }

    return new Response(
      JSON.stringify(chordData),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Function error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function extractVideoId(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^\?&\s]+)/);
  return match ? match[1] : null;
}

async function callChordService(url: string): Promise<ChordData> {
  const serviceUrl = `${CHORD_SERVICE_URL}/analyze`;

  const response = await fetch(serviceUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('Chord service error:', response.status, errorBody);
    throw new Error(
      `Chord detection failed (${response.status}): ${errorBody.slice(0, 200)}`
    );
  }

  return await response.json();
}
