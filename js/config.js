// Environment Configuration
// This file loads configuration from environment variables
// DO NOT hardcode sensitive values in this file or any source files

const CONFIG = {
  // Supabase Configuration (loaded from environment variables)
  supabase: {
    url: window.ENV?.SUPABASE_URL || null,
    key: window.ENV?.SUPABASE_KEY || null
  },
  
  // UPI Configuration (loaded from environment variables)
  upi: {
    id: window.ENV?.UPI_ID || null,
    merchantName: window.ENV?.UPI_MERCHANT_NAME || 'Mindful Living & Devotional Music'
  },
  
  // Site Configuration
  site: {
    url: window.ENV?.SITE_URL || 'https://ecoliving-tips.github.io',
    name: 'Mindful Living & Devotional Music'
  }
};

// Export for use in other scripts
window.SITE_CONFIG = CONFIG;
