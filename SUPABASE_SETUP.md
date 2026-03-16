# Supabase Database Setup

## Run this SQL in your Supabase Dashboard

Go to your Supabase dashboard:
1. Open your project: https://supabase.com/dashboard/project/jfnccekkhffonkjkmxyf
2. Click on "SQL Editor" in the left sidebar
3. Copy and paste the following SQL and run it:

```sql
-- Create table for song requests
CREATE TABLE IF NOT EXISTS song_requests (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    name TEXT NOT NULL,
    song_title TEXT NOT NULL,
    message TEXT,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS (Row Level Security)
ALTER TABLE song_requests ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert (for the request form)
CREATE POLICY "Allow public inserts" ON song_requests
    FOR INSERT TO anon
    WITH CHECK (true);

-- Allow anyone to select (for viewing requests - optional)
CREATE POLICY "Allow public selects" ON song_requests
    SELECT TO anon
    USING (true);

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

## After Running

1. Go to "Table Editor" in Supabase
2. You should see the `song_requests` table
3. When users submit song requests, they'll appear here

## Viewing Requests

You can view all song requests in your Supabase dashboard:
1. Go to Table Editor
2. Select song_requests table
3. You'll see all submitted requests with name, song title, message, and status
