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

  // ── COOKIE CONSENT — applied immediately (before DOM ready) ───────────────
  // Blocks GA by default until the user actively accepts.
  const CONSENT_KEY = 'czCookieConsent';
  const GA_ID       = 'G-LVM484NRCG';
  const _consent    = localStorage.getItem(CONSENT_KEY);
  if (_consent !== 'accepted') {
    // Disable GA tracking until explicitly accepted (privacy-by-default)
    window['ga-disable-' + GA_ID] = true;
  }

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

  async function signup(username, email, password, country) {
    const data = await apiFetch('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ username, email, password, country }),
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

  async function deleteScore(gameId) {
    return apiFetch(`/api/auth/score?game=${gameId}`, { method: 'DELETE' });
  }

  async function updateAccount(data) {
    const res = await apiFetch('/api/auth/update', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    if (res.ok && res.user) {
      // Merge updated fields into stored user
      const current = getStoredUser() || {};
      localStorage.setItem(USER_KEY, JSON.stringify({ ...current, ...res.user }));
    }
    return res;
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

  async function forgotPassword(email) {
    return apiFetch('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  async function resetPassword(token, password) {
    return apiFetch('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, new_password: password }),
    });
  }

  async function verifyEmail(token) {
    return apiFetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`);
  }

  async function resendVerify() {
    return apiFetch('/api/auth/resend-verify', { method: 'POST' });
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
        <a href="/account.html" class="cz-chip-user" title="My account">
          <div class="cz-chip-avatar">${initials}</div>
          <span class="cz-chip-name">${user.username}</span>
        </a>
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
        .cz-chip-user { display:flex; align-items:center; gap:8px; text-decoration:none; border-radius:8px; padding:2px 4px; transition:background 0.15s; }
        .cz-chip-user:hover { background:var(--surface2,rgba(255,255,255,0.06)); }
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

  // ── COOKIE CONSENT BANNER ─────────────────────────────────────────────────
  function initCookieConsent() {
    // Already decided — nothing to show
    if (localStorage.getItem(CONSENT_KEY)) return;

    const banner = document.createElement('div');
    banner.id = 'cz-cookie-banner';
    Object.assign(banner.style, {
      position: 'fixed', bottom: '0', left: '0', right: '0',
      zIndex: '99999',
      background: 'var(--surface,#141414)',
      borderTop: '1px solid var(--border2,#2e2e2e)',
      padding: '14px 0',
      boxShadow: '0 -4px 32px rgba(0,0,0,0.35)',
      fontFamily: "'DM Sans',sans-serif",
    });
    banner.innerHTML = `
      <div style="max-width:1120px;margin:0 auto;display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:0 28px;">
        <div style="flex:1;min-width:200px;font-size:13px;color:var(--text2,#b0b0b0);line-height:1.5;">
          🍪 We use cookies to analyse traffic and improve your experience.
          <a href="/privacy.html" style="color:var(--accent,#4ade80);text-decoration:none;white-space:nowrap;">Privacy Policy</a>
        </div>
        <div style="display:flex;gap:10px;flex-shrink:0;">
          <button id="czCookieDecline" style="background:none;border:1.5px solid rgba(255,255,255,0.12);color:var(--text3,#888);border-radius:8px;padding:8px 18px;font-size:13px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;transition:border-color 0.15s,color 0.15s;">Decline</button>
          <button id="czCookieAccept" style="background:var(--accent,#4ade80);border:none;color:#000;border-radius:8px;padding:8px 18px;font-size:13px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;transition:opacity 0.15s;">Accept</button>
        </div>
      </div>`;

    function dismissBanner() {
      banner.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
      banner.style.transform  = 'translateY(100%)';
      banner.style.opacity    = '0';
      setTimeout(() => { if (banner.parentNode) banner.remove(); }, 350);
    }

    document.getElementById && document.body.appendChild(banner);

    banner.querySelector('#czCookieAccept').addEventListener('click', () => {
      localStorage.setItem(CONSENT_KEY, 'accepted');
      window['ga-disable-' + GA_ID] = false;   // un-block GA
      if (typeof gtag === 'function') {
        gtag('consent', 'update', { analytics_storage: 'granted' });
      }
      dismissBanner();
    });

    banner.querySelector('#czCookieDecline').addEventListener('click', () => {
      localStorage.setItem(CONSENT_KEY, 'declined');
      window['ga-disable-' + GA_ID] = true;
      dismissBanner();
    });

    // Hover tint on decline button
    const decBtn = banner.querySelector('#czCookieDecline');
    decBtn.addEventListener('mouseenter', () => {
      decBtn.style.borderColor = 'rgba(255,255,255,0.28)';
      decBtn.style.color = 'var(--text,#f0f0f0)';
    });
    decBtn.addEventListener('mouseleave', () => {
      decBtn.style.borderColor = 'rgba(255,255,255,0.12)';
      decBtn.style.color = 'var(--text3,#888)';
    });
  }

  // ── EXPOSE GLOBAL ─────────────────────────────────────────────────────────
  window.CZAuth = {
    isLoggedIn,
    getUser,
    getToken,
    signup,
    login,
    logout,
    updateAccount,
    deleteScore,
    getPersonalBest,
    submitScore,
    checkUsername,
    checkEmail,
    forgotPassword,
    resetPassword,
    verifyEmail,
    resendVerify,
    injectHeader,
    apiFetch,
    API_BASE,
  };

  // Auto-inject header + cookie banner on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      injectHeader();
      initCookieConsent();
    });
  } else {
    injectHeader();
    initCookieConsent();
  }
})();
