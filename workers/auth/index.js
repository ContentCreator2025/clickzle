/**
 * CLICKZLE AUTH WORKER
 * ─────────────────────────────────────────────────────────────────────────────
 * Endpoints:
 *   POST /api/auth/signup          — create account
 *   POST /api/auth/login           — log in
 *   GET  /api/auth/me              — get current user (requires Bearer token)
 *   GET  /api/auth/check-username  — ?u=name → { available: bool }
 *   GET  /api/auth/check-email     — ?e=email → { available: bool }
 *   POST /api/auth/score           — submit a game score (requires Bearer token)
 *   GET  /api/auth/personal-best   — ?game=1 → personal best for logged-in user
 *   GET  /api/leaderboard          — ?game=1&period=today|month|alltime&limit=100
 *
 * Environment variables (set via: wrangler secret put JWT_SECRET):
 *   JWT_SECRET  — random 64-char secret string
 *   DB          — D1 database binding (set in wrangler.toml)
 */

// ── CORS ───────────────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// ── PASSWORD HASHING (PBKDF2 via Web Crypto) ───────────────────────────────────
async function hashPassword(password) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const toHex = buf => Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:${toHex(salt)}:${toHex(new Uint8Array(bits))}`;
}

async function verifyPassword(password, stored) {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'pbkdf2') return false;
  const salt = new Uint8Array(parts[1].match(/.{2}/g).map(b => parseInt(b, 16)));
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const computed = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  return computed === parts[2];
}

// ── JWT (HMAC-SHA256 via Web Crypto) ──────────────────────────────────────────
function b64url(input) {
  const bytes = input instanceof Uint8Array ? input : new TextEncoder().encode(JSON.stringify(input));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64urlDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}

async function getHmacKey(secret) {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
}

async function signJWT(payload, secret, expiresInSec = 86400 * 30) {
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url({
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + expiresInSec,
  });
  const key = await getHmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${body}`));
  return `${header}.${body}.${b64url(new Uint8Array(sig))}`;
}

async function verifyJWT(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const key = await getHmacKey(secret);
    const valid = await crypto.subtle.verify(
      'HMAC', key,
      b64urlDecode(sig),
      new TextEncoder().encode(`${header}.${body}`)
    );
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── UTILITIES ─────────────────────────────────────────────────────────────────
function generateId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

function getBearerToken(request) {
  const auth = request.headers.get('Authorization') || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

function detectDevice(request) {
  const ua = (request.headers.get('User-Agent') || '').toLowerCase();
  return /mobi|android|iphone|ipad|ipod|blackberry|windows phone/i.test(ua) ? 'mobile' : 'desktop';
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

// ── HANDLERS ──────────────────────────────────────────────────────────────────

async function handleSignup(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request body' }, 400); }

  const { username, email, password } = body || {};

  // Validate
  if (!username || !email || !password)
    return json({ error: 'Username, email and password are required' }, 400);
  if (username.length < 3 || username.length > 20)
    return json({ error: 'Username must be 3–20 characters' }, 400);
  if (!/^[a-zA-Z0-9_-]+$/.test(username))
    return json({ error: 'Username may only contain letters, numbers, _ and -' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return json({ error: 'Please enter a valid email address' }, 400);
  if (password.length < 8)
    return json({ error: 'Password must be at least 8 characters' }, 400);

  const uname = username.toLowerCase();
  const uemail = email.toLowerCase();

  // Check username taken
  const byUsername = await env.DB.prepare(
    'SELECT id FROM users WHERE username = ?1'
  ).bind(uname).first();
  if (byUsername) return json({ error: 'Username already taken — try another' }, 409);

  // Check email taken
  const byEmail = await env.DB.prepare(
    'SELECT id FROM users WHERE email = ?1'
  ).bind(uemail).first();
  if (byEmail) return json({ error: 'An account with that email already exists' }, 409);

  // Create
  const id = generateId();
  const passwordHash = await hashPassword(password);
  const now = Math.floor(Date.now() / 1000);
  const device = detectDevice(request);

  await env.DB.prepare(
    `INSERT INTO users (id, username, email, password_hash, created_at, last_seen, device_type)
     VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6)`
  ).bind(id, uname, uemail, passwordHash, now, device).run();

  const token = await signJWT({ sub: id, username: uname }, env.JWT_SECRET);

  return json({
    ok: true,
    token,
    user: { id, username: uname, email: uemail },
  }, 201);
}

async function handleLogin(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request body' }, 400); }

  const { identifier, password } = body || {};
  if (!identifier || !password)
    return json({ error: 'Username/email and password are required' }, 400);

  const id = identifier.toLowerCase().trim();
  const user = await env.DB.prepare(
    'SELECT * FROM users WHERE username = ?1 OR email = ?1 LIMIT 1'
  ).bind(id).first();

  if (!user) return json({ error: 'No account found with that username or email' }, 401);

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return json({ error: 'Incorrect password' }, 401);

  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare('UPDATE users SET last_seen = ?1 WHERE id = ?2')
    .bind(now, user.id).run();

  const token = await signJWT({ sub: user.id, username: user.username }, env.JWT_SECRET);

  return json({
    ok: true,
    token,
    user: { id: user.id, username: user.username, email: user.email },
  });
}

async function handleMe(request, env) {
  const token = getBearerToken(request);
  if (!token) return json({ error: 'Authorisation required' }, 401);

  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) return json({ error: 'Token invalid or expired — please log in again' }, 401);

  const user = await env.DB.prepare(
    'SELECT id, username, email, created_at, last_seen, country, total_games, streak_days, best_streak FROM users WHERE id = ?1'
  ).bind(payload.sub).first();

  if (!user) return json({ error: 'Account not found' }, 404);

  // Fetch personal bests for all games
  const pbs = await env.DB.prepare(
    'SELECT game_id, best_score, games_played FROM personal_bests WHERE user_id = ?1'
  ).bind(user.id).all();

  return json({ ok: true, user, personal_bests: pbs.results || [] });
}

async function handleCheckUsername(request, env) {
  const url = new URL(request.url);
  const u = (url.searchParams.get('u') || '').toLowerCase().trim();
  if (u.length < 3) return json({ available: false, reason: 'too_short' });
  if (!/^[a-zA-Z0-9_-]+$/.test(u)) return json({ available: false, reason: 'invalid_chars' });
  const row = await env.DB.prepare('SELECT id FROM users WHERE username = ?1').bind(u).first();
  return json({ available: !row });
}

async function handleCheckEmail(request, env) {
  const url = new URL(request.url);
  const e = (url.searchParams.get('e') || '').toLowerCase().trim();
  if (!e) return json({ available: false });
  const row = await env.DB.prepare('SELECT id FROM users WHERE email = ?1').bind(e).first();
  return json({ available: !row });
}

async function handleSubmitScore(request, env) {
  const token = getBearerToken(request);
  if (!token) return json({ error: 'Authorisation required' }, 401);

  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) return json({ error: 'Token invalid or expired' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request body' }, 400); }

  const { game_id, score, time_ms, accuracy, pairs_found, correct, wrong, combo_max } = body || {};
  if (!game_id || score == null) return json({ error: 'game_id and score are required' }, 400);
  if (game_id < 1 || game_id > 5) return json({ error: 'Invalid game_id' }, 400);

  const userId = payload.sub;
  const date = todayUTC();
  const now = Math.floor(Date.now() / 1000);
  const device = detectDevice(request);
  const id = generateId();

  // Upsert score — only update if new score is higher
  await env.DB.prepare(`
    INSERT INTO scores (id, user_id, game_id, date_utc, score, time_ms, accuracy, pairs_found, correct, wrong, combo_max, device_type, submitted_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
    ON CONFLICT(user_id, game_id, date_utc)
    DO UPDATE SET
      score        = CASE WHEN excluded.score > score THEN excluded.score ELSE score END,
      time_ms      = CASE WHEN excluded.score > score THEN excluded.time_ms ELSE time_ms END,
      accuracy     = CASE WHEN excluded.score > score THEN excluded.accuracy ELSE accuracy END,
      pairs_found  = CASE WHEN excluded.score > score THEN excluded.pairs_found ELSE pairs_found END,
      correct      = CASE WHEN excluded.score > score THEN excluded.correct ELSE correct END,
      wrong        = CASE WHEN excluded.score > score THEN excluded.wrong ELSE wrong END,
      combo_max    = CASE WHEN excluded.score > score THEN excluded.combo_max ELSE combo_max END,
      device_type  = CASE WHEN excluded.score > score THEN excluded.device_type ELSE device_type END,
      submitted_at = CASE WHEN excluded.score > score THEN excluded.submitted_at ELSE submitted_at END
  `).bind(
    id, userId, game_id, date,
    score, time_ms || null, accuracy || null,
    pairs_found || 0, correct || 0, wrong || 0, combo_max || 0,
    device, now
  ).run();

  // Update personal bests
  await env.DB.prepare(`
    INSERT INTO personal_bests (user_id, game_id, best_score, best_date, games_played, updated_at)
    VALUES (?1, ?2, ?3, ?4, 1, ?5)
    ON CONFLICT(user_id, game_id)
    DO UPDATE SET
      best_score   = CASE WHEN excluded.best_score > best_score THEN excluded.best_score ELSE best_score END,
      best_date    = CASE WHEN excluded.best_score > best_score THEN excluded.best_date ELSE best_date END,
      games_played = games_played + 1,
      updated_at   = excluded.updated_at
  `).bind(userId, game_id, score, date, now).run();

  // Update user totals
  await env.DB.prepare(
    'UPDATE users SET total_games = total_games + 1, last_seen = ?1 WHERE id = ?2'
  ).bind(now, userId).run();

  // Fetch leaderboard position for today
  const pos = await env.DB.prepare(`
    SELECT COUNT(*) + 1 as position FROM scores
    WHERE game_id = ?1 AND date_utc = ?2 AND score > ?3
  `).bind(game_id, date, score).first();

  return json({
    ok: true,
    position: pos?.position || null,
    date,
    score,
  });
}

async function handlePersonalBest(request, env) {
  const token = getBearerToken(request);
  if (!token) return json({ ok: false, logged_in: false });

  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) return json({ ok: false, logged_in: false });

  const url = new URL(request.url);
  const gameId = parseInt(url.searchParams.get('game') || '0');
  if (!gameId) return json({ error: 'game parameter required' }, 400);

  const pb = await env.DB.prepare(
    'SELECT best_score, best_date, games_played FROM personal_bests WHERE user_id = ?1 AND game_id = ?2'
  ).bind(payload.sub, gameId).first();

  return json({
    ok: true,
    logged_in: true,
    username: payload.username,
    personal_best: pb || null,
  });
}

async function handleLeaderboard(request, env) {
  const url = new URL(request.url);
  const gameId = parseInt(url.searchParams.get('game') || '0');
  const period = url.searchParams.get('period') || 'today';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 100);

  if (!gameId || gameId < 1 || gameId > 5)
    return json({ error: 'game parameter required (1–5)' }, 400);

  let dateFilter = '';
  if (period === 'today') {
    dateFilter = `AND s.date_utc = '${todayUTC()}'`;
  } else if (period === 'month') {
    const ym = todayUTC().slice(0, 7);
    dateFilter = `AND s.date_utc LIKE '${ym}%'`;
  }
  // 'alltime' — no filter

  // For month/alltime, aggregate best score per user
  let query;
  if (period === 'today') {
    query = `
      SELECT
        u.username, u.country, u.device_type,
        s.score, s.time_ms, s.accuracy,
        s.pairs_found, s.correct, s.wrong, s.combo_max,
        s.device_type AS play_device,
        s.date_utc
      FROM scores s
      JOIN users u ON u.id = s.user_id
      WHERE s.game_id = ?1 ${dateFilter}
      ORDER BY s.score DESC, s.time_ms ASC
      LIMIT ?2
    `;
  } else {
    query = `
      SELECT
        u.username, u.country,
        MAX(s.score) AS score,
        MIN(s.time_ms) AS time_ms,
        AVG(s.accuracy) AS accuracy,
        MAX(s.pairs_found) AS pairs_found,
        MAX(s.correct) AS correct,
        MIN(s.wrong) AS wrong,
        MAX(s.combo_max) AS combo_max,
        u.device_type AS play_device
      FROM scores s
      JOIN users u ON u.id = s.user_id
      WHERE s.game_id = ?1 ${dateFilter}
      GROUP BY s.user_id
      ORDER BY score DESC, time_ms ASC
      LIMIT ?2
    `;
  }

  const rows = await env.DB.prepare(query).bind(gameId, limit).all();
  const total = await env.DB.prepare(
    `SELECT COUNT(DISTINCT user_id) AS n FROM scores WHERE game_id = ?1 ${dateFilter}`
  ).bind(gameId).first();

  return json({
    ok: true,
    game_id: gameId,
    period,
    date: todayUTC(),
    total_players: total?.n || 0,
    rows: rows.results || [],
  });
}

// ── MAIN ROUTER ───────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    // Pre-flight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (path === '/api/auth/signup'         && method === 'POST') return handleSignup(request, env);
    if (path === '/api/auth/login'          && method === 'POST') return handleLogin(request, env);
    if (path === '/api/auth/me'             && method === 'GET')  return handleMe(request, env);
    if (path === '/api/auth/check-username' && method === 'GET')  return handleCheckUsername(request, env);
    if (path === '/api/auth/check-email'    && method === 'GET')  return handleCheckEmail(request, env);
    if (path === '/api/auth/score'          && method === 'POST') return handleSubmitScore(request, env);
    if (path === '/api/auth/personal-best'  && method === 'GET')  return handlePersonalBest(request, env);
    if (path === '/api/leaderboard'         && method === 'GET')  return handleLeaderboard(request, env);

    return json({ error: 'Not found' }, 404);
  },
};
