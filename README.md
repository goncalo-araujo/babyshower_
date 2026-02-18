# Baby Shower Web App

A modern, minimalist baby shower website with a live gift registry, contribution tracking, and an AI-powered chat assistant.

## Architecture

```
Frontend (static)          Backend (serverless)
─────────────────          ────────────────────
GitHub Pages               Cloudflare Worker
github.io/babyshower_/ ←── /api/items
                           /api/contributions
                           /api/chat (Workers AI)
                           /api/admin/auth
                               │
                           Cloudflare D1 (SQLite)
                           items + contributions tables
```

**Live URLs (after deployment):**
- Main site: `https://goncalo-araujo.github.io/babyshower_`
- Worker API: `https://babyshower-worker.YOUR_SUBDOMAIN.workers.dev`

---

## Prerequisites

- [Node.js](https://nodejs.org) 18+
- A [Cloudflare account](https://dash.cloudflare.com) (free tier is sufficient)
- Wrangler CLI: `npm install -g wrangler`
- Access to the `goncalo-araujo.github.io` GitHub Pages repository

---

## Setup & Deployment

### Step 1 — Authenticate with Cloudflare

```bash
wrangler login
```

### Step 2 — Create the D1 database

```bash
wrangler d1 create babyshower-db
```

Copy the `database_id` from the output and paste it into `worker/wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "babyshower-db"
database_id = "PASTE_YOUR_ID_HERE"   # ← replace this
```

### Step 3 — Install Worker dependencies

```bash
cd worker
npm install
```

### Step 4 — Apply the database schema

Apply to **production** D1:

```bash
cd worker
npm run db:init:remote
```

For local development only:

```bash
npm run db:init
```

This creates the `items` and `contributions` tables and seeds 5 example gift items.

### Step 5 — Set the admin password

```bash
wrangler secret put ADMIN_PASSWORD
# You will be prompted to enter your password securely
```

### Step 6 — Deploy the Worker

```bash
cd worker
npm run deploy
```

Note the output URL — it will look like:
`https://babyshower-worker.YOUR_SUBDOMAIN.workers.dev`

### Step 7 — Update the frontend API_BASE

Edit **both** of these files and replace `YOUR_SUBDOMAIN` with your actual worker subdomain:

- `frontend/js/main.js` — line 8
- `frontend/js/admin.js` — line 6

```js
const API_BASE = 'https://babyshower-worker.YOUR_SUBDOMAIN.workers.dev';
```

### Step 8 — Deploy the frontend to GitHub Pages

Copy the `frontend/` contents into your GitHub Pages repo under a `babyshower/` subdirectory:

```bash
# Navigate to your GitHub Pages repo (adjust path as needed)
PAGES_REPO="/path/to/goncalo-araujo.github.io"

# Create the subdirectory and copy files
mkdir -p "$PAGES_REPO/babyshower"
cp -r frontend/. "$PAGES_REPO/babyshower/"

# Commit and push
cd "$PAGES_REPO"
git add babyshower/
git commit -m "feat: add baby shower app"
git push origin main
```

The site will be live at `https://goncalo-araujo.github.io/babyshower_` within a minute.

---

## Local Development

Run the Worker locally with live D1 access:

```bash
cd worker
wrangler dev
# Worker available at http://localhost:8787
```

Create `worker/.dev.vars` for local secrets (this file is gitignored):

```
ADMIN_PASSWORD=local-dev-password
```

Then update `API_BASE` in both JS files temporarily:

```js
const API_BASE = 'http://localhost:8787';
```

Open `frontend/index.html` directly in your browser to see the frontend.

---

## Customisation Checklist

After deployment, update the following before sharing the invite:

**`frontend/index.html`:**
- [ ] Hero title — update name(s) if desired
- [ ] Hero paragraph — personalise the welcome message
- [ ] Event date and time (lines with `<!-- UPDATE: -->` comments)
- [ ] Venue name and address
- [ ] Public transport instructions
- [ ] Car/parking instructions
- [ ] Google Maps link (`href` in the venue section)
- [ ] OpenStreetMap iframe coordinates (`bbox`, `lat`, `lon` in the `src` attribute)

**Gift registry:**
- [ ] Log into the admin panel at `/admin.html`
- [ ] Delete the seed example items
- [ ] Add real gift items with actual images, prices, and links

---

## Project Structure

```
babyshower_project/
├── .gitignore
├── .env.example          ← documents all config values (safe to commit)
├── README.md
│
├── frontend/             ← static files → deployed to GitHub Pages
│   ├── index.html        ← main single-page app
│   ├── admin.html        ← password-protected admin panel
│   ├── css/
│   │   └── style.css     ← full design system (CSS custom properties)
│   └── js/
│       ├── main.js       ← gift cards, contribution form, chatbot UI
│       └── admin.js      ← admin CRUD, login, contributions table
│
└── worker/               ← Cloudflare Worker project
    ├── wrangler.toml     ← Worker config, D1 binding, AI binding
    ├── schema.sql        ← D1 database schema + seed data
    ├── package.json
    ├── tsconfig.json
    └── src/
        └── index.ts      ← all API routes (TypeScript)
```

---

## API Reference

All API calls go to `https://babyshower-worker.YOUR_SUBDOMAIN.workers.dev`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/items` | — | List all gift items |
| `POST` | `/api/items` | Admin | Create a new gift item |
| `PUT` | `/api/items/:id` | Admin | Update a gift item |
| `DELETE` | `/api/items/:id` | Admin | Delete a gift item (cascades contributions) |
| `GET` | `/api/contributions` | Admin | List all contributions |
| `POST` | `/api/contributions` | — | Submit a guest contribution |
| `POST` | `/api/chat` | — | Chat with the AI assistant |
| `POST` | `/api/admin/auth` | — | Verify admin password |

**Admin auth:** send `X-Admin-Password: YOUR_PASSWORD` header with admin requests.

---

## Useful Commands

```bash
# View items in production D1
cd worker && npm run db:query -- "SELECT * FROM items"

# View contributions in production D1
cd worker && npm run db:query -- "SELECT * FROM contributions"

# Re-deploy the Worker after changes
cd worker && npm run deploy

# Update frontend on GitHub Pages (re-run Step 8 above)
```
