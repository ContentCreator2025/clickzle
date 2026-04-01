/**
 * CLICKZLE AUTH WORKER
 * ─────────────────────────────────────────────────────────────────────────────
 * Endpoints:
 *   POST /api/auth/signup            — create account (sends verify email)
 *   POST /api/auth/login             — log in
 *   GET  /api/auth/me                — get current user (requires Bearer token)
 *   GET  /api/auth/check-username    — ?u=name → { available: bool }
 *   GET  /api/auth/check-email       — ?e=email → { available: bool }
 *   POST /api/auth/score             — submit a game score (requires Bearer token)
 *   DELETE /api/auth/score           — delete today's score for a game
 *   GET  /api/auth/personal-best     — ?game=1 → personal best for logged-in user
 *   PUT  /api/auth/update            — update email / country / password (requires Bearer token)
 *   GET  /api/leaderboard            — ?game=1&period=today|month|alltime&limit=100
 *   GET  /api/stats                  — site-wide stats
 *   POST /api/auth/forgot-password   — send password reset email
 *   POST /api/auth/reset-password    — validate token + set new password
 *   GET  /api/auth/verify-email      — ?token=... → mark email as verified
 *   POST /api/auth/resend-verify     — resend verification email (requires Bearer token)
 *
 * Environment variables (set via wrangler secret put):
 *   JWT_SECRET      — random 64-char secret string
 *   RESEND_API_KEY  — Resend.com API key for sending emails
 *   DB              — D1 database binding (set in wrangler.toml)
 *
 * DB MIGRATIONS REQUIRED (run once via Cloudflare dashboard or wrangler):
 *   ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 1;
 *   ALTER TABLE users ADD COLUMN verify_token TEXT;
 *   ALTER TABLE users ADD COLUMN verify_token_expires INTEGER;
 *   ALTER TABLE users ADD COLUMN reset_token TEXT;
 *   ALTER TABLE users ADD COLUMN reset_token_expires INTEGER;
 */

// ── CORS ───────────────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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

function generateToken() {
  // 32-byte hex token (64 chars)
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
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

function yesterdayUTC() {
  return new Date(Date.now() - 86400000).toISOString().slice(0, 10);
}

// ── EMAIL (Resend) ─────────────────────────────────────────────────────────────
async function sendEmail(env, { to, subject, html }) {
  if (!env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — email not sent');
    return { ok: false, error: 'Email service not configured' };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'Clickzle <noreply@clickzle.games>',
        to: [to],
        subject,
        html,
      }),
    });
    if (res.ok) return { ok: true };
    const err = await res.json().catch(() => ({}));
    return { ok: false, error: err.message || 'Send failed' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function emailTemplate(title, bodyHtml) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0d1a;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:40px 24px;">
    <div style="margin-bottom:32px;">
      <span style="font-family:Arial,Helvetica,sans-serif;font-size:26px;font-weight:900;letter-spacing:4px;color:#f0f0f0;">CLICK</span><span style="font-family:Arial,Helvetica,sans-serif;font-size:26px;font-weight:900;letter-spacing:4px;color:#4ade80;">ZLE</span>
    </div>
    <div style="background:#1a1a2e;border:1px solid #2a2a4a;border-radius:16px;padding:32px 28px;">
      <h2 style="margin:0 0 16px;font-size:20px;color:#f0f0f0;font-weight:700;">${title}</h2>
      ${bodyHtml}
    </div>
    <p style="margin:24px 0 0;font-size:11px;color:#555;text-align:center;">
      &copy; 2026 Clickzle &middot; <a href="https://clickzle.games/privacy.html" style="color:#555;">Privacy Policy</a>
    </p>
  </div>
</body>
</html>`;
}

// ── HANDLERS ──────────────────────────────────────────────────────────────────

async function handleSignup(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request body' }, 400); }

  const { username, email, password, country } = body || {};
  const cleanCountry = country && /^[a-z]{2}$/.test(country) ? country : null;

  if (!username || !email || !password)
    return json({ error: 'Username, email and password are required' }, 400);
  if (username.length < 3 || username.length > 16)
    return json({ error: 'Username must be 3–16 characters' }, 400);
  if (!/^[a-zA-Z0-9_-]+$/.test(username))
    return json({ error: 'Username may only contain letters, numbers, _ and -' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return json({ error: 'Please enter a valid email address' }, 400);
  if (password.length < 8)
    return json({ error: 'Password must be at least 8 characters' }, 400);

  const uname = username.toLowerCase();
  const uemail = email.toLowerCase();

  const byUsername = await env.DB.prepare('SELECT id FROM users WHERE username = ?1').bind(uname).first();
  if (byUsername) return json({ error: 'Username already taken — try another' }, 409);

  const byEmail = await env.DB.prepare('SELECT id FROM users WHERE email = ?1').bind(uemail).first();
  if (byEmail) return json({ error: 'An account with that email already exists' }, 409);

  const id = generateId();
  const passwordHash = await hashPassword(password);
  const now = Math.floor(Date.now() / 1000);
  const device = detectDevice(request);

  // Generate email verification token
  const verifyToken = generateToken();
  const verifyExpires = now + 86400; // 24 hours

  await env.DB.prepare(
    `INSERT INTO users (id, username, email, password_hash, country, created_at, last_seen, device_type, email_verified, verify_token, verify_token_expires)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7, 0, ?8, ?9)`
  ).bind(id, uname, uemail, passwordHash, cleanCountry, now, device, verifyToken, verifyExpires).run();

  // Send verification email
  const verifyUrl = `https://clickzle.games/verify-email.html?token=${verifyToken}`;
  await sendEmail(env, {
    to: uemail,
    subject: 'Verify your Clickzle account',
    html: emailTemplate('Verify your email address', `
      <p style="color:#b0b0b0;font-size:14px;line-height:1.6;margin:0 0 20px;">
        Hi <strong style="color:#f0f0f0;">${uname}</strong>, welcome to Clickzle!<br>
        Please verify your email address to activate your account and unlock the leaderboard.
      </p>
      <a href="${verifyUrl}" style="display:inline-block;background:#4ade80;color:#000;font-weight:700;font-size:14px;padding:14px 28px;border-radius:10px;text-decoration:none;margin-bottom:20px;">
        Verify My Email
      </a>
      <p style="color:#555;font-size:12px;margin:0;line-height:1.5;">
        This link expires in 24 hours. If you didn't create a Clickzle account, you can safely ignore this email.
      </p>
    `),
  });

  const token = await signJWT({ sub: id, username: uname }, env.JWT_SECRET);

  return json({
    ok: true,
    token,
    user: { id, username: uname, email: uemail },
    email_verification_sent: true,
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

  // Block login if email explicitly unverified (=== 0, not null/undefined for backwards compat)
  if (user.email_verified === 0) {
    return json({
      error: 'Please verify your email before logging in. Check your inbox — or use "Resend verification" below.',
      code: 'EMAIL_NOT_VERIFIED',
    }, 403);
  }

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
    'SELECT id, username, email, created_at, last_seen, country, total_games, streak_days, best_streak, email_verified FROM users WHERE id = ?1'
  ).bind(payload.sub).first();

  if (!user) return json({ error: 'Account not found' }, 404);

  const [pbs, recent] = await Promise.all([
    env.DB.prepare('SELECT game_id, best_score, games_played FROM personal_bests WHERE user_id = ?1').bind(user.id).all(),
    env.DB.prepare('SELECT game_id, score, date_utc, submitted_at FROM scores WHERE user_id = ?1 ORDER BY submitted_at DESC LIMIT 20').bind(user.id).all(),
  ]);

  return json({ ok: true, user, personal_bests: pbs.results || [], recent_scores: recent.results || [] });
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
  if (game_id < 1 || game_id > 18) return json({ error: 'Invalid game_id' }, 400);

  const userId = payload.sub;
  const date = todayUTC();
  const yesterday = yesterdayUTC();
  const now = Math.floor(Date.now() / 1000);
  const device = detectDevice(request);
  const id = generateId();

  // Check if this is the user's FIRST score submission today (any game) — before the upsert
  const playedTodayRow = await env.DB.prepare(
    'SELECT COUNT(*) as n FROM scores WHERE user_id = ?1 AND date_utc = ?2'
  ).bind(userId, date).first();
  const isFirstToday = !playedTodayRow || playedTodayRow.n === 0;

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

  // ── STREAK + TOTALS ──────────────────────────────────────────────────────────
  let updatedStreak = null;

  if (isFirstToday) {
    // Fetch user's current streak and check yesterday's activity in parallel
    const [user, playedYesterday] = await Promise.all([
      env.DB.prepare('SELECT streak_days, best_streak FROM users WHERE id = ?1').bind(userId).first(),
      env.DB.prepare('SELECT COUNT(*) as n FROM scores WHERE user_id = ?1 AND date_utc = ?2').bind(userId, yesterday).first(),
    ]);

    const currentStreak = user?.streak_days || 0;
    const newStreak = (playedYesterday?.n > 0) ? currentStreak + 1 : 1;
    const newBest = Math.max(newStreak, user?.best_streak || 0);
    updatedStreak = newStreak;

    await env.DB.prepare(
      'UPDATE users SET total_games = total_games + 1, streak_days = ?1, best_streak = ?2, last_seen = ?3 WHERE id = ?4'
    ).bind(newStreak, newBest, now, userId).run();
  } else {
    // Not first play today — just increment total_games and update last_seen
    await env.DB.prepare(
      'UPDATE users SET total_games = total_games + 1, last_seen = ?1 WHERE id = ?2'
    ).bind(now, userId).run();
  }

  // Fetch the actual stored score (may be a previous best, not this submission)
  const stored = await env.DB.prepare(
    'SELECT score FROM scores WHERE user_id = ?1 AND game_id = ?2 AND date_utc = ?3'
  ).bind(userId, game_id, date).first();

  const rankScore = stored ? stored.score : score;

  const pos = await env.DB.prepare(`
    SELECT COUNT(*) + 1 as position FROM scores
    WHERE game_id = ?1 AND date_utc = ?2 AND score > ?3
  `).bind(game_id, date, rankScore).first();

  return json({
    ok: true,
    position: pos?.position || null,
    date,
    score: rankScore,
    is_personal_best: score >= rankScore,
    streak: updatedStreak,
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

  const today = todayUTC();
  const [pb, todayRow] = await Promise.all([
    env.DB.prepare('SELECT best_score, best_date, games_played FROM personal_bests WHERE user_id = ?1 AND game_id = ?2').bind(payload.sub, gameId).first(),
    env.DB.prepare('SELECT 1 AS played FROM scores WHERE user_id = ?1 AND game_id = ?2 AND date_utc = ?3').bind(payload.sub, gameId, today).first(),
  ]);

  return json({
    ok: true,
    logged_in: true,
    username: payload.username,
    personal_best: pb || null,
    played_today: !!todayRow,
  });
}

async function handleLeaderboard(request, env) {
  const url = new URL(request.url);
  const gameId = parseInt(url.searchParams.get('game') || '0');
  const period = url.searchParams.get('period') || 'today';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 100);

  if (!gameId || gameId < 1 || gameId > 18)
    return json({ error: 'game parameter required (1–18)' }, 400);

  let dateFilter = '';
  if (period === 'today') {
    dateFilter = `AND s.date_utc = '${todayUTC()}'`;
  } else if (period === 'month') {
    const ym = todayUTC().slice(0, 7);
    dateFilter = `AND s.date_utc LIKE '${ym}%'`;
  }

  let query;
  if (period === 'today') {
    query = `
      SELECT
        u.username, u.country, u.device_type,
        u.streak_days,
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
        u.streak_days,
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
    `SELECT COUNT(DISTINCT s.user_id) AS n FROM scores s WHERE s.game_id = ?1 ${dateFilter}`
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

async function handleUpdateAccount(request, env) {
  const token = getBearerToken(request);
  if (!token) return json({ error: 'Authorisation required' }, 401);

  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) return json({ error: 'Token invalid or expired — please log in again' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request body' }, 400); }

  const { email, country, current_password, new_password } = body || {};

  const user = await env.DB.prepare(
    'SELECT id, username, email, password_hash FROM users WHERE id = ?1'
  ).bind(payload.sub).first();
  if (!user) return json({ error: 'Account not found' }, 404);

  const setClauses = [];
  const bindings   = [];
  let idx = 1;

  if (email !== undefined && email !== '') {
    const newEmail = email.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail))
      return json({ error: 'Please enter a valid email address' }, 400);
    if (newEmail !== user.email) {
      const taken = await env.DB.prepare(
        'SELECT id FROM users WHERE email = ?1 AND id != ?2'
      ).bind(newEmail, user.id).first();
      if (taken) return json({ error: 'That email address is already in use' }, 409);
      setClauses.push(`email = ?${idx++}`); bindings.push(newEmail);
      // New email requires re-verification
      const verifyToken = generateToken();
      const verifyExpires = Math.floor(Date.now() / 1000) + 86400;
      setClauses.push(`email_verified = 0, verify_token = ?${idx++}, verify_token_expires = ?${idx++}`);
      bindings.push(verifyToken, verifyExpires);
      // Send verification email
      const verifyUrl = `https://clickzle.games/verify-email.html?token=${verifyToken}`;
      await sendEmail(env, {
        to: newEmail,
        subject: 'Verify your new Clickzle email address',
        html: emailTemplate('Confirm your new email', `
          <p style="color:#b0b0b0;font-size:14px;line-height:1.6;margin:0 0 20px;">
            You changed your Clickzle email address. Please verify your new address to keep your account active.
          </p>
          <a href="${verifyUrl}" style="display:inline-block;background:#4ade80;color:#000;font-weight:700;font-size:14px;padding:14px 28px;border-radius:10px;text-decoration:none;margin-bottom:20px;">
            Verify New Email
          </a>
          <p style="color:#555;font-size:12px;margin:0;">This link expires in 24 hours.</p>
        `),
      });
    }
  }

  if (country !== undefined) {
    const clean = (country && /^[a-z]{2}$/.test(country)) ? country : null;
    setClauses.push(`country = ?${idx++}`); bindings.push(clean);
  }

  if (new_password !== undefined && new_password !== '') {
    if (!current_password)
      return json({ error: 'Current password is required to set a new password' }, 400);
    const valid = await verifyPassword(current_password, user.password_hash);
    if (!valid) return json({ error: 'Current password is incorrect' }, 401);
    if (new_password.length < 8)
      return json({ error: 'New password must be at least 8 characters' }, 400);
    const newHash = await hashPassword(new_password);
    setClauses.push(`password_hash = ?${idx++}`); bindings.push(newHash);
  }

  if (setClauses.length === 0)
    return json({ ok: true, message: 'No changes to save' });

  setClauses.push(`last_seen = ?${idx++}`);
  bindings.push(Math.floor(Date.now() / 1000));
  bindings.push(user.id);

  await env.DB.prepare(
    `UPDATE users SET ${setClauses.join(', ')} WHERE id = ?${idx}`
  ).bind(...bindings).run();

  const updated = await env.DB.prepare(
    'SELECT id, username, email, country FROM users WHERE id = ?1'
  ).bind(user.id).first();

  return json({ ok: true, user: updated });
}

async function handleForgotPassword(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request body' }, 400); }

  const { email } = body || {};
  if (!email) return json({ error: 'Email address is required' }, 400);

  const uemail = email.toLowerCase().trim();
  const user = await env.DB.prepare(
    'SELECT id, username, email FROM users WHERE email = ?1'
  ).bind(uemail).first();

  // Always respond with the same message — prevents email enumeration
  const okMsg = { ok: true, message: 'If that email is registered, a reset link is on its way.' };

  if (!user) return json(okMsg);

  const token = generateToken();
  const expires = Math.floor(Date.now() / 1000) + 3600; // 1 hour

  await env.DB.prepare(
    'UPDATE users SET reset_token = ?1, reset_token_expires = ?2 WHERE id = ?3'
  ).bind(token, expires, user.id).run();

  const resetUrl = `https://clickzle.games/reset-password.html?token=${token}`;

  await sendEmail(env, {
    to: user.email,
    subject: 'Reset your Clickzle password',
    html: emailTemplate('Reset your password', `
      <p style="color:#b0b0b0;font-size:14px;line-height:1.6;margin:0 0 20px;">
        Hi <strong style="color:#f0f0f0;">${user.username}</strong>,<br>
        We received a request to reset your Clickzle password. Click the button below to set a new one.
      </p>
      <a href="${resetUrl}" style="display:inline-block;background:#4ade80;color:#000;font-weight:700;font-size:14px;padding:14px 28px;border-radius:10px;text-decoration:none;margin-bottom:20px;">
        Reset Password
      </a>
      <p style="color:#555;font-size:12px;margin:0;line-height:1.5;">
        This link expires in <strong>1 hour</strong>. If you didn't request a password reset, you can safely ignore this email — your password won't change.
      </p>
    `),
  });

  return json(okMsg);
}

async function handleResetPassword(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request body' }, 400); }

  const { token, new_password } = body || {};
  if (!token || !new_password)
    return json({ error: 'Reset token and new password are required' }, 400);
  if (new_password.length < 8)
    return json({ error: 'Password must be at least 8 characters' }, 400);

  const now = Math.floor(Date.now() / 1000);
  const user = await env.DB.prepare(
    'SELECT id, username FROM users WHERE reset_token = ?1 AND reset_token_expires > ?2'
  ).bind(token, now).first();

  if (!user)
    return json({ error: 'This reset link is invalid or has expired. Please request a new one.' }, 400);

  const newHash = await hashPassword(new_password);
  await env.DB.prepare(
    'UPDATE users SET password_hash = ?1, reset_token = NULL, reset_token_expires = NULL WHERE id = ?2'
  ).bind(newHash, user.id).run();

  return json({ ok: true, message: 'Password updated successfully. You can now log in.' });
}

async function handleVerifyEmail(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) return json({ error: 'Verification token is required' }, 400);

  const now = Math.floor(Date.now() / 1000);
  const user = await env.DB.prepare(
    'SELECT id, username FROM users WHERE verify_token = ?1 AND (verify_token_expires IS NULL OR verify_token_expires > ?2)'
  ).bind(token, now).first();

  if (!user)
    return json({ error: 'This verification link is invalid or has expired. Please request a new one.' }, 400);

  await env.DB.prepare(
    'UPDATE users SET email_verified = 1, verify_token = NULL, verify_token_expires = NULL WHERE id = ?1'
  ).bind(user.id).run();

  return json({ ok: true, username: user.username, message: 'Email verified! You can now log in.' });
}

async function handleResendVerify(request, env) {
  const token = getBearerToken(request);
  if (!token) return json({ error: 'Authorisation required' }, 401);

  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) return json({ error: 'Token invalid or expired' }, 401);

  const user = await env.DB.prepare(
    'SELECT id, username, email, email_verified FROM users WHERE id = ?1'
  ).bind(payload.sub).first();

  if (!user) return json({ error: 'Account not found' }, 404);
  if (user.email_verified === 1) return json({ ok: true, message: 'Your email is already verified.' });

  const verifyToken = generateToken();
  const verifyExpires = Math.floor(Date.now() / 1000) + 86400;

  await env.DB.prepare(
    'UPDATE users SET verify_token = ?1, verify_token_expires = ?2 WHERE id = ?3'
  ).bind(verifyToken, verifyExpires, user.id).run();

  const verifyUrl = `https://clickzle.games/verify-email.html?token=${verifyToken}`;
  const result = await sendEmail(env, {
    to: user.email,
    subject: 'Verify your Clickzle account',
    html: emailTemplate('Verify your email address', `
      <p style="color:#b0b0b0;font-size:14px;line-height:1.6;margin:0 0 20px;">
        Hi <strong style="color:#f0f0f0;">${user.username}</strong>,<br>
        Here's your new verification link. Click below to verify your email address.
      </p>
      <a href="${verifyUrl}" style="display:inline-block;background:#4ade80;color:#000;font-weight:700;font-size:14px;padding:14px 28px;border-radius:10px;text-decoration:none;margin-bottom:20px;">
        Verify My Email
      </a>
      <p style="color:#555;font-size:12px;margin:0;">This link expires in 24 hours.</p>
    `),
  });

  if (!result.ok) return json({ error: 'Failed to send email. Please try again.' }, 500);
  return json({ ok: true, message: 'Verification email sent. Check your inbox.' });
}

async function handleStats(request, env) {
  const date = todayUTC();
  const [users, playersToday, gamesToday] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS n FROM users').first(),
    env.DB.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM scores WHERE date_utc = ?1').bind(date).first(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE date_utc = ?1').bind(date).first(),
  ]);
  return json({
    ok: true,
    registered_players: users?.n   || 0,
    players_today:      playersToday?.n || 0,
    games_today:        gamesToday?.n   || 0,
    date,
  });
}

async function handleDeleteScore(request, env) {
  const token = getBearerToken(request);
  if (!token) return json({ error: 'Authorisation required' }, 401);

  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) return json({ error: 'Token invalid or expired' }, 401);

  const url    = new URL(request.url);
  const gameId = parseInt(url.searchParams.get('game') || '0');
  if (!gameId || gameId < 1 || gameId > 18)
    return json({ error: 'game parameter required (1–18)' }, 400);

  const date = todayUTC();

  await env.DB.prepare(
    'DELETE FROM scores WHERE user_id = ?1 AND game_id = ?2 AND date_utc = ?3'
  ).bind(payload.sub, gameId, date).run();

  await env.DB.prepare(
    'UPDATE personal_bests SET games_played = MAX(0, games_played - 1) WHERE user_id = ?1 AND game_id = ?2'
  ).bind(payload.sub, gameId).run();

  return json({ ok: true, message: `Today's score for game ${gameId} deleted` });
}

// ── MAIN ROUTER ───────────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (path === '/api/auth/signup'          && method === 'POST')   return handleSignup(request, env);
    if (path === '/api/auth/login'           && method === 'POST')   return handleLogin(request, env);
    if (path === '/api/auth/me'              && method === 'GET')    return handleMe(request, env);
    if (path === '/api/auth/check-username'  && method === 'GET')    return handleCheckUsername(request, env);
    if (path === '/api/auth/check-email'     && method === 'GET')    return handleCheckEmail(request, env);
    if (path === '/api/auth/score'           && method === 'POST')   return handleSubmitScore(request, env);
    if (path === '/api/auth/score'           && method === 'DELETE') return handleDeleteScore(request, env);
    if (path === '/api/auth/personal-best'   && method === 'GET')    return handlePersonalBest(request, env);
    if (path === '/api/auth/update'          && method === 'PUT')    return handleUpdateAccount(request, env);
    if (path === '/api/auth/forgot-password' && method === 'POST')   return handleForgotPassword(request, env);
    if (path === '/api/auth/reset-password'  && method === 'POST')   return handleResetPassword(request, env);
    if (path === '/api/auth/verify-email'    && method === 'GET')    return handleVerifyEmail(request, env);
    if (path === '/api/auth/resend-verify'   && method === 'POST')   return handleResendVerify(request, env);
    if (path === '/api/leaderboard'          && method === 'GET')    return handleLeaderboard(request, env);
    if (path === '/api/stats'                && method === 'GET')    return handleStats(request, env);
    return json({ error: 'Not found' }, 404);
  },
};
