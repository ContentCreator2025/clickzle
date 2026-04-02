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
 *
 *   -- users table additions
 *   ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 1;
 *   ALTER TABLE users ADD COLUMN verify_token TEXT;
 *   ALTER TABLE users ADD COLUMN verify_token_expires INTEGER;
 *   ALTER TABLE users ADD COLUMN reset_token TEXT;
 *   ALTER TABLE users ADD COLUMN reset_token_expires INTEGER;
 *
 *   -- scores table: rename play_date → date_utc, add missing columns
 *   ALTER TABLE scores ADD COLUMN date_utc TEXT;
 *   UPDATE scores SET date_utc = play_date WHERE date_utc IS NULL;
 *   ALTER TABLE scores ADD COLUMN time_ms INTEGER;
 *   ALTER TABLE scores ADD COLUMN correct INTEGER DEFAULT 0;
 *   ALTER TABLE scores ADD COLUMN wrong INTEGER DEFAULT 0;
 *   ALTER TABLE scores ADD COLUMN combo_max INTEGER DEFAULT 0;
 *
 *   -- personal_bests table (create if not exists)
 *   CREATE TABLE IF NOT EXISTS personal_bests (
 *     user_id TEXT NOT NULL,
 *     game_id INTEGER NOT NULL,
 *     best_score INTEGER NOT NULL DEFAULT 0,
 *     best_date TEXT,
 *     games_played INTEGER NOT NULL DEFAULT 0,
 *     updated_at INTEGER NOT NULL DEFAULT 0
 *   );
 */

// ── CORS ───────────────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Key, X-Turnstile-Token',
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

  try {
    // Check if this is the user's FIRST score submission today (any game)
    const playedTodayRow = await env.DB.prepare(
      'SELECT COUNT(*) as n FROM scores WHERE user_id = ?1 AND date_utc = ?2'
    ).bind(userId, date).first();
    const isFirstToday = !playedTodayRow || playedTodayRow.n === 0;

    // Check for existing score for this user/game/date
    const existing = await env.DB.prepare(
      'SELECT id, score FROM scores WHERE user_id = ?1 AND game_id = ?2 AND date_utc = ?3'
    ).bind(userId, game_id, date).first();

    if (existing) {
      // Only update if new score is higher
      if (score > existing.score) {
        await env.DB.prepare(
          'UPDATE scores SET score=?1, time_ms=?2, accuracy=?3, pairs_found=?4, correct=?5, wrong=?6, combo_max=?7, device_type=?8, submitted_at=?9 WHERE id=?10'
        ).bind(score, time_ms || null, accuracy || null, pairs_found || 0, correct || 0, wrong || 0, combo_max || 0, device, now, existing.id).run();
      }
    } else {
      await env.DB.prepare(
        'INSERT INTO scores (id, user_id, game_id, date_utc, score, time_ms, accuracy, pairs_found, correct, wrong, combo_max, device_type, submitted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)'
      ).bind(id, userId, game_id, date, score, time_ms || null, accuracy || null, pairs_found || 0, correct || 0, wrong || 0, combo_max || 0, device, now).run();
    }

    // Update personal bests
    const existingPb = await env.DB.prepare(
      'SELECT best_score FROM personal_bests WHERE user_id = ?1 AND game_id = ?2'
    ).bind(userId, game_id).first();

    if (existingPb) {
      await env.DB.prepare(
        'UPDATE personal_bests SET best_score = CASE WHEN ?1 > best_score THEN ?1 ELSE best_score END, best_date = CASE WHEN ?1 > best_score THEN ?2 ELSE best_date END, games_played = games_played + 1, updated_at = ?3 WHERE user_id = ?4 AND game_id = ?5'
      ).bind(score, date, now, userId, game_id).run();
    } else {
      await env.DB.prepare(
        'INSERT INTO personal_bests (user_id, game_id, best_score, best_date, games_played, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)'
      ).bind(userId, game_id, score, date, now).run();
    }

    // ── STREAK + TOTALS ──────────────────────────────────────────────────────
    let updatedStreak = null;

    if (isFirstToday) {
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
      await env.DB.prepare(
        'UPDATE users SET total_games = total_games + 1, last_seen = ?1 WHERE id = ?2'
      ).bind(now, userId).run();
    }

    // Fetch the stored score and rank
    const stored = await env.DB.prepare(
      'SELECT score FROM scores WHERE user_id = ?1 AND game_id = ?2 AND date_utc = ?3'
    ).bind(userId, game_id, date).first();

    const rankScore = stored ? stored.score : score;

    const pos = await env.DB.prepare(
      'SELECT COUNT(*) + 1 as position FROM scores WHERE game_id = ?1 AND date_utc = ?2 AND score > ?3'
    ).bind(game_id, date, rankScore).first();

    return json({
      ok: true,
      position: pos?.position || null,
      date,
      score: rankScore,
      is_personal_best: score >= rankScore,
      streak: updatedStreak,
    });

  } catch (err) {
    return json({ error: 'Score save failed: ' + (err?.message || String(err)) }, 500);
  }
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

// ── BOT / LEADERBOARD SEED SYSTEM ─────────────────────────────────────────────
// 50 bot accounts — natural-looking names, no prefix. Identified only by their
// @clickzle.bot email (never visible to players). Cannot log in.
const BOT_USERS = [
  { username: 'pixelrex',    country: 'us' }, { username: 'neonkai',      country: 'gb' },
  { username: 'swiftzara',   country: 'de' }, { username: 'turbomax99',   country: 'fr' },
  { username: 'flashnova',   country: 'au' }, { username: 'darkorbit',    country: 'ca' },
  { username: 'stellar99',   country: 'br' }, { username: 'blazex',       country: 'jp' },
  { username: 'quickshot',   country: 'in' }, { username: 'echopulse',    country: 'es' },
  { username: 'vortex88',    country: 'nl' }, { username: 'hyperrun',     country: 'se' },
  { username: 'lasereye',    country: 'it' }, { username: 'novaspark',    country: 'pl' },
  { username: 'rapidbolt',   country: 'za' }, { username: 'gridjump',     country: 'mx' },
  { username: 'primeaim',    country: 'kr' }, { username: 'ultramax',     country: 'ar' },
  { username: 'neoglitch',   country: 'ng' }, { username: 'arcflash',     country: 'tr' },
  { username: 'speedrx',     country: 'us' }, { username: 'titanglow',    country: 'gb' },
  { username: 'byterider',   country: 'de' }, { username: 'edgestriker',  country: 'fr' },
  { username: 'deepscan',    country: 'au' }, { username: 'rawpower',     country: 'ca' },
  { username: 'sharpaim',    country: 'br' }, { username: 'codeblast',    country: 'jp' },
  { username: 'zerolag',     country: 'in' }, { username: 'truenorth',    country: 'es' },
  { username: 'ionburst',    country: 'nl' }, { username: 'datawave',     country: 'se' },
  { username: 'phasex99',    country: 'it' }, { username: 'nightowl',     country: 'pl' },
  { username: 'cloud777',    country: 'za' }, { username: 'redlaser',     country: 'mx' },
  { username: 'foxrunner',   country: 'kr' }, { username: 'stardash',     country: 'ar' },
  { username: 'brightkey',   country: 'ng' }, { username: 'coolloop',     country: 'tr' },
  { username: 'maxreflex',   country: 'us' }, { username: 'sunflare',     country: 'gb' },
  { username: 'bigbrain',    country: 'de' }, { username: 'voidzen',      country: 'fr' },
  { username: 'heatmapper',  country: 'au' }, { username: 'pinpoint',     country: 'ca' },
  { username: 'apexaim',     country: 'br' }, { username: 'turboeye',     country: 'jp' },
  { username: 'runquick',    country: 'in' }, { username: 'aceclick',     country: 'es' },
];

// Score ranges [min, max] per game_id — calibrated from real player data.
// Bots are intentionally middle-to-low so any decent player beats them.
const BOT_SCORE_RANGES = {
  2:  [800,  2800],   // Follow the Pattern  (real top: ~6,000)
  3:  [20000, 90000], // Hit the Target       (real top: ~170,000)
  4:  [800,  4000],   // Spot the Pair
  5:  [800,  3500],   // Next in Sequence
  11: [1500, 4500],   // CTI Movies           (real top: ~6,000–7,000)
  12: [1500, 4500],   // CTI Animals
  13: [1500, 4500],   // CTI Art
  14: [1500, 4500],   // CTI Flags
  15: [1500, 4500],   // CTI Food
  16: [1500, 4500],   // CTI Landscapes
  17: [1500, 4500],   // CTI Buildings
  18: [1500, 4500],   // CTI Celebrities
};

function rng(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// Per-game realistic field ranges — calibrated from real player data.
// time_ms means different things per game:
//   G3  = fastest single reaction (real: 246ms–400ms)
//   G4  = avg reaction time per pair (real: 364ms–481ms)
//   G11-18 = total time taken to solve puzzle (real: 122s–153s)
//   G2/G5 = not submitted by game, leave null
const BOT_GAME_PARAMS = {
  2:  { time: null,              correct: [3,15],   wrong: [0,5],    combo: [2,8],    pairs: null, accuracy: null },
  3:  { time: [280,1200],        correct: [20,80],  wrong: [2,15],   combo: [2,10],   pairs: null, accuracy: null },
  4:  { time: [500,3000],        correct: [8,30],   wrong: [2,12],   combo: [2,8],    pairs: [8,25], accuracy: [72,97] },
  5:  { time: null,              correct: [3,12],   wrong: [5,30],   combo: [200,800],pairs: [0,3], accuracy: [50,92] },
  11: { time: [80000,240000],    correct: [1,1],    wrong: [20,100], combo: null,     pairs: null, accuracy: null },
  12: { time: [80000,240000],    correct: [1,1],    wrong: [20,100], combo: null,     pairs: null, accuracy: null },
  13: { time: [80000,240000],    correct: [1,1],    wrong: [20,100], combo: null,     pairs: null, accuracy: null },
  14: { time: [80000,240000],    correct: [1,1],    wrong: [20,100], combo: null,     pairs: null, accuracy: null },
  15: { time: [80000,240000],    correct: [1,1],    wrong: [20,100], combo: null,     pairs: null, accuracy: null },
  16: { time: [80000,240000],    correct: [1,1],    wrong: [20,100], combo: null,     pairs: null, accuracy: null },
  17: { time: [80000,240000],    correct: [1,1],    wrong: [20,100], combo: null,     pairs: null, accuracy: null },
  18: { time: [80000,240000],    correct: [1,1],    wrong: [20,100], combo: null,     pairs: null, accuracy: null },
};

// Called by the cron trigger every day at midnight UTC, and by admin endpoints.
// submitted_at is spread randomly across the day so scores don't all land at midnight.
async function seedDailyBotScores(env) {
  const date     = todayUTC();
  const now      = Math.floor(Date.now() / 1000);
  const dayStart = Math.floor(new Date(date + 'T00:00:00Z').getTime() / 1000);
  const spreadEnd = Math.max(now, dayStart + 3600);

  const botsResult = await env.DB.prepare(
    "SELECT id FROM users WHERE email LIKE '%@clickzle.bot'"
  ).all();
  const bots = botsResult.results || [];
  if (!bots.length) return { seeded: 0, bots: 0 };

  let seeded = 0;
  for (const bot of bots) {
    for (const [gameIdStr, [min, max]] of Object.entries(BOT_SCORE_RANGES)) {
      if (Math.random() > 0.80) continue;
      const gameId = parseInt(gameIdStr);

      const existing = await env.DB.prepare(
        'SELECT id FROM scores WHERE user_id=?1 AND game_id=?2 AND date_utc=?3'
      ).bind(bot.id, gameId, date).first();
      if (existing) continue;

      const p           = BOT_GAME_PARAMS[gameId];
      const score       = rng(min, max);
      const timeMs      = p.time      ? rng(p.time[0], p.time[1])         : null;
      const correct     = p.correct   ? rng(p.correct[0], p.correct[1])   : 0;
      const wrong       = p.wrong     ? rng(p.wrong[0], p.wrong[1])       : 0;
      const combo       = p.combo     ? rng(p.combo[0], p.combo[1])       : 0;
      const pairs       = p.pairs     ? rng(p.pairs[0], p.pairs[1])       : 0;
      const accuracy    = p.accuracy  ? rng(p.accuracy[0], p.accuracy[1]) : null;
      const scoreId     = generateId();
      const submittedAt = rng(dayStart, spreadEnd);

      await env.DB.prepare(
        `INSERT INTO scores
           (id, user_id, game_id, date_utc, score, time_ms, accuracy, pairs_found,
            correct, wrong, combo_max, device_type, submitted_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)`
      ).bind(scoreId, bot.id, gameId, date, score, timeMs, accuracy, pairs,
             correct, wrong, combo, 'desktop', submittedAt).run();
      seeded++;
    }
  }
  return { seeded, bots: bots.length };
}

async function handleAdminSeedBots(request, env) {
  if (!checkAdminKey(request, env)) return json({ error: 'Unauthorised' }, 401);

  const now = Math.floor(Date.now() / 1000);
  let created = 0, skipped = 0;

  for (const bot of BOT_USERS) {
    const existing = await env.DB.prepare(
      'SELECT id FROM users WHERE username=?1'
    ).bind(bot.username).first();
    if (existing) { skipped++; continue; }

    const id = generateId();
    // Spread created_at over past 60 days so they look like real registrations
    const createdAt = now - rng(0, 5_184_000);
    await env.DB.prepare(
      `INSERT INTO users
         (id, username, email, password_hash, country, created_at, last_seen,
          device_type, email_verified, streak_days, best_streak, total_games)
       VALUES (?1,?2,?3,?4,?5,?6,?6,?7,1,?8,?9,?10)`
    ).bind(id, bot.username, `${bot.username}@clickzle.bot`, 'bot:no-login',
           bot.country, createdAt, 'desktop',
           rng(1, 30), rng(1, 45), rng(20, 200)).run();
    created++;
  }

  // Seed today's scores immediately
  const seed = await seedDailyBotScores(env);
  return json({ ok: true, bots_created: created, bots_skipped: skipped, scores_seeded: seed.seeded });
}

async function handleAdminSeedToday(request, env) {
  if (!checkAdminKey(request, env)) return json({ error: 'Unauthorised' }, 401);
  const result = await seedDailyBotScores(env);
  return json({ ok: true, ...result });
}

// Wipes all existing bot accounts + their scores and recreates fresh with correct names/ranges.
async function handleAdminResetBots(request, env) {
  if (!checkAdminKey(request, env)) return json({ error: 'Unauthorised' }, 401);

  // Delete all scores belonging to bot users
  await env.DB.prepare(
    "DELETE FROM scores WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@clickzle.bot')"
  ).run();
  await env.DB.prepare(
    "DELETE FROM personal_bests WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@clickzle.bot')"
  ).run();
  // Delete bot user accounts
  await env.DB.prepare("DELETE FROM users WHERE email LIKE '%@clickzle.bot'").run();

  // Recreate with new names
  const now = Math.floor(Date.now() / 1000);
  let created = 0;
  for (const bot of BOT_USERS) {
    const id = generateId();
    const createdAt = now - rng(0, 5_184_000);
    await env.DB.prepare(
      `INSERT INTO users
         (id, username, email, password_hash, country, created_at, last_seen,
          device_type, email_verified, streak_days, best_streak, total_games)
       VALUES (?1,?2,?3,?4,?5,?6,?6,?7,1,?8,?9,?10)`
    ).bind(id, bot.username, `${bot.username}@clickzle.bot`, 'bot:no-login',
           bot.country, createdAt, 'desktop',
           rng(1, 30), rng(1, 45), rng(20, 200)).run();
    created++;
  }

  const seed = await seedDailyBotScores(env);
  return json({ ok: true, deleted_and_recreated: created, scores_seeded: seed.seeded });
}

// ── ADMIN ─────────────────────────────────────────────────────────────────────
function checkAdminKey(request, env) {
  const key = request.headers.get('X-Admin-Key') || '';
  return env.ADMIN_KEY && key === env.ADMIN_KEY;
}

// Verifies a Cloudflare Turnstile token server-side.
// Returns true if valid, or if TURNSTILE_SECRET is not yet configured (graceful fallback).
async function verifyTurnstile(token, env) {
  if (!env.TURNSTILE_SECRET) return true; // not configured — skip check
  if (!token) return false;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token }),
    });
    const data = await res.json();
    return data.success === true;
  } catch {
    return false;
  }
}

async function handleAdminUsers(request, env) {
  if (!checkAdminKey(request, env)) return json({ error: 'Unauthorised' }, 401);
  const users = await env.DB.prepare(
    `SELECT u.id, u.username, u.email, u.email_verified, u.country,
            u.streak_days, u.best_streak, u.total_games,
            u.created_at, u.last_seen,
            (SELECT COUNT(*) FROM scores s WHERE s.user_id = u.id) AS score_count,
            (SELECT MAX(s.score) FROM scores s WHERE s.user_id = u.id) AS top_score,
            (SELECT s.date_utc FROM scores s WHERE s.user_id = u.id ORDER BY s.submitted_at DESC LIMIT 1) AS last_played
     FROM users u WHERE u.email NOT LIKE '%@clickzle.bot' ORDER BY u.created_at DESC`
  ).all();
  return json({ ok: true, users: users.results || [] });
}

async function handleAdminLookup(request, env) {
  if (!checkAdminKey(request, env)) return json({ error: 'Unauthorised' }, 401);
  const url   = new URL(request.url);
  const email = (url.searchParams.get('email') || '').trim().toLowerCase();
  const uname = (url.searchParams.get('username') || '').trim().toLowerCase();
  const uid   = (url.searchParams.get('id') || '').trim();
  if (!email && !uname && !uid) return json({ error: 'email, username, or id required' }, 400);

  const user = uid
    ? await env.DB.prepare('SELECT * FROM users WHERE id=?1').bind(uid).first()
    : email
    ? await env.DB.prepare('SELECT * FROM users WHERE LOWER(email)=?1').bind(email).first()
    : await env.DB.prepare('SELECT * FROM users WHERE LOWER(username)=?1').bind(uname).first();

  if (!user) return json({ ok: true, found: false });

  const [scores, pbs] = await Promise.all([
    env.DB.prepare('SELECT game_id, date_utc, score, time_ms, correct, wrong, submitted_at FROM scores WHERE user_id=?1 ORDER BY submitted_at DESC LIMIT 50').bind(user.id).all(),
    env.DB.prepare('SELECT game_id, best_score, best_date, games_played FROM personal_bests WHERE user_id=?1').bind(user.id).all(),
  ]);

  return json({
    ok: true, found: true,
    user: {
      id: user.id, username: user.username, email: user.email,
      email_verified: user.email_verified, country: user.country,
      streak_days: user.streak_days, best_streak: user.best_streak,
      total_games: user.total_games, created_at: user.created_at,
      last_seen: user.last_seen,
    },
    scores: scores.results || [],
    personal_bests: pbs.results || [],
  });
}

async function handleAdminVerify(request, env) {
  if (!checkAdminKey(request, env)) return json({ error: 'Unauthorised' }, 401);
  let body; try { body = await request.json(); } catch { return json({ error: 'Invalid body' }, 400); }
  const { user_id } = body || {};
  if (!user_id) return json({ error: 'user_id required' }, 400);
  await env.DB.prepare(
    'UPDATE users SET email_verified=1, verify_token=NULL, verify_token_expires=NULL WHERE id=?1'
  ).bind(user_id).run();
  return json({ ok: true, message: 'Email marked as verified' });
}

async function handleAdminDeleteScore(request, env) {
  if (!checkAdminKey(request, env)) return json({ error: 'Unauthorised' }, 401);
  let body; try { body = await request.json(); } catch { return json({ error: 'Invalid body' }, 400); }
  const { user_id, game_id, date_utc } = body || {};
  if (!user_id || !game_id || !date_utc) return json({ error: 'user_id, game_id, date_utc required' }, 400);
  await env.DB.prepare(
    'DELETE FROM scores WHERE user_id=?1 AND game_id=?2 AND date_utc=?3'
  ).bind(user_id, game_id, date_utc).run();
  return json({ ok: true, message: 'Score deleted' });
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
    if (path === '/api/admin/users'          && method === 'GET')    return handleAdminUsers(request, env);
    if (path === '/api/admin/lookup'         && method === 'GET')    return handleAdminLookup(request, env);
    if (path === '/api/admin/verify'         && method === 'POST')   return handleAdminVerify(request, env);
    if (path === '/api/admin/delete-score'   && method === 'POST')   return handleAdminDeleteScore(request, env);
    if (path === '/api/admin/seed-bots'      && method === 'POST')   return handleAdminSeedBots(request, env);
    if (path === '/api/admin/seed-today'     && method === 'POST')   return handleAdminSeedToday(request, env);
    if (path === '/api/admin/reset-bots'     && method === 'POST')   return handleAdminResetBots(request, env);
    return json({ error: 'Not found' }, 404);
  },

  // Runs every day at midnight UTC — seeds bot scores for all leaderboards
  async scheduled(event, env, ctx) {
    ctx.waitUntil(seedDailyBotScores(env));
  },
};
