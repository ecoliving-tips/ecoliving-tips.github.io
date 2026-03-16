# Deployment Guide: Malayalam Christian Keyboard Tutorials Website

A complete step-by-step guide for deploying the Eleventy + Supabase website to GitHub Pages.

---

## ⚠️ Security Important

**Never hardcode sensitive credentials in source files!**

All sensitive values must be managed through environment variables:
- Supabase URL and API Key
- UPI Payment ID
- Site URL

This guide explains how to properly configure and manage credentials.

---

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Node.js | 18+ |
| npm | 9+ |
| Git | 2.x |
| GitHub Account | - |
| Supabase Account | Free tier |

---

## Step 1: Clone the Repository

```bash
# Clone the repository
git clone https://github.com/yourusername/ecoliving-tips.github.io.git
cd ecoliving-tips.github.io

# Verify Node.js version
node -v  # Should be 18+
```

---

## Step 2: Environment Configuration

### 2.1 Create Environment File

```bash
# Copy the example environment file
cp .env.example .env
```

### 2.2 Edit .env File

Open `.env` in a text editor and add your credentials:

```bash
# Supabase Configuration
# Get these from: https://supabase.com/dashboard > Your Project > Settings > API
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_KEY=your-anon-key-here

# UPI Payment Configuration
# Replace with your actual UPI ID (e.g., yourname@oksbi)
UPI_ID=yourname@bankname
UPI_MERCHANT_NAME=Mindful Living & Devotional Music

# Site Configuration
SITE_URL=https://ecoliving-tips.github.io
```

### 2.3 Update .gitignore

Ensure `.env` is ignored (already configured in `.gitignore`):

```bash
# Verify .gitignore contains:
.env
.env.local
.env.*.local
```

---

## Step 3: Supabase Setup

### 3.1 Create Supabase Project

1. Go to [supabase.com](https://supabase.com)
2. Click "New Project"
3. Fill in details:
   - **Name**: Malayalam Christian Music
   - **Database Password**: Create a strong password
   - **Region**: Select nearest to you (India - ap-south-1 recommended)
4. Wait for project to initialize (~2 minutes)

### 3.2 Initialize Database

1. In Supabase Dashboard, go to **SQL Editor**
2. Click **New query**
3. Copy contents of `supabase-setup.sql`
4. Click **Run**
5. Verify tables created: **Table Editor** → Should show `songs`, `song_requests`, `comments`, `settings`

### 3.3 Get API Credentials

1. Go to **Settings** → **API**
2. Copy **Project URL** → This is `SUPABASE_URL`
3. Copy **anon public** key → This is `SUPABASE_KEY`
4. Add these to your `.env` file

---

## Step 4: Install Dependencies

```bash
# Install Node.js dependencies
npm install
```

Expected output:
```
added 150 packages in 10s
```

---

## Step 5: Configure Environment for Build

The build system reads from environment variables. Set them before building:

```bash
# On Linux/Mac:
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_KEY="your-anon-key"
export UPI_ID="yourname@bankname"

# On Windows (Command Prompt):
set SUPABASE_URL=https://your-project.supabase.co
set SUPABASE_KEY=your-anon-key
set UPI_ID=yourname@bankname

# On Windows (PowerShell):
$env:SUPABASE_URL="https://your-project.supabase.co"
$env:SUPABASE_KEY="your-anon-key"
$env:UPI_ID="yourname@bankname"
```

---

## Step 6: Build the Project

```bash
# Clean previous builds (optional)
npm run clean

# Build the site
npm run build
```

Expected output:
```
[11ty] Writing _site/index.html
[11ty] Writing _site/songs/index.html
[11ty] Writing _site/donate/index.html
[11ty] Writing _site/request/index.html
...
[11ty] Site written to _site/
```

---

## Step 7: Deploy to GitHub Pages

### Option A: Automatic Deployment (Recommended)

1. **Push code to GitHub:**
   ```bash
   git add .
   git commit -m "Initial deployment with dynamic features"
   git push origin main
   ```

2. **Configure GitHub Pages:**
   - Go to Repository **Settings** → **Pages**
   - Source: **Deploy from a branch**
   - Branch: **main** (or master)
   - Folder: **/** (root)
   - Click **Save**

3. **Wait for deployment** (~2-3 minutes)

4. **Visit:** `https://yourusername.github.io/ecoliving-tips.github.io/`

### Option B: Manual Deployment

```bash
# Build the site
npm run build

# The _site folder now contains all static files
# Upload contents of _site to your GitHub repository
```

---

## Step 8: Verify Deployment

### Check:

1. ✅ **Home page loads** - Visit your site URL
2. ✅ **Navigation works** - Click through all menu items
3. ✅ **AdSense displays** - Check for ads in ad slots
4. ✅ **YouTube embeds** - Videos play correctly
5. ✅ **Static content shows** - Songs and tutorials visible

### Test Dynamic Features:

1. ✅ **Song search** - Try searching for a song
2. ✅ **Song request form** - Submit a test request
3. ✅ **Donation page** - UPI payment link works

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_KEY` | Yes | Supabase anon/public key |
| `UPI_ID` | Yes | Your UPI payment ID |
| `UPI_MERCHANT_NAME` | No | Display name for UPI |
| `SITE_URL` | No | Your site URL |

---

## Troubleshooting

### Build Errors

**Error: "SUPABASE_URL is not set"**
```bash
# Make sure environment variables are exported
export SUPABASE_URL="https://your-project.supabase.co"
npm run build
```

**Error: "Module not found"**
```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### Runtime Errors

**AdSense not showing**
- Verify publisher ID: `ca-pub-7438590583270235`
- Check AdSense dashboard for policy issues
- Ensure ads.txt is accessible

**Database not connecting**
- Verify Supabase URL and key in environment
- Check Supabase project status (not paused)
- Verify RLS policies are enabled

**UPI payment not working**
- Verify UPI_ID in environment variables
- Test on mobile device with UPI app

---

## Managing Credentials Safely

### ✅ DO:
- Use environment variables (`.env` file)
- Use GitHub Secrets for CI/CD
- Rotate keys periodically

### ❌ DON'T:
- Never commit `.env` to version control
- Never hardcode credentials in source files
- Never share credentials in chat/email

### GitHub Secrets (for automatic deployment):

1. Go to Repository **Settings** → **Secrets and variables** → **Actions**
2. Add secrets:
   - `SUPABASE_URL`
   - `SUPABASE_KEY`
   - `UPI_ID`
3. Update workflow to use secrets

---

## Next Steps After Deployment

1. **Add sample songs** to Supabase database
2. **Test song request form** - Submit a test request
3. **Verify UPI QR code** - Generate and add your QR code to `donate.njk`
4. **Monitor AdSense** - Check for any policy notifications
5. **Submit sitemap** - Submit to Google Search Console

---

## Support

- **Email**: almighty33one@gmail.com
- **YouTube**: @almightyone8205
- **Issues**: Open a GitHub issue

---

*Last Updated: March 2026*
