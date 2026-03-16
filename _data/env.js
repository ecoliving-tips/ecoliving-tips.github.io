// Environment Configuration for Eleventy
// This file reads from process.env and makes variables available to templates
// Variables are injected at build time

module.exports = {
  supabase: {
    url: process.env.SUPABASE_URL || '',
    key: process.env.SUPABASE_KEY || ''
  },
  upi: {
    id: process.env.UPI_ID || '',
    merchantName: process.env.UPI_MERCHANT_NAME || 'Mindful Living & Devotional Music'
  },
  site: {
    url: process.env.SITE_URL || 'https://ecoliving-tips.github.io'
  }
};
