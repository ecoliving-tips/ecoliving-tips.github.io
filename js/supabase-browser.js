// Supabase Browser Client
// This file initializes the Supabase client for browser-side usage
// Used for song requests, comments, and dynamic data fetching

// Configuration - Load from environment variables injected at build time
const SUPABASE_URL = window.ENV?.SUPABASE_URL || null;
const SUPABASE_KEY = window.ENV?.SUPABASE_KEY || null;

// Check if credentials are configured
if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn('Supabase credentials not configured. Dynamic features will be disabled.');
}

// Initialize Supabase client (only if credentials are available)
const supabaseClient = SUPABASE_URL && SUPABASE_KEY 
    ? supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;

// Export for use in other scripts
window.supabaseClient = supabaseClient;

// Song Management Functions
const SongAPI = {
  /**
   * Fetch all published songs
   */
  async getSongs() {
    if (!supabaseClient) return [];
    const { data, error } = await supabaseClient
      .from('songs')
      .select('*')
      .eq('is_published', true)
      .order('title', { ascending: true });
    
    if (error) throw error;
    return data;
  },

  /**
   * Fetch a single song by ID
   */
  async getSong(id) {
    if (!supabaseClient) return null;
    const { data, error } = await supabaseClient
      .from('songs')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) throw error;
    return data;
  },

  /**
   * Fetch songs by category
   */
  async getSongsByCategory(category) {
    if (!supabaseClient) return [];
    const { data, error } = await supabaseClient
      .from('songs')
      .select('*')
      .eq('category', category)
      .eq('is_published', true)
      .order('title', { ascending: true });
    
    if (error) throw error;
    return data;
  },

  /**
   * Search songs by title (with input sanitization)
   */
  async searchSongs(query) {
    // Sanitize input to prevent SQL injection - escape LIKE special characters
    if (typeof query !== 'string' || !query) return [];
    
    const specialChars = /[%_]/g;
    const sanitizedQuery = query.replace(specialChars, '\\\\$&').trim();
    
    if (!sanitizedQuery) return [];
    
    const { data, error } = await supabaseClient
      .from('songs')
      .select('*')
      .eq('is_published', true)
      .or(`title.ilike.%${sanitizedQuery}%,title_english.ilike.%${sanitizedQuery}%`)
      .order('views', { ascending: false });
    
    if (error) throw error;
    return data;
  },

  /**
   * Increment song view count
   */
  async incrementViews(id) {
    if (!supabaseClient) return;
    const { error } = await supabaseClient
      .rpc('increment_song_views', { song_id: id });
    
    if (error) console.error('Error incrementing views:', error);
  }
};

// Song Request Functions
const SongRequestAPI = {
  /**
   * Submit a new song request
   */
  async submitRequest(requestData) {
    if (!supabaseClient) throw new Error('Supabase not configured');
    const { data, error } = await supabaseClient
      .from('song_requests')
      .insert([
        {
          song_title: requestData.songTitle,
          requester_name: requestData.name,
          requester_email: requestData.email,
          message: requestData.message,
          status: 'pending'
        }
      ])
      .select();
    
    if (error) throw error;
    return data;
  },

  /**
   * Get all requests (admin only)
   */
  async getRequests() {
    if (!supabaseClient) return [];
    const { data, error } = await supabaseClient
      .from('song_requests')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data;
  }
};

// Comment Functions
const CommentAPI = {
  /**
   * Submit a new comment on a song
   */
  async submitComment(songId, commentData) {
    if (!supabaseClient) throw new Error('Supabase not configured');
    const { data, error } = await supabaseClient
      .from('comments')
      .insert([
        {
          song_id: songId,
          visitor_name: commentData.name,
          comment: commentData.comment,
          is_approved: false // Requires moderation
        }
      ])
      .select();
    
    if (error) throw error;
    return data;
  },

  /**
   * Get approved comments for a song
   */
  async getComments(songId) {
    if (!supabaseClient) return [];
    const { data, error } = await supabaseClient
      .from('comments')
      .select('*')
      .eq('song_id', songId)
      .eq('is_approved', true)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data;
  }
};

// Export to global scope
window.SongAPI = SongAPI;
window.SongRequestAPI = SongRequestAPI;
window.CommentAPI = CommentAPI;

console.log('Supabase client initialized');
