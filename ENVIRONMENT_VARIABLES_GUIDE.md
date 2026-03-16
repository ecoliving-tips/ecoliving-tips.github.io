# Environment Variables: Complete Workflow Guide

This guide explains how environment variables work in this project, from local development to GitHub Pages deployment.

---

## 🔒 Why Environment Variables Are Critical

### The Problem: Public Source Code

When you push code to GitHub, **your entire codebase becomes public**. Anyone can view, fork, and download your repository.

### Why This Matters for Credentials

If you hardcode sensitive values like this:

```javascript
// ❌ NEVER DO THIS - INSECURE!
const upiId = "myupi@oksbi";  // Anyone can see this!
const supabaseKey = "eyJh...xyz";  // Your database is compromised!
```

**Anyone who visits your GitHub page can:**
- Steal your Supabase database
- Make changes to your data
- Use your UPI ID for payments
- Access your analytics

### The Solution: Environment Variables

Environment variables are stored separately from your code:
- They exist on your computer (local development)
- They exist in GitHub's secure storage (deployment)
- They are injected during the build process
- They never appear in your source code

---

## 📁 Part 1: Local Development (.env file)

### What is .env?

The `.env` file is a local configuration file that stores sensitive values on YOUR computer only. It's never pushed to GitHub because it's listed in `.gitignore`.

### Creating Your Local .env File

```bash
# Step 1: Copy the example file
cp .env.example .env

# Step 2: Edit with your values
nano .env   # or use any text editor
```

### What Values Go in .env

| Variable | Example Value | Where to Get It |
|----------|---------------|-----------------|
| `SUPABASE_URL` | `https://abc123.supabase.co` | Supabase Dashboard → Settings → API |
| `SUPABASE_KEY` | `eyJhbGciOiJIUzI1NiIs...` | Supabase Dashboard → Settings → API |
| `UPI_ID` | `myname@oksbi` | Your UPI app |
| `UPI_MERCHANT_NAME` | `My Music Site` | Your preference |
| `SITE_URL` | `https://ecoliving-tips.github.io` | Your site URL |

### Complete .env Example

```bash
# Supabase Configuration
SUPABASE_URL=https://xyzabc123.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh5emFiY3EyMyIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNjQwOTk1MjAwLCJleHAiOjE5NTY1NzEyMDB9.example

# UPI Payment
UPI_ID=myname@oksbi
UPI_MERCHANT_NAME=Mindful Living & Devotional Music

# Site
SITE_URL=https://ecoliving-tips.github.io
```

### How Local .env Works

```
┌─────────────────────────────────────────────────────────┐
│                   YOUR COMPUTER                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   .env file (on your machine only)                    │
│   ┌─────────────────────────────────────┐              │
│   │ SUPABASE_URL=https://...            │              │
│   │ SUPABASE_KEY=eyJ...                 │              │
│   │ UPI_ID=myname@oksbi                 │              │
│   └─────────────────────────────────────┘              │
│                         │                               │
│                         ▼                               │
│   npm run build                                         │
│                         │                               │
│                         ▼                               │
│   Environment values are read and embedded              │
│   into the generated HTML/JS files                      │
│                                                         │
│   Output: _site/index.html (safe to publish)           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 🔐 Part 2: GitHub Secrets Configuration

### What Are GitHub Secrets?

GitHub Secrets are encrypted environment variables stored by GitHub. They're only accessible during GitHub Actions workflows - they're never visible in the repository.

### Step-by-Step Configuration

#### Step 1: Navigate to Repository Settings

1. Go to your GitHub repository
2. Click **Settings** tab
3. In left sidebar, find **Secrets and variables** → **Actions**

#### Step 2: Add Repository Secrets

Click **New repository secret** and add:

```
Secret Name: SUPABASE_URL
Secret Value: https://xyzabc123.supabase.co
```

Repeat for:
- `SUPABASE_KEY` (your anon key)
- `UPI_ID` (your UPI ID)

#### Step 3: Add Repository Variables (Non-Sensitive)

Click **New repository variable** and add:

```
Variable Name: SITE_URL
Variable Value: https://ecoliving-tips.github.io
```

### Visual Guide: GitHub Secrets

```
GitHub Repository → Settings → Secrets and variables → Actions
│
├── 🔒 Secrets (encrypted, hidden)
│   ├── SUPABASE_URL     ──→ ●●●●●●●●●●●●●
│   ├── SUPABASE_KEY     ──→ ●●●●●●●●●●●●●
│   └── UPI_ID          ──→ ●●●●●●●●●●●●●
│
└── 📝 Variables (visible in logs)
    ├── SITE_URL         ──→ https://ecoliving-tips.github.io
    └── UPI_MERCHANT_NAME ──→ Mindful Living & Devotional Music
```

---

## ⚙️ Part 3: How Build Process Injects Values

### The Flow: GitHub Actions

```
┌──────────────────────────────────────────────────────────────────┐
│                     GITHUB ACTIONS WORKFLOW                      │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  1. PUSH to main branch                                         │
│         │                                                        │
│         ▼                                                        │
│  2. GitHub Actions triggers                                      │
│         │                                                        │
│         ▼                                                        │
│  3. Checkout code (your .env is NOT pushed!)                    │
│         │                                                        │
│         ▼                                                        │
│  4. Read GitHub Secrets:                                        │
│     • SUPABASE_URL from secrets                                  │
│     • SUPABASE_KEY from secrets                                  │
│     • UPI_ID from secrets                                       │
│         │                                                        │
│         ▼                                                        │
│  5. npm run build                                               │
│     • Build script reads environment variables                   │
│     • Injects values into HTML/JS                                │
│     • Creates _site/ folder                                     │
│         │                                                        │
│         ▼                                                        │
│  6. Deploy to GitHub Pages                                       │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### How Values Get Injected

The build process reads environment variables and embeds them into the generated site:

```javascript
// During build, this gets transformed:
window.ENV = {
  SUPABASE_URL: process.env.SUPABASE_URL,    // "https://xyz..."
  SUPABASE_KEY: process.env.SUPABASE_KEY,    // "eyJ..."
  UPI_ID: process.env.UPI_ID,               // "myname@oksbi"
};
```

### What Happens to Sensitive Values

| Stage | Where Value Exists | Visible in Code? |
|-------|-------------------|------------------|
| Local development | `.env` file | ❌ No |
| During `npm run build` | Computer memory | ❌ No |
| In generated `_site/` | Embedded in HTML | ✅ Yes (necessary) |
| On GitHub server | GitHub Secrets | ❌ No |
| In GitHub Actions logs | In environment | ⚠️ Hidden |
| After deployment | In browser | ✅ Yes (necessary) |

**Important:** The values end up in the deployed HTML/JS, but this is necessary - the browser needs them to connect to Supabase and process payments. The key security measure is that these values never appear in your source code repository.

---

## 🛠️ Part 4: Supabase Dashboard Configuration

### Step 1: Create a Supabase Project

1. Go to [supabase.com](https://supabase.com)
2. Click **New Project**
3. Fill in:
   - **Name**: Malayalam Christian Music
   - **Email**: Your email
   - **Password**: Create strong password
   - **Organization**: Your personal org
4. Wait for setup (~2 minutes)

### Step 2: Get API Credentials

1. In Supabase dashboard, click **Settings** (gear icon)
2. Click **API**
3. Copy **Project URL** → This is `SUPABASE_URL`
4. Copy **anon public** key → This is `SUPABASE_KEY`

```
Settings → API
│
├── Project URL                    → SUPABASE_URL
│   https://xyzabc123.supabase.co 
│
└── anon public (or public)        → SUPABASE_KEY
    eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Step 3: Run Database Setup

1. Go to **SQL Editor**
2. Click **New query**
3. Copy contents of `supabase-setup.sql`
4. Click **Run**
5. Verify tables: **Table Editor** should show:
   - `songs`
   - `song_requests`
   - `comments`
   - `settings`

---

## 📋 Part 5: Complete Step-by-Step Setup

### Phase 1: Local Development

```bash
# 1. Clone repository
git clone https://github.com/yourusername/ecoliving-tips.github.io.git
cd ecoliving-tips.github.io

# 2. Install dependencies
npm install

# 3. Create environment file
cp .env.example .env

# 4. Edit .env with your values
nano .env

# 5. Build locally
npm run build

# 6. Preview locally
npm run dev
# Visit http://localhost:8080
```

### Phase 2: GitHub Secrets

```bash
# 1. Push code to GitHub
git add .
git commit -m "Add dynamic features"
git push origin main

# 2. Go to GitHub → Settings → Secrets and variables → Actions

# 3. Add these secrets:
#    - SUPABASE_URL: https://xyzabc123.supabase.co
#    - SUPABASE_KEY: eyJhbGciOiJIUzI1NiIs...
#    - UPI_ID: myname@oksbi

# 4. Add these variables:
#    - SITE_URL: https://ecoliving-tips.github.io
#    - UPI_MERCHANT_NAME: Mindful Living & Devotional Music
```

### Phase 3: Enable GitHub Pages

```bash
# 1. In GitHub, go to Settings → Pages

# 2. Configure:
#    Source: Deploy from a branch
#    Branch: main (or master)
#    Folder: / (root)

# 3. Click Save

# 4. Wait 2-3 minutes for deployment
```

### Phase 4: Verify

1. Visit your site: `https://yourusername.github.io/ecoliving-tips.github.io/`
2. Test search functionality
3. Test song request form
4. Test donation page
5. Check AdSense ads are displaying

---

## ❓ FAQ: Common Questions

### Q: Can I use different values for local and production?

**Yes!** 
- Local: Edit `.env` for development
- Production: Set GitHub Secrets for deployment

### Q: What if I don't set GitHub Secrets?

The build will still work, but:
- `SUPABASE_URL` will be empty → Database features won't work
- `UPI_ID` will be empty → Donations won't work
- The site will fall back to static content

### Q: How do I update values later?

**Local:** Edit `.env` and rebuild
**Production:** Update GitHub Secrets and push to trigger new build

### Q: Can someone steal my Supabase data?

Only if they get your `SUPABASE_KEY`. By using GitHub Secrets:
- The key is encrypted
- It's only available during CI/CD
- It's never in the repository

### Q: What about the anon key - isn't it supposed to be public?

The **anon key** is designed to be used in client-side code. It's safe because:
- Row Level Security (RLS) in Supabase controls what data can be accessed
- Even with the key, users can only access data they're authorized for

However, you should still:
- Never commit the key to git
- Use GitHub Secrets for deployment
- Enable RLS on all tables

---

## 📞 Need Help?

If you have questions about environment variables:
- Email: almighty33one@gmail.com
- Check Supabase docs: https://supabase.com/docs
- Check GitHub Actions docs: https://docs.github.com/en/actions
