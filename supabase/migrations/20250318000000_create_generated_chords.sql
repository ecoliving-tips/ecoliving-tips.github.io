-- Create table for caching AI-generated chords
CREATE TABLE IF NOT EXISTS generated_chords (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    video_id TEXT NOT NULL UNIQUE,
    youtube_url TEXT NOT NULL,
    key TEXT,
    bpm INTEGER,
    time_signature TEXT,
    chords JSONB NOT NULL DEFAULT '[]',
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_generated_chords_video_id ON generated_chords(video_id);

-- Add RLS policies (allow public read, restrict write to service role)
ALTER TABLE generated_chords ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access" ON generated_chords
    FOR SELECT USING (true);

CREATE POLICY "Allow service role insert" ON generated_chords
    FOR INSERT WITH CHECK (true);

-- Add comment for documentation
COMMENT ON TABLE generated_chords IS 'Caches AI-generated chord progressions from YouTube videos';
