# Clickzle — Full Launch Roadmap
### Hosting · API · Auth · Leaderboards · Ads · UX Improvements

---

## Priority Order

Work through these phases in sequence. Each one unblocks the next.

| Phase | Task | Why first |
|---|---|---|
| **1** | Hosting (Cloudflare Pages) | Everything else needs a live URL |
| **2** | Backend API + Database | Auth and leaderboards both depend on this |
| **3** | Auth — free for thousands of users | Must be wired before leaderboards show usernames |
| **4** | Leaderboards + Stats (with device tracking) | Needs auth + API |
| **5** | Personal Best on entry screen | Needs score history from Phase 4 |
| **6** | Strong CTA on all exit screens | Wires into existing share/invite buttons |
| **7** | Google AdSense on all ad panels | Last — AdSense approval requires live, populated site |

---

## Phase 1 — Cloudflare Pages (Static Hosting)

Free hosting for all HTML/CSS/JS game files. No build step needed.

### Services used

| Service | What it does | Free tier |
|---|---|---|
| **Cloudflare Pages** | Hosts all static HTML/CSS/JS game files | Unlimited requests, 500 deploys/month |
| **Cloudflare Workers** | Runs the leaderboard/auth API (serverless) | 100,000 requests/day |
| **Cloudflare D1** | SQLite database — scores, users, stats | 5M row reads/day, 100K writes/day, 5GB |
| **Cloudflare KV** | Daily seeds, rate-limit counters | 100K reads/day, 1K writes/day |

No credit card required to start.

### 1.1 Create Cloudflare account
1. Go to **dash.cloudflare.com** → Sign up
2. Verify your email

### 1.2 Add your domain (clickzle.games)
1. Dashboard → **Add a Site** → enter `clickzle.games`
2. Select **Free plan**
3. Cloudflare scans your existing DNS records
4. Copy the two **Cloudflare nameservers** shown (e.g. `ada.ns.cloudflare.com`)
5. Log in to your domain registrar → replace nameservers with Cloudflare's two
6. Wait up to 24 hours for propagation (usually under 1 hour)
7. You'll get an email: "Your site is now active"

### 1.3 Set up your GitHub repository

Cloudflare Pages deploys directly from a GitHub repository. You need to push your local `clickzle` folder to GitHub first.

#### 1.3.1 Create a GitHub account (if you don't have one)
1. Go to **github.com** → click **Sign up**
2. Enter your email, create a password, choose a username
3. Verify your email address
4. On the welcome screen you can skip all optional steps

#### 1.3.2 Create a new repository on GitHub
1. Once logged in, click the **+** icon (top right) → **New repository**
2. Fill in:
   - **Repository name**: `clickzle`
   - **Visibility**: **Public** *(required for Cloudflare Pages free tier)*
   - Leave "Initialize this repository" **unchecked** — you're pushing existing files
3. Click **Create repository**
4. GitHub shows a page with your repo URL — it looks like:
   `https://github.com/YOUR-USERNAME/clickzle.git`
   Copy this URL — you'll need it in step 1.3.4.

#### 1.3.3 Install Git on your computer (if not already installed)

**Windows:**
1. Go to **git-scm.com/download/win** and download the installer
2. Run the installer — accept all defaults
3. Open **Git Bash** (installed with Git) — use this for all git commands below

**Mac:**
1. Open Terminal and run: `git --version`
2. If not installed, macOS will prompt you to install Xcode Command Line Tools — click Install
3. Alternatively: install via Homebrew with `brew install git`

Verify it worked:
```bash
git --version
# Should print something like: git version 2.43.0
```

#### 1.3.4 Configure Git with your identity (first time only)

Open Git Bash (Windows) or Terminal (Mac) and run:

```bash
git config --global user.name "Your Name"
git config --global user.email "your@email.com"
```

Use the same email you signed up to GitHub with.

#### 1.3.5 Push your local clickzle folder to GitHub

Navigate to your clickzle project folder. In Git Bash or Terminal:

```bash
cd /path/to/clickzle
# Windows example: cd "C:/Users/System/Desktop/clickzle"
# Mac example:     cd ~/Desktop/clickzle
```

Initialize the repository, add all files, and push:

```bash
# Step 1 — initialise a git repo in the folder (only run once)
git init

# Step 2 — stage all files for the first commit
git add .

# Step 3 — create the first commit
git commit -m "initial commit"

# Step 4 — rename the default branch to main (GitHub's default)
git branch -M main

# Step 5 — link your local repo to GitHub (paste YOUR repo URL here)
git remote add origin https://github.com/YOUR-USERNAME/clickzle.git

# Step 6 — push to GitHub
git push -u origin main
```

GitHub will ask for your username and password the first time. **Note:** GitHub no longer accepts your account password — you need a **Personal Access Token** instead:

1. On GitHub: click your profile photo (top right) → **Settings**
2. Scroll to the bottom → **Developer settings** → **Personal access tokens** → **Tokens (classic)**
3. Click **Generate new token (classic)**
4. Set a note (e.g. "clickzle push"), set expiration to **No expiration**, tick the **repo** scope
5. Click **Generate token** — copy it immediately (you only see it once)
6. Use this token as your password when Git prompts you

After the first push, your code is visible at `github.com/YOUR-USERNAME/clickzle`.

#### 1.3.6 How to push future changes

Every time you make a change to a game file and want it live, run:

```bash
git add .
git commit -m "brief description of what changed"
git push
```

Cloudflare Pages picks up the push automatically and redeploys within ~30 seconds.

#### 1.3.7 Recommended: use GitHub Desktop (no command line)

If you prefer a visual tool over the terminal:
1. Download **GitHub Desktop** from **desktop.github.com**
2. Sign in with your GitHub account
3. Click **Add an Existing Repository** → select your `clickzle` folder
4. It will detect the git history and connect to the remote automatically
5. To push changes: click **Commit to main** → **Push origin**

---

### 1.4 Connect your GitHub repo to Cloudflare Pages
1. Cloudflare Dashboard → **Pages** → **Create a project** → **Connect to Git**
2. Click **Connect GitHub** → authorise Cloudflare to access your GitHub account
3. Select the `clickzle` repository from the list
4. Build settings:
   - **Framework preset**: None
   - **Build command**: *(leave blank — plain HTML, no build step)*
   - **Build output directory**: `/` (root of repo)
5. Click **Save and Deploy**

Cloudflare will pull your repo and deploy it. Takes ~1 minute the first time. After that, every `git push` triggers an automatic redeploy.

### 1.5 Add custom domain
1. Pages project → **Custom domains** → **Set up a custom domain**
2. Enter `clickzle.games`
3. Also add `www.clickzle.games` as a second custom domain
4. Cloudflare auto-creates the DNS records and SSL cert

### 1.6 What this gives you
- Every file in the repo is live at `clickzle.games/`
- `games/game4/spot-the-pair.html` → `clickzle.games/games/game4/spot-the-pair.html`
- HTTPS automatic, global CDN, no per-game config needed

---

## Phase 2 — Backend API + Database (Workers + D1 + KV)

### 2.1 Create the D1 database
1. Dashboard → **Workers & Pages** → **D1** → **Create database**
2. Name it: `clickzle-db`
3. Note the **Database ID** — you need it in wrangler.toml

### 2.2 Run the schema

Go to your D1 database → **Console** tab → paste and run:

```sql
-- Users table
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,         -- UUID generated on signup
  username    TEXT UNIQUE NOT NULL,
  email       TEXT UNIQUE,
  password_hash TEXT NOT NULL,          -- bcrypt hash
  created_at  INTEGER NOT NULL,         -- Unix timestamp
  last_seen   INTEGER
);

-- Scores table — one row per game attempt
CREATE TABLE IF NOT EXISTS scores (
  id               TEXT PRIMARY KEY,
  user_id          TEXT,                -- NULL for anonymous plays
  guest_name       TEXT,                -- name entered on start screen (anonymous)
  game_id          INTEGER NOT NULL,    -- 1=CompleteImage, 2=FollowPattern, 3=HitTarget, 4=SpotPair, 5=NextSequence, 6=SpeedDifference
  play_date        TEXT NOT NULL,       -- YYYY-MM-DD
  score            INTEGER NOT NULL DEFAULT 0,
  pairs_found      INTEGER,
  best_streak      INTEGER,
  accuracy         REAL,                -- 0.0–1.0
  avg_reaction     INTEGER,             -- ms
  fastest_reaction INTEGER,             -- ms
  round_scores     TEXT,                -- JSON array
  device_type      TEXT NOT NULL DEFAULT 'unknown',  -- 'mobile' or 'desktop'
  submitted_at     INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Sessions table (for JWT-less server-side auth)
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,          -- session token (random UUID)
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_scores_game_date  ON scores(game_id, play_date);
CREATE INDEX IF NOT EXISTS idx_scores_user       ON scores(user_id);
CREATE INDEX IF NOT EXISTS idx_scores_score_desc ON scores(game_id, play_date, score DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user     ON sessions(user_id);
```

### 2.3 Create KV namespaces
1. Dashboard → **Workers & Pages** → **KV** → **Create a namespace**
2. Create two namespaces:
   - `CLICKZLE_SEEDS` — stores daily puzzle seed per game
   - `CLICKZLE_RATELIMIT` — tracks submissions per IP per day
3. Note both **Namespace IDs**

### 2.4 Install Wrangler CLI

```bash
npm install -g wrangler
wrangler login
```

### 2.5 Create `api/` folder in your repo

```bash
mkdir api && cd api
npm init -y
npm install wrangler --save-dev
```

### 2.6 Create `api/wrangler.toml`

```toml
name = "clickzle-api"
main = "src/index.js"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "clickzle-db"
database_id = "PASTE_YOUR_D1_DATABASE_ID_HERE"

[[kv_namespaces]]
binding = "SEEDS"
id = "PASTE_YOUR_SEEDS_KV_ID_HERE"

[[kv_namespaces]]
binding = "RATELIMIT"
id = "PASTE_YOUR_RATELIMIT_KV_ID_HERE"

[vars]
ALLOWED_ORIGIN = "https://clickzle.games"
JWT_SECRET = "GENERATE_A_LONG_RANDOM_STRING_HERE"
```

### 2.7 Create `api/src/index.js`

Full Worker — handles all API routes including auth, leaderboard, and score submission:

```javascript
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN;
    const corsHeaders = {
      'Access-Control-Allow-Origin': (origin === allowed || origin === 'https://www.clickzle.games') ? origin : allowed,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/api/auth/register'  && request.method === 'POST') return await register(request, env, corsHeaders);
      if (path === '/api/auth/login'     && request.method === 'POST') return await login(request, env, corsHeaders);
      if (path === '/api/auth/logout'    && request.method === 'POST') return await logout(request, env, corsHeaders);
      if (path === '/api/auth/me'        && request.method === 'GET')  return await getMe(request, env, corsHeaders);
      if (path === '/api/leaderboard'    && request.method === 'GET')  return await getLeaderboard(request, env, corsHeaders);
      if (path === '/api/submit'         && request.method === 'POST') return await submitScore(request, env, corsHeaders);
      if (path === '/api/my-scores'      && request.method === 'GET')  return await getMyScores(request, env, corsHeaders);
      if (path === '/api/seed'           && request.method === 'GET')  return await getDailySeed(request, env, corsHeaders);

      return json({ error: 'Not found' }, 404, corsHeaders);
    } catch (err) {
      return json({ error: 'Server error', detail: err.message }, 500, corsHeaders);
    }
  }
};

// ── AUTH ──────────────────────────────────────────────────────────────────────

async function register(request, env, cors) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'Invalid JSON' }, 400, cors);

  const { username, email, password } = body;
  if (!username || username.length < 3 || username.length > 20) return json({ error: 'Username must be 3–20 chars' }, 400, cors);
  if (!password || password.length < 6) return json({ error: 'Password must be at least 6 chars' }, 400, cors);
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return json({ error: 'Username: letters, numbers, underscores only' }, 400, cors);

  const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (existing) return json({ error: 'Username taken' }, 409, cors);

  const passwordHash = await hashPassword(password);
  const userId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    'INSERT INTO users (id, username, email, password_hash, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(userId, username, email || null, passwordHash, now, now).run();

  const sessionToken = crypto.randomUUID();
  const expiresAt = now + 60 * 60 * 24 * 30; // 30 days
  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(sessionToken, userId, now, expiresAt).run();

  return json({ success: true, token: sessionToken, username }, 201, cors);
}

async function login(request, env, cors) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'Invalid JSON' }, 400, cors);

  const { username, password } = body;
  const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
  if (!user) return json({ error: 'Invalid username or password' }, 401, cors);

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return json({ error: 'Invalid username or password' }, 401, cors);

  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(now, user.id).run();

  const sessionToken = crypto.randomUUID();
  const expiresAt = now + 60 * 60 * 24 * 30;
  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(sessionToken, user.id, now, expiresAt).run();

  return json({ success: true, token: sessionToken, username: user.username }, 200, cors);
}

async function logout(request, env, cors) {
  const token = getBearerToken(request);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(token).run();
  return json({ success: true }, 200, cors);
}

async function getMe(request, env, cors) {
  const user = await getAuthedUser(request, env);
  if (!user) return json({ error: 'Not authenticated' }, 401, cors);
  return json({ username: user.username, email: user.email, created_at: user.created_at }, 200, cors);
}

async function getAuthedUser(request, env) {
  const token = getBearerToken(request);
  if (!token) return null;
  const now = Math.floor(Date.now() / 1000);
  const session = await env.DB.prepare(
    'SELECT user_id FROM sessions WHERE id = ? AND expires_at > ?'
  ).bind(token, now).first();
  if (!session) return null;
  return await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(session.user_id).first();
}

function getBearerToken(request) {
  const auth = request.headers.get('Authorization') || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

// Simple password hashing using Web Crypto (PBKDF2)
async function hashPassword(password) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:${saltHex}:${hashHex}`;
}

async function verifyPassword(password, stored) {
  const [, saltHex, hashHex] = stored.split(':');
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map(b => parseInt(b, 16)));
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const testHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  return testHex === hashHex;
}

// ── LEADERBOARD ───────────────────────────────────────────────────────────────

// GET /api/leaderboard?game=4&date=2024-03-28&limit=50&offset=0
async function getLeaderboard(request, env, cors) {
  const url = new URL(request.url);
  const gameId = parseInt(url.searchParams.get('game') || '0');
  const date   = url.searchParams.get('date') || todayDate();
  const limit  = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0');

  if (!gameId || gameId < 1 || gameId > 6) return json({ error: 'Invalid game id' }, 400, cors);

  const result = await env.DB.prepare(`
    SELECT
      ROW_NUMBER() OVER (ORDER BY score DESC, submitted_at ASC) AS rank,
      COALESCE(u.username, s.guest_name, 'Anonymous') AS name,
      s.score,
      s.best_streak,
      s.accuracy,
      s.avg_reaction,
      s.pairs_found,
      s.fastest_reaction,
      s.device_type,
      s.submitted_at,
      CASE WHEN s.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_registered
    FROM scores s
    LEFT JOIN users u ON s.user_id = u.id
    WHERE s.game_id = ? AND s.play_date = ?
    ORDER BY s.score DESC, s.submitted_at ASC
    LIMIT ? OFFSET ?
  `).bind(gameId, date, limit, offset).all();

  const countResult = await env.DB.prepare(
    'SELECT COUNT(*) as total FROM scores WHERE game_id = ? AND play_date = ?'
  ).bind(gameId, date).first();

  return json({ date, game_id: gameId, total: countResult.total, entries: result.results }, 200, cors);
}

// ── SUBMIT SCORE ──────────────────────────────────────────────────────────────

// POST /api/submit
// Body: { game_id, play_date, guest_name, score, pairs_found, best_streak,
//         accuracy, avg_reaction, fastest_reaction, round_scores, device_type }
async function submitScore(request, env, cors) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'Invalid JSON' }, 400, cors);

  const { game_id, play_date, guest_name, score, pairs_found, best_streak,
          accuracy, avg_reaction, fastest_reaction, round_scores, device_type } = body;

  if (!game_id || game_id < 1 || game_id > 6) return json({ error: 'Invalid game_id' }, 400, cors);
  if (!play_date || !/^\d{4}-\d{2}-\d{2}$/.test(play_date)) return json({ error: 'Invalid date' }, 400, cors);
  if (typeof score !== 'number' || score < 0 || score > 999999) return json({ error: 'Invalid score' }, 400, cors);

  // Check if request is from an authenticated user
  const authedUser = await getAuthedUser(request, env);
  const userId = authedUser ? authedUser.id : null;

  // Rate limit: 3 submissions per IP per game per day
  const rateLimitKey = `${ip}:${game_id}:${play_date}`;
  const current = parseInt(await env.RATELIMIT.get(rateLimitKey) || '0');
  if (current >= 3) return json({ error: 'Already submitted today' }, 429, cors);

  const deviceTypeSafe = device_type === 'mobile' ? 'mobile' : 'desktop';

  const scoreId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  // For registered users: upsert (keep best score only)
  if (userId) {
    const existing = await env.DB.prepare(
      'SELECT id, score FROM scores WHERE user_id = ? AND game_id = ? AND play_date = ? ORDER BY score DESC LIMIT 1'
    ).bind(userId, game_id, play_date).first();

    if (existing) {
      if (score <= existing.score) {
        // Score isn't better — still return rank/total but don't insert
        const rankResult = await env.DB.prepare(
          'SELECT COUNT(*) + 1 AS rank FROM scores WHERE game_id = ? AND play_date = ? AND score > ?'
        ).bind(game_id, play_date, existing.score).first();
        const totalResult = await env.DB.prepare(
          'SELECT COUNT(*) AS total FROM scores WHERE game_id = ? AND play_date = ?'
        ).bind(game_id, play_date).first();
        return json({ success: true, improved: false, rank: rankResult.rank, total: totalResult.total }, 200, cors);
      }
      await env.DB.prepare('DELETE FROM scores WHERE id = ?').bind(existing.id).run();
    }
  }

  await env.DB.prepare(`
    INSERT INTO scores
      (id, user_id, guest_name, game_id, play_date, score, pairs_found, best_streak,
       accuracy, avg_reaction, fastest_reaction, round_scores, device_type, submitted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    scoreId, userId,
    userId ? null : (guest_name || 'Anonymous').slice(0, 30),
    game_id, play_date, score,
    pairs_found || null, best_streak || null,
    accuracy || null, avg_reaction || null, fastest_reaction || null,
    round_scores ? JSON.stringify(round_scores) : null,
    deviceTypeSafe, now
  ).run();

  const secondsUntilMidnight = getSecondsUntilMidnight();
  await env.RATELIMIT.put(rateLimitKey, String(current + 1), { expirationTtl: secondsUntilMidnight });

  const rankResult = await env.DB.prepare(
    'SELECT COUNT(*) + 1 AS rank FROM scores WHERE game_id = ? AND play_date = ? AND score > ?'
  ).bind(game_id, play_date, score).first();
  const totalResult = await env.DB.prepare(
    'SELECT COUNT(*) AS total FROM scores WHERE game_id = ? AND play_date = ?'
  ).bind(game_id, play_date).first();

  return json({ success: true, improved: true, rank: rankResult.rank, total: totalResult.total, score_id: scoreId }, 200, cors);
}

// ── MY SCORES ─────────────────────────────────────────────────────────────────

// GET /api/my-scores  (requires Bearer token for registered user, or ?name= for guest)
async function getMyScores(request, env, cors) {
  const authedUser = await getAuthedUser(request, env);

  if (authedUser) {
    const results = await env.DB.prepare(`
      SELECT game_id, play_date, score, best_streak, accuracy, avg_reaction,
             pairs_found, fastest_reaction, device_type, submitted_at
      FROM scores WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 100
    `).bind(authedUser.id).all();
    return json({ username: authedUser.username, entries: results.results }, 200, cors);
  }

  // Guest fallback — look up by name
  const url = new URL(request.url);
  const name = (url.searchParams.get('name') || '').slice(0, 30);
  if (!name) return json({ error: 'Not authenticated and no name provided' }, 400, cors);

  const results = await env.DB.prepare(`
    SELECT game_id, play_date, score, best_streak, accuracy, avg_reaction,
           pairs_found, fastest_reaction, device_type, submitted_at
    FROM scores WHERE guest_name = ? ORDER BY submitted_at DESC LIMIT 50
  `).bind(name).all();
  return json({ entries: results.results }, 200, cors);
}

// ── DAILY SEED ────────────────────────────────────────────────────────────────

// GET /api/seed?game=4&date=2024-03-28
async function getDailySeed(request, env, cors) {
  const url = new URL(request.url);
  const gameId = url.searchParams.get('game');
  const date   = url.searchParams.get('date') || todayDate();

  const key = `seed:${gameId}:${date}`;
  let seed = await env.SEEDS.get(key);
  if (!seed) {
    seed = String(hashCode(`${gameId}-${date}`));
    await env.SEEDS.put(key, seed, { expirationTtl: 60 * 60 * 48 });
  }
  return json({ seed: parseInt(seed), date }, 200, cors);
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function getSecondsUntilMidnight() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setUTCHours(24, 0, 0, 0);
  return Math.floor((midnight - now) / 1000);
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}
```

### 2.8 Deploy the Worker

```bash
cd api
npx wrangler deploy
```

API is now live at: `https://clickzle-api.YOUR-SUBDOMAIN.workers.dev`

### 2.9 Add custom route so the API is on your domain

1. Dashboard → **Workers & Pages** → your Worker → **Triggers** → **Add Custom Domain**
2. Enter: `api.clickzle.games`

Now your API runs at `https://api.clickzle.games/*`.

---

## Phase 3 — Auth: Free for Thousands of Users

**Do NOT use Cloudflare Access for player auth** — it is only free for 50 users and is designed for internal tools.

Instead use **custom username + password auth** built into the Worker above (Phase 2). It is:
- Free for unlimited users
- Stored in D1 (the same database you already have)
- Session-token based (token stored in `localStorage`)
- Passwords hashed with PBKDF2 (Web Crypto, no dependencies)

This is already coded in `api/src/index.js` above (routes: `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`).

### 3.1 Add auth UI to each game's start screen

On the start screen (before the player enters their name), show a login/register toggle:

```javascript
// auth.js — shared across all games
const AUTH_API = 'https://api.clickzle.games';

function getToken() { return localStorage.getItem('cz_token'); }
function getUsername() { return localStorage.getItem('cz_username'); }
function saveSession(token, username) {
  localStorage.setItem('cz_token', token);
  localStorage.setItem('cz_username', username);
}
function clearSession() {
  localStorage.removeItem('cz_token');
  localStorage.removeItem('cz_username');
}

async function register(username, password, email) {
  const res = await fetch(`${AUTH_API}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, email })
  });
  const data = await res.json();
  if (data.token) saveSession(data.token, data.username);
  return data;
}

async function loginUser(username, password) {
  const res = await fetch(`${AUTH_API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if (data.token) saveSession(data.token, data.username);
  return data;
}

async function logoutUser() {
  const token = getToken();
  if (token) {
    await fetch(`${AUTH_API}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
  }
  clearSession();
}
```

On the start screen, if `getToken()` returns a value, show "Playing as [username] · Log out". If not, show the guest name field plus small "Log in / Register" links.

### 3.2 Pass the token on score submission

```javascript
async function submitToLeaderboard(gameData) {
  const token = getToken();
  const today = new Date().toISOString().slice(0, 10);

  const res = await fetch('https://api.clickzle.games/api/submit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    },
    body: JSON.stringify({
      game_id: 4,                        // change per game
      play_date: today,
      guest_name: gs.playerName,         // ignored if token present
      score: gs.totalScore,
      pairs_found: gs.totalPairs,
      best_streak: gs.bestStreak,
      accuracy: gs.accuracy,
      avg_reaction: gs.avgReactionMs,
      round_scores: gs.roundScores,
      device_type: getDeviceType()       // see Phase 4
    })
  });
  return await res.json();
}
```

### 3.3 Why this is better than alternatives

| Option | Cost | User limit | Notes |
|---|---|---|---|
| Cloudflare Access | Free | **50 users** | Designed for staff tools, not players |
| Firebase Auth | Free | 10,000/month MAU | Fine, but adds Google dependency |
| Auth0 | Free | 7,500 MAU | Fine, but external service |
| **Custom in Worker (this approach)** | **Free** | **Unlimited** | No third-party, full control |
| Supabase Auth | Free | 50,000 MAU | Also good if you want a UI dashboard |

The custom Worker approach scales to millions of users on Cloudflare's free tier.

---

## Phase 4 — Leaderboards, Stats, and Device Tracking

### 4.1 Device detection

Add this helper to each game (or a shared `utils.js`):

```javascript
function getDeviceType() {
  return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
}
```

This is passed as `device_type` in every score submission and stored in the `scores` table.

### 4.2 Does device type affect game fairness?

**Yes, it matters** — log it and display it on the leaderboard:

- **Tap latency on mobile** is ~100–150ms slower than a mouse click on desktop due to touch detection delays
- **Screen size** affects hit-the-target and spot-the-pair difficulty
- **Reaction-time games** (Game 3, Game 6) are measurably harder on mobile

**Recommendation**: Show a device icon (📱 / 🖥) next to each leaderboard entry. Consider separate leaderboard tabs "Mobile" / "Desktop" / "All" — especially for Game 3 (Hit the Target) and Game 6 (Speed the Difference). This is fair to players and interesting data to display.

### 4.3 Leaderboard page integration

In each game's leaderboard section, fetch and render entries including device column:

```javascript
async function loadLeaderboard(gameId, date, deviceFilter) {
  let url = `https://api.clickzle.games/api/leaderboard?game=${gameId}&date=${date}&limit=50`;
  const res = await fetch(url);
  const data = await res.json();

  const entries = deviceFilter === 'all'
    ? data.entries
    : data.entries.filter(e => e.device_type === deviceFilter);

  const table = document.getElementById('leaderboardTable');
  table.innerHTML = entries.map((entry, i) => `
    <div class="lb-row ${i < 3 ? 'top-' + (i+1) : ''}">
      <span class="lb-rank">${entry.rank}</span>
      <span class="lb-name">
        ${escapeHtml(entry.name)}
        ${entry.is_registered ? '<span class="lb-badge">★</span>' : ''}
      </span>
      <span class="lb-device">${entry.device_type === 'mobile' ? '📱' : '🖥'}</span>
      <span class="lb-score">${entry.score.toLocaleString()}</span>
    </div>
  `).join('');
}
```

Add filter tabs above the leaderboard:
```html
<div class="lb-filter">
  <button class="lb-tab active" onclick="loadLeaderboard(gameId, today, 'all')">All</button>
  <button class="lb-tab" onclick="loadLeaderboard(gameId, today, 'desktop')">🖥 Desktop</button>
  <button class="lb-tab" onclick="loadLeaderboard(gameId, today, 'mobile')">📱 Mobile</button>
</div>
```

### 4.4 Wire up score submission to each game's end screen

In each game file, inside the existing `openModal('timeoutModal')` logic, call:

```javascript
const leaderboardData = await submitToLeaderboard(gameData);
if (leaderboardData) {
  document.getElementById('ecRank').textContent = '#' + leaderboardData.rank;
  document.getElementById('ecTotal').textContent = 'of ' + leaderboardData.total + ' players today';
}
```

---

## Phase 5 — Personal Best on Entry Screen

The exit screen already shows personal best. This phase adds it to the **start screen** as a motivational reminder before the player begins.

### 5.1 What to show

On the start screen / pre-game modal, just above the Play button, add:

```html
<div class="pb-reminder" id="pbReminder" style="display:none;">
  <span class="pb-label">Your best</span>
  <span class="pb-value" id="pbValue">—</span>
  <span class="pb-hint">Beat it today</span>
</div>
```

### 5.2 Populate it from localStorage

The games already track `st.bestScore` in localStorage. Read it before the start screen opens:

```javascript
function showPersonalBestOnStartScreen() {
  const st = JSON.parse(localStorage.getItem('czStats_game4') || '{}'); // change key per game
  const pb = st.bestScore;
  if (pb) {
    document.getElementById('pbValue').textContent = pb.toLocaleString();
    document.getElementById('pbReminder').style.display = 'flex';
  }
}
// Call this when the start screen renders
showPersonalBestOnStartScreen();
```

For logged-in users, you can also fetch their all-time best from `/api/my-scores` and show the highest score across all dates — but localStorage is instant and works offline.

---

## Phase 6 — Strong CTA on All Exit Screens

The share and invite buttons already exist. This phase makes them impossible to ignore.

### 6.1 Current state
- Share Result button → opens share modal
- Invite Friend button → copies invite link
- Both are present but passive — they sit below the score with no urgency

### 6.2 Changes to make

**Add a CTA headline above the buttons on every exit screen:**

```html
<!-- Replace the existing share/invite button row with this -->
<div class="ec-cta-block">
  <p class="ec-cta-headline">Think your friends can beat you?</p>
  <p class="ec-cta-sub">Challenge them — the daily puzzle resets at midnight.</p>
  <div class="ec-btn-row">
    <button class="share-btn" id="shareTimeoutBtn">
      <!-- existing share icon -->
      Share My Score
    </button>
    <button class="share-btn" id="inviteFriendBtn" style="background:var(--surface2);color:var(--text);border:1px solid var(--border);">
      <!-- existing invite icon -->
      Challenge a Friend
    </button>
  </div>
</div>
```

**CSS for the CTA block:**
```css
.ec-cta-block { text-align: center; padding: 4px 0 8px; }
.ec-cta-headline { font-family: 'Bebas Neue', sans-serif; font-size: 18px; letter-spacing: 1.5px; color: var(--text); margin: 0 0 4px; }
.ec-cta-sub { font-size: 12px; color: var(--text2); margin: 0 0 12px; }
```

**Also: after a player shares, show a confirmation nudge:**
```javascript
document.getElementById('shareTimeoutBtn').addEventListener('click', () => {
  openModal('shareModal');
  // After share modal closes, swap button text
  document.getElementById('shareTimeoutBtn').textContent = '✓ Shared! Dare them to beat you';
});
```

### 6.3 Apply to all games
This change must be made in:
- `games/game2/follow-the-pattern.html`
- `games/game3/hit-the-target.html`
- `games/game4/spot-the-pair.html`
- `games/game5/next-in-sequence.html`
- `games/game6/speed-the-difference.html`
- All Game 1 variants (movies, flags, food, landscapes, celebrities, buildings, animals, art)

---

## Phase 7 — Google AdSense

**Do this last.** AdSense requires:
- A live, publicly accessible site (Phase 1 must be done)
- Real content and active users (Phases 3–6 help)
- Manual review by Google (takes 1–14 days)

### 7.1 Apply for AdSense

1. Go to **adsense.google.com** → Sign up with your Google account
2. Enter `clickzle.games` as your site
3. Google will give you an **AdSense publisher code** (format: `ca-pub-XXXXXXXXXXXXXXXX`)
4. Paste the AdSense script tag into the `<head>` of every HTML page:

```html
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXXXXXXXXXXXXXX"
     crossorigin="anonymous"></script>
```

5. Wait for Google to approve your site (email notification)

### 7.2 Replace ad placeholder slots

Each game already has `.ad-slot` divs acting as placeholders. Replace them with real AdSense units.

**Current placeholder (example from spot-the-pair.html line 772):**
```html
<div class="ad-slot" id="adSlot">
  <span class="ad-slot-label">Clickzle Games</span>
  <span class="ad-slot-size">300 × 120</span>
</div>
```

**Replace with:**
```html
<div class="ad-slot" id="adSlot">
  <ins class="adsbygoogle"
       style="display:block;width:300px;height:120px;"
       data-ad-client="ca-pub-XXXXXXXXXXXXXXXX"
       data-ad-slot="PASTE_YOUR_AD_SLOT_ID_HERE"
       data-ad-format="fixed"></ins>
  <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
</div>
```

Each ad placement needs its own **Ad Slot ID** generated in your AdSense dashboard under **Ads → By ad unit → Display ads**.

### 7.3 Ad slot locations already in the codebase

There are two `.ad-slot` elements per game:
1. **In the game area** (line ~772 in spot-the-pair.html) — shown during gameplay
2. **In the exit/timeout modal** (line ~928 in spot-the-pair.html) — shown on the end screen

Both should be replaced with live AdSense units once approved.

### 7.4 AdSense policy notes
- Do not place ads in a way that obscures game content or forces accidental clicks
- The exit screen ad is ideal — players have finished their turn and are not mid-game
- Keep `display:none` on very small screens (already in the CSS at `.ad-slot { display: none; }` for small breakpoints) — AdSense does not penalise hidden ads if they're hidden due to screen size

---

## Phase 8 — Deploying Updates

### Push a game update
```bash
git add .
git commit -m "description of change"
git push
```
Cloudflare Pages auto-deploys within ~30 seconds.

### Update the Worker API
```bash
cd api
npx wrangler deploy
```

### Run a D1 query (e.g. check today's scores)
```bash
npx wrangler d1 execute clickzle-db --command="SELECT * FROM scores WHERE play_date='2024-03-28' ORDER BY score DESC LIMIT 10"
```

---

## Free Tier Limits

| Resource | Free limit | Exceeded action |
|---|---|---|
| Pages requests | Unlimited | Nothing — always free |
| Workers requests | 100,000/day | Requests fail with 429 — upgrade to $5/month for 10M/day |
| D1 reads | 5,000,000/day | Very hard to hit |
| D1 writes | 100,000/day | 100K score submissions/day = massive scale |
| KV reads | 100,000/day | Unlikely to hit |
| D1 storage | 5GB | ~10 million score rows free |
| User accounts | Unlimited | Stored in D1, no cap |

---

## Security Checklist

- **CORS** — Worker only accepts requests from `clickzle.games`
- **Rate limiting** — 3 submissions per IP per game per day
- **Input validation** — All fields validated and clamped
- **Score range** — Scores above 999,999 rejected
- **Name sanitisation** — Guest names capped at 30 chars, HTML-escaped before display
- **Passwords** — PBKDF2-hashed with random salt (100,000 iterations), never stored plain
- **Sessions** — 30-day expiry, invalidated on logout
- **No secrets in frontend** — Token stored in localStorage, never in source

---

## Master Checklist — Do These In Order

### Phase 1 — Hosting
- [ ] Create GitHub account at github.com
- [ ] Create new public repository named `clickzle` on GitHub
- [ ] Install Git on your computer (git-scm.com)
- [ ] Configure Git identity (`git config --global user.name/email`)
- [ ] Run `git init`, `git add .`, `git commit`, `git remote add origin`, `git push` in your clickzle folder
- [ ] Generate a GitHub Personal Access Token (for push auth) — save it securely
- [ ] Create Cloudflare account at dash.cloudflare.com
- [ ] Add `clickzle.games` to Cloudflare, update nameservers at registrar
- [ ] Wait for domain to activate (email confirmation)
- [ ] Connect Cloudflare Pages to the `clickzle` GitHub repo
- [ ] Set build command to blank, output directory to `/`
- [ ] Add `clickzle.games` and `www.clickzle.games` as custom domains in Pages
- [ ] Verify site is live at https://clickzle.games

### Phase 2 — Backend API
- [ ] Create D1 database named `clickzle-db`, note the Database ID
- [ ] Run the SQL schema (Phase 2.2) in D1 console
- [ ] Create KV namespaces `CLICKZLE_SEEDS` and `CLICKZLE_RATELIMIT`, note IDs
- [ ] Create `api/` folder in repo, install wrangler (`npm install -g wrangler`)
- [ ] Run `wrangler login`
- [ ] Create `api/wrangler.toml` — paste D1 and KV IDs, set JWT_SECRET
- [ ] Create `api/src/index.js` — paste Worker code from Phase 2.7
- [ ] Run `npx wrangler deploy`
- [ ] Add `api.clickzle.games` as custom domain in Worker triggers
- [ ] Test: `curl https://api.clickzle.games/api/leaderboard?game=4&date=TODAY`

### Phase 3 — Auth
- [ ] Add `auth.js` shared helper to repo
- [ ] Add login/register UI to each game's start screen
- [ ] Verify register → login → token stored in localStorage → passed on submit
- [ ] Test: register a user, submit a score, check D1 that user_id is populated

### Phase 4 — Leaderboards + Device Tracking
- [ ] Add `getDeviceType()` helper to each game
- [ ] Update `submitToLeaderboard()` in each game to include `device_type`
- [ ] Add rank/total display to exit screen (from API response)
- [ ] Build leaderboard page with device filter tabs (All / Desktop / Mobile)
- [ ] Test: play on mobile and desktop — confirm device_type differs in D1

### Phase 5 — Personal Best on Entry
- [ ] Add `.pb-reminder` HTML block to each game's start screen
- [ ] Add `showPersonalBestOnStartScreen()` call in each game
- [ ] Test: play a game, exit, restart — confirm PB shows on start screen

### Phase 6 — Exit Screen CTA
- [ ] Add `.ec-cta-block` CTA headline above share/invite buttons in all games
- [ ] Update share button text to be more action-oriented ("Share My Score", "Challenge a Friend")
- [ ] Add post-share confirmation nudge to share button handler
- [ ] Apply to all Game 1 variants (8 files) and Games 2–6

### Phase 7 — Google AdSense
- [ ] Apply for AdSense account at adsense.google.com using `clickzle.games`
- [ ] Paste AdSense `<script>` tag into `<head>` of all HTML files
- [ ] Wait for site approval from Google
- [ ] Create ad units in AdSense dashboard, note each Ad Slot ID
- [ ] Replace all `.ad-slot` placeholder divs with live `<ins class="adsbygoogle">` tags
- [ ] Test: confirm ads display on game page and exit screen
- [ ] Verify ads are hidden on very small screens (existing CSS already handles this)
