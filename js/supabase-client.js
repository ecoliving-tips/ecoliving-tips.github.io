// Supabase Client Configuration
// Replace the values below with your actual Supabase project credentials

const supabaseUrl = 'YOUR_SUPABASE_PROJECT_URL';
const supabaseKey = 'YOUR_SUPABASE_ANON_KEY';

// Create and export the Supabase client
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;

// For browser-side usage, create a separate client
// This is used in the browser JavaScript files
/*
const supabaseBrowser = window.supabase.createClient(
  'YOUR_SUPABASE_PROJECT_URL',
  'YOUR_SUPABASE_ANON_KEY'
);
*/
