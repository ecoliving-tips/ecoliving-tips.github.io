-- Supabase Database Setup Script
-- Run this in your Supabase SQL Editor to set up the database

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create songs table
CREATE TABLE IF NOT EXISTS songs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    title_english VARCHAR(255),
    category VARCHAR(100),
    youtube_video_id VARCHAR(50),
    youtube_playlist_id VARCHAR(100),
    description TEXT,
    chord_progression TEXT,
    notes TEXT,
    difficulty VARCHAR(50) DEFAULT 'Beginner',
    views INTEGER DEFAULT 0,
    is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create song_requests table
CREATE TABLE IF NOT EXISTS song_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    song_title VARCHAR(255),
    requester_name VARCHAR(100),
    requester_email VARCHAR(255),
    message TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    admin_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create comments table
CREATE TABLE IF NOT EXISTS comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    song_id UUID REFERENCES songs(id) ON DELETE CASCADE,
    visitor_name VARCHAR(100),
    comment TEXT,
    is_approved BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create settings table
CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE songs ENABLE ROW LEVEL SECURITY;
ALTER TABLE song_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Create policies for songs (public read, authenticated write)
-- Public can view published songs
CREATE POLICY "Public songs are viewable by everyone" 
    ON songs FOR SELECT 
    USING (is_published = true);

-- Allow authenticated users to insert songs (admin only in practice)
CREATE POLICY "Authenticated users can insert songs" 
    ON songs FOR INSERT 
    WITH CHECK (auth.role() = 'authenticated');

-- Allow authenticated users to update songs (admin only in practice)
CREATE POLICY "Authenticated users can update songs" 
    ON songs FOR UPDATE 
    USING (auth.role() = 'authenticated');

-- Create policies for song_requests (public insert, authenticated read)
-- Anyone can submit a song request
CREATE POLICY "Anyone can submit song requests" 
    ON song_requests FOR INSERT 
    WITH CHECK (true);

-- Authenticated users can view requests (admin only)
CREATE POLICY "Authenticated users can view song requests" 
    ON song_requests FOR SELECT 
    USING (auth.role() = 'authenticated');

-- Authenticated users can update request status (admin only)
CREATE POLICY "Authenticated users can update song requests" 
    ON song_requests FOR UPDATE 
    USING (auth.role() = 'authenticated');

-- Create policies for comments (public insert, authenticated read)
-- Anyone can submit comments
CREATE POLICY "Anyone can submit comments" 
    ON comments FOR INSERT 
    WITH CHECK (true);

-- Public can view approved comments
CREATE POLICY "Public can view approved comments" 
    ON comments FOR SELECT 
    USING (is_approved = true);

-- Authenticated users can moderate comments (admin only)
CREATE POLICY "Authenticated users can update comments" 
    ON comments FOR UPDATE 
    USING (auth.role() = 'authenticated');

-- Create policies for settings (public read, authenticated write)
-- Public can view settings
CREATE POLICY "Public can view settings" 
    ON settings FOR SELECT 
    USING (true);

-- Authenticated users can update settings (admin only)
CREATE POLICY "Authenticated users can update settings" 
    ON settings FOR UPDATE 
    USING (auth.role() = 'authenticated');

-- Authenticated users can insert settings (admin only)
CREATE POLICY "Authenticated users can insert settings" 
    ON settings FOR INSERT 
    WITH CHECK (auth.role() = 'authenticated');

-- Create function to increment views
CREATE OR REPLACE FUNCTION increment_song_views(song_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE songs
    SET views = views + 1
    WHERE id = song_id;
END;
$$ LANGUAGE plpgsql;

-- Insert sample songs
INSERT INTO songs (title, title_english, category, youtube_video_id, description, difficulty, views, is_published) VALUES
('Anna Pesaha Thirunalil', 'When He Was Born', 'essential-songs', 'CGfSjeFkL-0', 'Essential Syro Malabar Holy Mass song with complete keyboard arrangement, chords, and background music.', 'Beginner', 43000, true),
('Kaiyile Pithaveedu', 'In the Hands of the Father', 'essential-songs', NULL, 'Traditional Syro Malabar song with keyboard chords and background music arrangement.', 'Intermediate', 12000, true),
('Pranayagathi', 'Devotion', 'chord-progressions', NULL, 'Popular Syro Malabar devotional song with complete keyboard arrangement and chord charts.', 'Intermediate', 15000, true),
('Madhuram Yesuve', 'Sweet Jesus', 'essential-songs', NULL, 'Sweet Malayalam Christian song with keyboard tutorial, chords, and background music.', 'Beginner', 22000, true),
('Thantine Aaraadhikunnundo', 'Shall We Worship', 'essential-songs', NULL, 'Traditional Syro Malabar Holy Mass song with detailed keyboard tutorial and chord progressions.', 'Advanced', 6000, true),
('Ennennum Kannukalum', 'Always and Forever', 'liturgical-practice', NULL, 'Beautiful liturgical song for church services with step-by-step keyboard tutorial.', 'Beginner', 18000, true);

-- Insert site settings
INSERT INTO settings (key, value) VALUES
('site_title', 'Mindful Living & Devotional Music'),
('site_description', 'Learn Malayalam Christian devotional songs on keyboard'),
('upi_id', NULL),
('youtube_channel', '@almightyone8205')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_songs_category ON songs(category);
CREATE INDEX IF NOT EXISTS idx_songs_published ON songs(is_published);
CREATE INDEX IF NOT EXISTS idx_songs_views ON songs(views DESC);
CREATE INDEX IF NOT EXISTS idx_comments_song_id ON comments(song_id);
CREATE INDEX IF NOT EXISTS idx_comments_approved ON comments(is_approved);
CREATE INDEX IF NOT EXISTS idx_requests_status ON song_requests(status);
