/**
 * CLICKZLE — Shared Auth Utility
 * ─────────────────────────────────────────────────────────────────────────────
 * Include this script in every page:
 *   <script src="/assets/js/auth.js"></script>
 *
 * It automatically:
 *   • Reads the JWT from localStorage
 *   • Decodes user info (no server call needed for basic display)
 *   • Injects a logged-in / logged-out state into the page header
 *   • Exposes a global `CZAuth` object for game pages to use
 */

(function () {
  'use strict';

  // ── CONFIG ────────────────────────────────────────────────────────────────
  // IMPORTANT: Change this to your deployed Worker URL after deploying
  const API_BASE = 'https://clickzle-auth.thecontentcreationguy.workers.dev';

  const TOKEN_KEY  = 'cz_token';
  const USER_KEY   = 'cz_user';
  const PB_KEY_PFX = 'cz_pb_';   // personal best cache prefix

  // ── TOKEN HELPERS ─────────────────────────────────────────────────────────
  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function setSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function getStoredUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY)); }
    catch { return null; }
  }

  /** Decode JWT payload without verifying (client-side display only) */
  function decodeJWT(token) {
    try {
      const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(b64));
    } catch { return null; }
  }

  function isTokenExpired(token) {
    const payload = decodeJWT(token);
    if (!payload) return true;
    return payload.exp < Math.floor(Date.now() / 1000);
  }

  function isLoggedIn() {
    const token = getToken();
    return !!token && !isTokenExpired(token);
  }

  function getUser() {
    if (!isLoggedIn()) return null;
    return getStoredUser();
  }

  // ── API CALLS ─────────────────────────────────────────────────────────────
  async function apiFetch(path, options = {}) {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    return res.json();
  }

  async function signup(username, email, password) {
    const data = await apiFetch('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    });
    if (data.ok) setSession(data.token, data.user);
    return data;
  }

  async function login(identifier, password) {
    const data = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    });
    if (data.ok) setSession(data.token, data.user);
    return data;
  }

  function logout() {
    clearSession();
    // Clear personal best cache
    Object.keys(localStorage)
      .filter(k => k.startsWith(PB_KEY_PFX))
      .forEach(k => localStorage.removeItem(k));
    window.location.href = '/index.html';
  }

  async function getPersonalBest(gameId) {
    const cacheKey = `${PB_KEY_PFX}${gameId}`;
    const today = new Date().toISOString().slice(0, 10);

    // Return cached value if it's from today
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey));
      if (cached && cached.date === today) return cached.pb;
    } catch {}

    if (!isLoggedIn()) return null;

    try {
      const data = await apiFetch(`/api/auth/personal-best?game=${gameId}`);
      if (data.ok && data.personal_best) {
        localStorage.setItem(cacheKey, JSON.stringify({ date: today, pb: data.personal_best }));
        return data.personal_best;
      }
    } catch {}
    return null;
  }

  async function submitScore(gameId, scoreData) {
    if (!isLoggedIn()) return null;
    try {
      const data = await apiFetch('/api/auth/score', {
        method: 'POST',
        body: JSON.stringify({ game_id: gameId, ...scoreData }),
      });
      // Invalidate personal best cache after submitting
      localStorage.removeItem(`${PB_KEY_PFX}${gameId}`);
      return data;
    } catch { return null; }
  }

  async function checkUsername(username) {
    try {
      const data = await apiFetch(`/api/auth/check-username?u=${encodeURIComponent(username)}`);
      return data.available;
    } catch { return null; }
  }

  async function checkEmail(email) {
    try {
      const data = await apiFetch(`/api/auth/check-email?e=${encodeURIComponent(email)}`);
      return data.available;
    } catch { return null; }
  }

  // ── HEADER INJECTION ──────────────────────────────────────────────────────
  /**
   * Call CZAuth.injectHeader() after the DOM loads.
   * Looks for elements with data-cz-auth="..." attributes and updates them.
   *
   * Alternatively, adds a user chip to .hdr-right if it exists.
   */
  function injectHeader() {
    const user = getUser();
    const loggedIn = !!user;

    // Update any elements with [data-cz-auth]
    document.querySelectorAll('[data-cz-auth]').forEach(el => {
      const role = el.dataset.czAuth;
      if (role === 'logged-in')  el.style.display = loggedIn ? '' : 'none';
      if (role === 'logged-out') el.style.display = loggedIn ? 'none' : '';
      if (role === 'username' && loggedIn) el.textContent = user.username;
    });

    // Inject user chip into .hdr-right if present
    const hdrRight = document.querySelector('.hdr-right');
    if (!hdrRight) return;

    // Remove any previously injected chip
    const existing = hdrRight.querySelector('.cz-auth-chip');
    if (existing) existing.remove();

    const chip = document.createElement('div');
    chip.className = 'cz-auth-chip';

    if (loggedIn) {
      const initials = user.username.slice(0, 2).toUpperCase();
      chip.innerHTML = `
        <div class="cz-chip-avatar">${initials}</div>
        <span class="cz-chip-name">${user.username}</span>
        <button class="cz-chip-logout" onclick="CZAuth.logout()" title="Log out">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </button>`;
    } else {
      chip.innerHTML = `
        <a href="/login.html" class="cz-chip-login">Log In</a>
        <a href="/signup.html" class="cz-chip-signup">Sign Up</a>`;
    }

    hdrRight.appendChild(chip);

    // Inject styles if not already present
    if (!document.getElementById('cz-auth-styles')) {
      const style = document.createElement('style');
      style.id = 'cz-auth-styles';
      style.textContent = `
        .cz-auth-chip { display:flex; align-items:center; gap:8px; margin-left:8px; }
        .cz-chip-avatar {
          width:30px; height:30px; border-radius:50%;
          background:rgba(74,222,128,0.12); border:1.5px solid rgba(74,222,128,0.35);
          color:#4ade80; font-size:11px; font-weight:700; letter-spacing:0.5px;
          display:flex; align-items:center; justify-content:center; flex-shrink:0;
        }
        .cz-chip-name {
          font-size:13px; font-weight:600; color:var(--text,#f0f0f0);
          max-width:90px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
        }
        .cz-chip-logout {
          background:none; border:none; cursor:pointer; color:var(--text3,#888);
          width:28px; height:28px; display:flex; align-items:center; justify-content:center;
          border-radius:6px; transition:background 0.15s, color 0.15s; padding:0;
        }
        .cz-chip-logout:hover { background:rgba(248,113,113,0.12); color:#f87171; }
        .cz-chip-logout svg { width:16px; height:16px; }
        .cz-chip-login, .cz-chip-signup {
          font-size:12px; font-weight:600; text-decoration:none;
          padding:6px 14px; border-radius:8px;
          transition:opacity 0.15s, background 0.15s;
        }
        .cz-chip-login {
          color:var(--text2,#b0b0b0); border:1px solid var(--border,#222);
        }
        .cz-chip-login:hover { color:var(--text,#f0f0f0); border-color:var(--border2,#333); }
        .cz-chip-signup {
          background:#4ade80; color:#000; border:1px solid #4ade80;
        }
        .cz-chip-signup:hover { opacity:0.88; }
        @media(max-width:480px) {
          .cz-chip-name { display:none; }
          .cz-chip-login {
            font-size:11px; padding:5px 10px;
            color: var(--text,#f0f0f0);
            border-color: rgba(255,255,255,0.18);
            background: rgba(255,255,255,0.06);
          }
          .cz-chip-signup { font-size:11px; padding:5px 10px; }
        }
      `;
      document.head.appendChild(style);
    }
  }

  // ── EXPOSE GLOBAL ─────────────────────────────────────────────────────────
  window.CZAuth = {
    isLoggedIn,
    getUser,
    getToken,
    signup,
    login,
    logout,
    getPersonalBest,
    submitScore,
    checkUsername,
    checkEmail,
    injectHeader,
    API_BASE,
  };

  // Auto-inject header on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectHeader);
  } else {
    injectHeader();
  }
})();
