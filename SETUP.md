# Malayalam Christian Keyboard Tutorials - Dynamic Platform

A dynamic website built with Eleventy (11ty) and Supabase for managing Malayalam Christian devotional songs, chord charts, and user interactions.

## Features

- 📝 **Song Database** - Store and display chord progressions for Malayalam Christian songs
- 💬 **Song Requests** - Visitors can request specific songs
- 💝 **Donations via UPI** - Accept donations through UPI payment
- 📺 **YouTube Integration** - Embedded YouTube tutorials
- 📱 **Mobile Responsive** - Works on all devices
- 🔍 **SEO Optimized** - Enhanced for search engines
- 📊 **Google AdSense** - Preserved and integrated

## Prerequisites

- Node.js 18+
- Git
- GitHub account
- Supabase account (free tier)

## Quick Start

### 1. Clone and Install

```bash
# Clone the repository
git clone https://github.com/yourusername/ecoliving-tips.github.io.git
cd ecoliving-tips.github.io

# Install dependencies
npm install
```

### 2. Set Up Supabase

1. Go to [Supabase](https://supabase.com) and create a new project
2. In the SQL Editor, run the contents of `supabase-setup.sql`
3. Go to Settings > API and copy your URL and anon key

### 3. Configure Environment

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your Supabase credentials
```

Update these files with your Supabase credentials:
- `js/supabase-client.js`
- `js/supabase-browser.js`

### 4. Update UPI Payment

Edit `donate.njk` and replace:
- `yourname@bankname` with your actual UPI ID
- Generate a QR code for your UPI ID and add it

### 5. Run Locally

```bash
npm run dev
```

Visit http://localhost:8080 to see the site.

### 6. Build for Production

```bash
npm run build
```

This creates the `_site` folder with static files.

## GitHub Pages Deployment

### Option 1: Automatic Deployment (Recommended)

1. Push your code to GitHub
2. Go to Repository Settings > Pages
3. Source: Deploy from branch
4. Branch: main (or master)
5. Folder: / (root)
6. Click Save

### Option 2: Manual Build

```bash
# Build the site
npm run build

# The _site folder contains all static files
# Upload contents of _site to your repository
```

## Project Structure

```
├── _data/              # Eleventy data files
│   └── metadata.json   # Site metadata
├── _includes/          # Nunjucks templates
│   └── base.njk        # Main layout
├── css/                # Stylesheets
├── js/                 # JavaScript
│   ├── main.js         # Main scripts
│   └── supabase-browser.js  # Database client
├── supabase-setup.sql  # Database setup
├── index.njk           # Home page
├── songs.njk           # Songs listing
├── request.njk         # Song request form
├── donate.njk          # Donation page
├── about.njk           # About page
├── contact.njk         # Contact page
└── package.json        # Dependencies
```

## AdSense Configuration

The site already has AdSense configured with publisher ID `ca-pub-7438590583270235`. The ads will display automatically. Make sure to:

1. Not modify the AdSense script tags
2. Keep the same publisher ID
3. AdSense approval should continue working

## YouTube Integration

The site uses the YouTube channel `@almightyone8205`. Update `metadata.json` if you change channels.

## Database Schema

### Songs Table
- id (UUID)
- title (Malayalam)
- title_english
- category
- youtube_video_id
- description
- chord_progression
- difficulty
- views
- is_published

### Song Requests Table
- id (UUID)
- song_title
- requester_name
- requester_email
- message
- status (pending/in_progress/completed/rejected)

### Comments Table
- id (UUID)
- song_id (foreign key)
- visitor_name
- comment
- is_approved (requires moderation)

## Troubleshooting

### Site not loading
- Check Node.js version: `node -v` (should be 18+)
- Run `npm install` again
- Check console for errors

### Database not working
- Verify Supabase URL and key in JavaScript files
- Check Supabase project status
- Ensure RLS policies are enabled

### AdSense not showing
- Verify publisher ID matches your AdSense account
- Check AdSense dashboard for policy issues
- Ensure ads.txt is present

## License

MIT

## Support

For questions or issues, contact: almighty33one@gmail.com
