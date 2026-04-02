var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// index.js
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400"
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
  });
}
__name(json, "json");
async function hashPassword(password) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 1e5, hash: "SHA-256" },
    keyMaterial,
    256
  );
  const toHex = /* @__PURE__ */ __name((buf) => Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join(""), "toHex");
  return `pbkdf2:${toHex(salt)}:${toHex(new Uint8Array(bits))}`;
}
__name(hashPassword, "hashPassword");
async function verifyPassword(password, stored) {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "pbkdf2") return false;
  const salt = new Uint8Array(parts[1].match(/.{2}/g).map((b) => parseInt(b, 16)));
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 1e5, hash: "SHA-256" },
    keyMaterial,
    256
  );
  const computed = Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return computed === parts[2];
}
__name(verifyPassword, "verifyPassword");
function b64url(input) {
  const bytes = input instanceof Uint8Array ? input : new TextEncoder().encode(JSON.stringify(input));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
__name(b64url, "b64url");
function b64urlDecode(str) {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
__name(b64urlDecode, "b64urlDecode");
async function getHmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}
__name(getHmacKey, "getHmacKey");
async function signJWT(payload, secret, expiresInSec = 86400 * 30) {
  const header = b64url({ alg: "HS256", typ: "JWT" });
  const body = b64url({
    ...payload,
    iat: Math.floor(Date.now() / 1e3),
    exp: Math.floor(Date.now() / 1e3) + expiresInSec
  });
  const key = await getHmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${body}`));
  return `${header}.${body}.${b64url(new Uint8Array(sig))}`;
}
__name(signJWT, "signJWT");
async function verifyJWT(token, secret) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const key = await getHmacKey(secret);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      b64urlDecode(sig),
      new TextEncoder().encode(`${header}.${body}`)
    );
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
    if (payload.exp < Math.floor(Date.now() / 1e3)) return null;
    return payload;
  } catch {
    return null;
  }
}
__name(verifyJWT, "verifyJWT");
function generateId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16))).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(generateId, "generateId");
function generateToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(generateToken, "generateToken");
function getBearerToken(request) {
  const auth = request.headers.get("Authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}
__name(getBearerToken, "getBearerToken");
function detectDevice(request) {
  const ua = (request.headers.get("User-Agent") || "").toLowerCase();
  return /mobi|android|iphone|ipad|ipod|blackberry|windows phone/i.test(ua) ? "mobile" : "desktop";
}
__name(detectDevice, "detectDevice");
function todayUTC() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
__name(todayUTC, "todayUTC");
function yesterdayUTC() {
  return new Date(Date.now() - 864e5).toISOString().slice(0, 10);
}
__name(yesterdayUTC, "yesterdayUTC");
async function sendEmail(env, { to, subject, html }) {
  if (!env.RESEND_API_KEY) {
    console.warn("RESEND_API_KEY not set \u2014 email not sent");
    return { ok: false, error: "Email service not configured" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: "Clickzle <noreply@clickzle.games>",
        to: [to],
        subject,
        html
      })
    });
    if (res.ok) return { ok: true };
    const err = await res.json().catch(() => ({}));
    return { ok: false, error: err.message || "Send failed" };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
__name(sendEmail, "sendEmail");
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
__name(emailTemplate, "emailTemplate");
async function handleSignup(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const { username, email, password, country } = body || {};
  const cleanCountry = country && /^[a-z]{2}$/.test(country) ? country : null;
  if (!username || !email || !password)
    return json({ error: "Username, email and password are required" }, 400);
  if (username.length < 3 || username.length > 16)
    return json({ error: "Username must be 3\u201316 characters" }, 400);
  if (!/^[a-zA-Z0-9_-]+$/.test(username))
    return json({ error: "Username may only contain letters, numbers, _ and -" }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return json({ error: "Please enter a valid email address" }, 400);
  if (password.length < 8)
    return json({ error: "Password must be at least 8 characters" }, 400);
  const uname = username.toLowerCase();
  const uemail = email.toLowerCase();
  const byUsername = await env.DB.prepare("SELECT id FROM users WHERE username = ?1").bind(uname).first();
  if (byUsername) return json({ error: "Username already taken \u2014 try another" }, 409);
  const byEmail = await env.DB.prepare("SELECT id FROM users WHERE email = ?1").bind(uemail).first();
  if (byEmail) return json({ error: "An account with that email already exists" }, 409);
  const id = generateId();
  const passwordHash = await hashPassword(password);
  const now = Math.floor(Date.now() / 1e3);
  const device = detectDevice(request);
  const verifyToken = generateToken();
  const verifyExpires = now + 86400;
  await env.DB.prepare(
    `INSERT INTO users (id, username, email, password_hash, country, created_at, last_seen, device_type, email_verified, verify_token, verify_token_expires)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7, 0, ?8, ?9)`
  ).bind(id, uname, uemail, passwordHash, cleanCountry, now, device, verifyToken, verifyExpires).run();
  const verifyUrl = `https://clickzle.games/verify-email.html?token=${verifyToken}`;
  await sendEmail(env, {
    to: uemail,
    subject: "Verify your Clickzle account",
    html: emailTemplate("Verify your email address", `
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
    `)
  });
  const token = await signJWT({ sub: id, username: uname }, env.JWT_SECRET);
  return json({
    ok: true,
    token,
    user: { id, username: uname, email: uemail },
    email_verification_sent: true
  }, 201);
}
__name(handleSignup, "handleSignup");
async function handleLogin(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const { identifier, password } = body || {};
  if (!identifier || !password)
    return json({ error: "Username/email and password are required" }, 400);
  const id = identifier.toLowerCase().trim();
  const user = await env.DB.prepare(
    "SELECT * FROM users WHERE username = ?1 OR email = ?1 LIMIT 1"
  ).bind(id).first();
  if (!user) return json({ error: "No account found with that username or email" }, 401);
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return json({ error: "Incorrect password" }, 401);
  if (user.email_verified === 0) {
    return json({
      error: 'Please verify your email before logging in. Check your inbox \u2014 or use "Resend verification" below.',
      code: "EMAIL_NOT_VERIFIED"
    }, 403);
  }
  const now = Math.floor(Date.now() / 1e3);
  await env.DB.prepare("UPDATE users SET last_seen = ?1 WHERE id = ?2").bind(now, user.id).run();
  const token = await signJWT({ sub: user.id, username: user.username }, env.JWT_SECRET);
  return json({
    ok: true,
    token,
    user: { id: user.id, username: user.username, email: user.email }
  });
}
__name(handleLogin, "handleLogin");
async function handleMe(request, env) {
  const token = getBearerToken(request);
  if (!token) return json({ error: "Authorisation required" }, 401);
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) return json({ error: "Token invalid or expired \u2014 please log in again" }, 401);
  const user = await env.DB.prepare(
    "SELECT id, username, email, created_at, last_seen, country, total_games, streak_days, best_streak, email_verified FROM users WHERE id = ?1"
  ).bind(payload.sub).first();
  if (!user) return json({ error: "Account not found" }, 404);
  const [pbs, recent] = await Promise.all([
    env.DB.prepare("SELECT game_id, best_score, games_played FROM personal_bests WHERE user_id = ?1").bind(user.id).all(),
    env.DB.prepare("SELECT game_id, score, date_utc, submitted_at FROM scores WHERE user_id = ?1 ORDER BY submitted_at DESC LIMIT 20").bind(user.id).all()
  ]);
  return json({ ok: true, user, personal_bests: pbs.results || [], recent_scores: recent.results || [] });
}
__name(handleMe, "handleMe");
async function handleCheckUsername(request, env) {
  const url = new URL(request.url);
  const u = (url.searchParams.get("u") || "").toLowerCase().trim();
  if (u.length < 3) return json({ available: false, reason: "too_short" });
  if (!/^[a-zA-Z0-9_-]+$/.test(u)) return json({ available: false, reason: "invalid_chars" });
  const row = await env.DB.prepare("SELECT id FROM users WHERE username = ?1").bind(u).first();
  return json({ available: !row });
}
__name(handleCheckUsername, "handleCheckUsername");
async function handleCheckEmail(request, env) {
  const url = new URL(request.url);
  const e = (url.searchParams.get("e") || "").toLowerCase().trim();
  if (!e) return json({ available: false });
  const row = await env.DB.prepare("SELECT id FROM users WHERE email = ?1").bind(e).first();
  return json({ available: !row });
}
__name(handleCheckEmail, "handleCheckEmail");
async function handleSubmitScore(request, env) {
  const token = getBearerToken(request);
  if (!token) return json({ error: "Authorisation required" }, 401);
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) return json({ error: "Token invalid or expired" }, 401);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const { game_id, score, time_ms, accuracy, pairs_found, correct, wrong, combo_max } = body || {};
  if (!game_id || score == null) return json({ error: "game_id and score are required" }, 400);
  if (game_id < 1 || game_id > 18) return json({ error: "Invalid game_id" }, 400);
  const userId = payload.sub;
  const date = todayUTC();
  const yesterday = yesterdayUTC();
  const now = Math.floor(Date.now() / 1e3);
  const device = detectDevice(request);
  const id = generateId();
  try {
    const playedTodayRow = await env.DB.prepare(
      "SELECT COUNT(*) as n FROM scores WHERE user_id = ?1 AND date_utc = ?2"
    ).bind(userId, date).first();
    const isFirstToday = !playedTodayRow || playedTodayRow.n === 0;
    const existing = await env.DB.prepare(
      "SELECT id, score FROM scores WHERE user_id = ?1 AND game_id = ?2 AND date_utc = ?3"
    ).bind(userId, game_id, date).first();
    if (existing) {
      if (score > existing.score) {
        await env.DB.prepare(
          "UPDATE scores SET score=?1, time_ms=?2, accuracy=?3, pairs_found=?4, correct=?5, wrong=?6, combo_max=?7, device_type=?8, submitted_at=?9 WHERE id=?10"
        ).bind(score, time_ms || null, accuracy || null, pairs_found || 0, correct || 0, wrong || 0, combo_max || 0, device, now, existing.id).run();
      }
    } else {
      await env.DB.prepare(
        "INSERT INTO scores (id, user_id, game_id, date_utc, score, time_ms, accuracy, pairs_found, correct, wrong, combo_max, device_type, submitted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)"
      ).bind(id, userId, game_id, date, score, time_ms || null, accuracy || null, pairs_found || 0, correct || 0, wrong || 0, combo_max || 0, device, now).run();
    }
    const existingPb = await env.DB.prepare(
      "SELECT best_score FROM personal_bests WHERE user_id = ?1 AND game_id = ?2"
    ).bind(userId, game_id).first();
    if (existingPb) {
      await env.DB.prepare(
        "UPDATE personal_bests SET best_score = CASE WHEN ?1 > best_score THEN ?1 ELSE best_score END, best_date = CASE WHEN ?1 > best_score THEN ?2 ELSE best_date END, games_played = games_played + 1, updated_at = ?3 WHERE user_id = ?4 AND game_id = ?5"
      ).bind(score, date, now, userId, game_id).run();
    } else {
      await env.DB.prepare(
        "INSERT INTO personal_bests (user_id, game_id, best_score, best_date, games_played, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)"
      ).bind(userId, game_id, score, date, now).run();
    }
    let updatedStreak = null;
    if (isFirstToday) {
      const [user, playedYesterday] = await Promise.all([
        env.DB.prepare("SELECT streak_days, best_streak FROM users WHERE id = ?1").bind(userId).first(),
        env.DB.prepare("SELECT COUNT(*) as n FROM scores WHERE user_id = ?1 AND date_utc = ?2").bind(userId, yesterday).first()
      ]);
      const currentStreak = user?.streak_days || 0;
      const newStreak = playedYesterday?.n > 0 ? currentStreak + 1 : 1;
      const newBest = Math.max(newStreak, user?.best_streak || 0);
      updatedStreak = newStreak;
      await env.DB.prepare(
        "UPDATE users SET total_games = total_games + 1, streak_days = ?1, best_streak = ?2, last_seen = ?3 WHERE id = ?4"
      ).bind(newStreak, newBest, now, userId).run();
    } else {
      await env.DB.prepare(
        "UPDATE users SET total_games = total_games + 1, last_seen = ?1 WHERE id = ?2"
      ).bind(now, userId).run();
    }
    const stored = await env.DB.prepare(
      "SELECT score FROM scores WHERE user_id = ?1 AND game_id = ?2 AND date_utc = ?3"
    ).bind(userId, game_id, date).first();
    const rankScore = stored ? stored.score : score;
    const pos = await env.DB.prepare(
      "SELECT COUNT(*) + 1 as position FROM scores WHERE game_id = ?1 AND date_utc = ?2 AND score > ?3"
    ).bind(game_id, date, rankScore).first();
    return json({
      ok: true,
      position: pos?.position || null,
      date,
      score: rankScore,
      is_personal_best: score >= rankScore,
      streak: updatedStreak
    });
  } catch (err) {
    return json({ error: "Score save failed: " + (err?.message || String(err)) }, 500);
  }
}
__name(handleSubmitScore, "handleSubmitScore");
async function handlePersonalBest(request, env) {
  const token = getBearerToken(request);
  if (!token) return json({ ok: false, logged_in: false });
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) return json({ ok: false, logged_in: false });
  const url = new URL(request.url);
  const gameId = parseInt(url.searchParams.get("game") || "0");
  if (!gameId) return json({ error: "game parameter required" }, 400);
  const today = todayUTC();
  const [pb, todayRow] = await Promise.all([
    env.DB.prepare("SELECT best_score, best_date, games_played FROM personal_bests WHERE user_id = ?1 AND game_id = ?2").bind(payload.sub, gameId).first(),
    env.DB.prepare("SELECT 1 AS played FROM scores WHERE user_id = ?1 AND game_id = ?2 AND date_utc = ?3").bind(payload.sub, gameId, today).first()
  ]);
  return json({
    ok: true,
    logged_in: true,
    username: payload.username,
    personal_best: pb || null,
    played_today: !!todayRow
  });
}
__name(handlePersonalBest, "handlePersonalBest");
async function handleLeaderboard(request, env) {
  const url = new URL(request.url);
  const gameId = parseInt(url.searchParams.get("game") || "0");
  const period = url.searchParams.get("period") || "today";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "10"), 100);
  if (!gameId || gameId < 1 || gameId > 18)
    return json({ error: "game parameter required (1\u201318)" }, 400);
  let dateFilter = "";
  if (period === "today") {
    dateFilter = `AND s.date_utc = '${todayUTC()}'`;
  } else if (period === "month") {
    const ym = todayUTC().slice(0, 7);
    dateFilter = `AND s.date_utc LIKE '${ym}%'`;
  }
  let query;
  if (period === "today") {
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
    rows: rows.results || []
  });
}
__name(handleLeaderboard, "handleLeaderboard");
async function handleUpdateAccount(request, env) {
  const token = getBearerToken(request);
  if (!token) return json({ error: "Authorisation required" }, 401);
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) return json({ error: "Token invalid or expired \u2014 please log in again" }, 401);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const { email, country, current_password, new_password } = body || {};
  const user = await env.DB.prepare(
    "SELECT id, username, email, password_hash FROM users WHERE id = ?1"
  ).bind(payload.sub).first();
  if (!user) return json({ error: "Account not found" }, 404);
  const setClauses = [];
  const bindings = [];
  let idx = 1;
  if (email !== void 0 && email !== "") {
    const newEmail = email.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail))
      return json({ error: "Please enter a valid email address" }, 400);
    if (newEmail !== user.email) {
      const taken = await env.DB.prepare(
        "SELECT id FROM users WHERE email = ?1 AND id != ?2"
      ).bind(newEmail, user.id).first();
      if (taken) return json({ error: "That email address is already in use" }, 409);
      setClauses.push(`email = ?${idx++}`);
      bindings.push(newEmail);
      const verifyToken = generateToken();
      const verifyExpires = Math.floor(Date.now() / 1e3) + 86400;
      setClauses.push(`email_verified = 0, verify_token = ?${idx++}, verify_token_expires = ?${idx++}`);
      bindings.push(verifyToken, verifyExpires);
      const verifyUrl = `https://clickzle.games/verify-email.html?token=${verifyToken}`;
      await sendEmail(env, {
        to: newEmail,
        subject: "Verify your new Clickzle email address",
        html: emailTemplate("Confirm your new email", `
          <p style="color:#b0b0b0;font-size:14px;line-height:1.6;margin:0 0 20px;">
            You changed your Clickzle email address. Please verify your new address to keep your account active.
          </p>
          <a href="${verifyUrl}" style="display:inline-block;background:#4ade80;color:#000;font-weight:700;font-size:14px;padding:14px 28px;border-radius:10px;text-decoration:none;margin-bottom:20px;">
            Verify New Email
          </a>
          <p style="color:#555;font-size:12px;margin:0;">This link expires in 24 hours.</p>
        `)
      });
    }
  }
  if (country !== void 0) {
    const clean = country && /^[a-z]{2}$/.test(country) ? country : null;
    setClauses.push(`country = ?${idx++}`);
    bindings.push(clean);
  }
  if (new_password !== void 0 && new_password !== "") {
    if (!current_password)
      return json({ error: "Current password is required to set a new password" }, 400);
    const valid = await verifyPassword(current_password, user.password_hash);
    if (!valid) return json({ error: "Current password is incorrect" }, 401);
    if (new_password.length < 8)
      return json({ error: "New password must be at least 8 characters" }, 400);
    const newHash = await hashPassword(new_password);
    setClauses.push(`password_hash = ?${idx++}`);
    bindings.push(newHash);
  }
  if (setClauses.length === 0)
    return json({ ok: true, message: "No changes to save" });
  setClauses.push(`last_seen = ?${idx++}`);
  bindings.push(Math.floor(Date.now() / 1e3));
  bindings.push(user.id);
  await env.DB.prepare(
    `UPDATE users SET ${setClauses.join(", ")} WHERE id = ?${idx}`
  ).bind(...bindings).run();
  const updated = await env.DB.prepare(
    "SELECT id, username, email, country FROM users WHERE id = ?1"
  ).bind(user.id).first();
  return json({ ok: true, user: updated });
}
__name(handleUpdateAccount, "handleUpdateAccount");
async function handleForgotPassword(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const { email } = body || {};
  if (!email) return json({ error: "Email address is required" }, 400);
  const uemail = email.toLowerCase().trim();
  const user = await env.DB.prepare(
    "SELECT id, username, email FROM users WHERE email = ?1"
  ).bind(uemail).first();
  const okMsg = { ok: true, message: "If that email is registered, a reset link is on its way." };
  if (!user) return json(okMsg);
  const token = generateToken();
  const expires = Math.floor(Date.now() / 1e3) + 3600;
  await env.DB.prepare(
    "UPDATE users SET reset_token = ?1, reset_token_expires = ?2 WHERE id = ?3"
  ).bind(token, expires, user.id).run();
  const resetUrl = `https://clickzle.games/reset-password.html?token=${token}`;
  await sendEmail(env, {
    to: user.email,
    subject: "Reset your Clickzle password",
    html: emailTemplate("Reset your password", `
      <p style="color:#b0b0b0;font-size:14px;line-height:1.6;margin:0 0 20px;">
        Hi <strong style="color:#f0f0f0;">${user.username}</strong>,<br>
        We received a request to reset your Clickzle password. Click the button below to set a new one.
      </p>
      <a href="${resetUrl}" style="display:inline-block;background:#4ade80;color:#000;font-weight:700;font-size:14px;padding:14px 28px;border-radius:10px;text-decoration:none;margin-bottom:20px;">
        Reset Password
      </a>
      <p style="color:#555;font-size:12px;margin:0;line-height:1.5;">
        This link expires in <strong>1 hour</strong>. If you didn't request a password reset, you can safely ignore this email \u2014 your password won't change.
      </p>
    `)
  });
  return json(okMsg);
}
__name(handleForgotPassword, "handleForgotPassword");
async function handleResetPassword(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const { token, new_password } = body || {};
  if (!token || !new_password)
    return json({ error: "Reset token and new password are required" }, 400);
  if (new_password.length < 8)
    return json({ error: "Password must be at least 8 characters" }, 400);
  const now = Math.floor(Date.now() / 1e3);
  const user = await env.DB.prepare(
    "SELECT id, username FROM users WHERE reset_token = ?1 AND reset_token_expires > ?2"
  ).bind(token, now).first();
  if (!user)
    return json({ error: "This reset link is invalid or has expired. Please request a new one." }, 400);
  const newHash = await hashPassword(new_password);
  await env.DB.prepare(
    "UPDATE users SET password_hash = ?1, reset_token = NULL, reset_token_expires = NULL WHERE id = ?2"
  ).bind(newHash, user.id).run();
  return json({ ok: true, message: "Password updated successfully. You can now log in." });
}
__name(handleResetPassword, "handleResetPassword");
async function handleVerifyEmail(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) return json({ error: "Verification token is required" }, 400);
  const now = Math.floor(Date.now() / 1e3);
  const user = await env.DB.prepare(
    "SELECT id, username FROM users WHERE verify_token = ?1 AND (verify_token_expires IS NULL OR verify_token_expires > ?2)"
  ).bind(token, now).first();
  if (!user)
    return json({ error: "This verification link is invalid or has expired. Please request a new one." }, 400);
  await env.DB.prepare(
    "UPDATE users SET email_verified = 1, verify_token = NULL, verify_token_expires = NULL WHERE id = ?1"
  ).bind(user.id).run();
  return json({ ok: true, username: user.username, message: "Email verified! You can now log in." });
}
__name(handleVerifyEmail, "handleVerifyEmail");
async function handleResendVerify(request, env) {
  const token = getBearerToken(request);
  if (!token) return json({ error: "Authorisation required" }, 401);
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) return json({ error: "Token invalid or expired" }, 401);
  const user = await env.DB.prepare(
    "SELECT id, username, email, email_verified FROM users WHERE id = ?1"
  ).bind(payload.sub).first();
  if (!user) return json({ error: "Account not found" }, 404);
  if (user.email_verified === 1) return json({ ok: true, message: "Your email is already verified." });
  const verifyToken = generateToken();
  const verifyExpires = Math.floor(Date.now() / 1e3) + 86400;
  await env.DB.prepare(
    "UPDATE users SET verify_token = ?1, verify_token_expires = ?2 WHERE id = ?3"
  ).bind(verifyToken, verifyExpires, user.id).run();
  const verifyUrl = `https://clickzle.games/verify-email.html?token=${verifyToken}`;
  const result = await sendEmail(env, {
    to: user.email,
    subject: "Verify your Clickzle account",
    html: emailTemplate("Verify your email address", `
      <p style="color:#b0b0b0;font-size:14px;line-height:1.6;margin:0 0 20px;">
        Hi <strong style="color:#f0f0f0;">${user.username}</strong>,<br>
        Here's your new verification link. Click below to verify your email address.
      </p>
      <a href="${verifyUrl}" style="display:inline-block;background:#4ade80;color:#000;font-weight:700;font-size:14px;padding:14px 28px;border-radius:10px;text-decoration:none;margin-bottom:20px;">
        Verify My Email
      </a>
      <p style="color:#555;font-size:12px;margin:0;">This link expires in 24 hours.</p>
    `)
  });
  if (!result.ok) return json({ error: "Failed to send email. Please try again." }, 500);
  return json({ ok: true, message: "Verification email sent. Check your inbox." });
}
__name(handleResendVerify, "handleResendVerify");
async function handleStats(request, env) {
  const date = todayUTC();
  const [users, playersToday, gamesToday] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM users").first(),
    env.DB.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM scores WHERE date_utc = ?1").bind(date).first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM scores WHERE date_utc = ?1").bind(date).first()
  ]);
  return json({
    ok: true,
    registered_players: users?.n || 0,
    players_today: playersToday?.n || 0,
    games_today: gamesToday?.n || 0,
    date
  });
}
__name(handleStats, "handleStats");
async function handleDeleteScore(request, env) {
  const token = getBearerToken(request);
  if (!token) return json({ error: "Authorisation required" }, 401);
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) return json({ error: "Token invalid or expired" }, 401);
  const url = new URL(request.url);
  const gameId = parseInt(url.searchParams.get("game") || "0");
  if (!gameId || gameId < 1 || gameId > 18)
    return json({ error: "game parameter required (1\u201318)" }, 400);
  const date = todayUTC();
  await env.DB.prepare(
    "DELETE FROM scores WHERE user_id = ?1 AND game_id = ?2 AND date_utc = ?3"
  ).bind(payload.sub, gameId, date).run();
  await env.DB.prepare(
    "UPDATE personal_bests SET games_played = MAX(0, games_played - 1) WHERE user_id = ?1 AND game_id = ?2"
  ).bind(payload.sub, gameId).run();
  return json({ ok: true, message: `Today's score for game ${gameId} deleted` });
}
__name(handleDeleteScore, "handleDeleteScore");
function checkAdminKey(request, env) {
  const key = request.headers.get("X-Admin-Key") || "";
  return env.ADMIN_KEY && key === env.ADMIN_KEY;
}
__name(checkAdminKey, "checkAdminKey");
async function handleAdminLookup(request, env) {
  if (!checkAdminKey(request, env)) return json({ error: "Unauthorised" }, 401);
  const url = new URL(request.url);
  const email = (url.searchParams.get("email") || "").trim().toLowerCase();
  const uname = (url.searchParams.get("username") || "").trim().toLowerCase();
  if (!email && !uname) return json({ error: "email or username required" }, 400);
  const user = email ? await env.DB.prepare("SELECT * FROM users WHERE LOWER(email)=?1").bind(email).first() : await env.DB.prepare("SELECT * FROM users WHERE LOWER(username)=?1").bind(uname).first();
  if (!user) return json({ ok: true, found: false });
  const [scores, pbs] = await Promise.all([
    env.DB.prepare("SELECT game_id, date_utc, score, time_ms, correct, wrong, submitted_at FROM scores WHERE user_id=?1 ORDER BY submitted_at DESC LIMIT 50").bind(user.id).all(),
    env.DB.prepare("SELECT game_id, best_score, best_date, games_played FROM personal_bests WHERE user_id=?1").bind(user.id).all()
  ]);
  return json({
    ok: true,
    found: true,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      email_verified: user.email_verified,
      country: user.country,
      streak_days: user.streak_days,
      best_streak: user.best_streak,
      total_games: user.total_games,
      created_at: user.created_at,
      last_seen: user.last_seen
    },
    scores: scores.results || [],
    personal_bests: pbs.results || []
  });
}
__name(handleAdminLookup, "handleAdminLookup");
async function handleAdminVerify(request, env) {
  if (!checkAdminKey(request, env)) return json({ error: "Unauthorised" }, 401);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid body" }, 400);
  }
  const { user_id } = body || {};
  if (!user_id) return json({ error: "user_id required" }, 400);
  await env.DB.prepare(
    "UPDATE users SET email_verified=1, verify_token=NULL, verify_token_expires=NULL WHERE id=?1"
  ).bind(user_id).run();
  return json({ ok: true, message: "Email marked as verified" });
}
__name(handleAdminVerify, "handleAdminVerify");
async function handleAdminDeleteScore(request, env) {
  if (!checkAdminKey(request, env)) return json({ error: "Unauthorised" }, 401);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid body" }, 400);
  }
  const { user_id, game_id, date_utc } = body || {};
  if (!user_id || !game_id || !date_utc) return json({ error: "user_id, game_id, date_utc required" }, 400);
  await env.DB.prepare(
    "DELETE FROM scores WHERE user_id=?1 AND game_id=?2 AND date_utc=?3"
  ).bind(user_id, game_id, date_utc).run();
  return json({ ok: true, message: "Score deleted" });
}
__name(handleAdminDeleteScore, "handleAdminDeleteScore");
var index_default = {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (path === "/api/auth/signup" && method === "POST") return handleSignup(request, env);
    if (path === "/api/auth/login" && method === "POST") return handleLogin(request, env);
    if (path === "/api/auth/me" && method === "GET") return handleMe(request, env);
    if (path === "/api/auth/check-username" && method === "GET") return handleCheckUsername(request, env);
    if (path === "/api/auth/check-email" && method === "GET") return handleCheckEmail(request, env);
    if (path === "/api/auth/score" && method === "POST") return handleSubmitScore(request, env);
    if (path === "/api/auth/score" && method === "DELETE") return handleDeleteScore(request, env);
    if (path === "/api/auth/personal-best" && method === "GET") return handlePersonalBest(request, env);
    if (path === "/api/auth/update" && method === "PUT") return handleUpdateAccount(request, env);
    if (path === "/api/auth/forgot-password" && method === "POST") return handleForgotPassword(request, env);
    if (path === "/api/auth/reset-password" && method === "POST") return handleResetPassword(request, env);
    if (path === "/api/auth/verify-email" && method === "GET") return handleVerifyEmail(request, env);
    if (path === "/api/auth/resend-verify" && method === "POST") return handleResendVerify(request, env);
    if (path === "/api/leaderboard" && method === "GET") return handleLeaderboard(request, env);
    if (path === "/api/stats" && method === "GET") return handleStats(request, env);
    if (path === "/api/admin/lookup" && method === "GET") return handleAdminLookup(request, env);
    if (path === "/api/admin/verify" && method === "POST") return handleAdminVerify(request, env);
    if (path === "/api/admin/delete-score" && method === "POST") return handleAdminDeleteScore(request, env);
    return json({ error: "Not found" }, 404);
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
