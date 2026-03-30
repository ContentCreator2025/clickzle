-- ═══════════════════════════════════════════════════════════════════════════
-- CLICKZLE D1 DATABASE SCHEMA
-- Run this in: Cloudflare Dashboard → D1 → clickzle-db → Console
-- ═══════════════════════════════════════════════════════════════════════════

-- ── USERS ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            TEXT    PRIMARY KEY,
  username      TEXT    UNIQUE NOT NULL,
  email         TEXT    UNIQUE NOT NULL,
  password_hash TEXT    NOT NULL,
  created_at    INTEGER NOT NULL,
  last_seen     INTEGER,
  country       TEXT    DEFAULT 'XX',
  device_type   TEXT    DEFAULT 'unknown',   -- 'mobile' | 'desktop' | 'unknown'
  total_games   INTEGER DEFAULT 0,
  streak_days   INTEGER DEFAULT 0,
  best_streak   INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email    ON users(email);

-- ── SCORES ────────────────────────────────────────────────────────────────────
-- One row per player per game per day (upsert on conflict)
CREATE TABLE IF NOT EXISTS scores (
  id          TEXT    PRIMARY KEY,
  user_id     TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id     INTEGER NOT NULL,              -- 1-5
  date_utc    TEXT    NOT NULL,              -- 'YYYY-MM-DD'
  score       INTEGER NOT NULL DEFAULT 0,
  time_ms     INTEGER,                       -- total time taken ms
  accuracy    REAL,                          -- 0.0-1.0
  pairs_found INTEGER DEFAULT 0,             -- game4: pairs found
  correct     INTEGER DEFAULT 0,             -- game2/3/5: correct answers
  wrong       INTEGER DEFAULT 0,
  combo_max   INTEGER DEFAULT 0,
  device_type TEXT    DEFAULT 'unknown',     -- 'mobile' | 'desktop'
  submitted_at INTEGER NOT NULL,
  UNIQUE(user_id, game_id, date_utc)
);

CREATE INDEX IF NOT EXISTS idx_scores_game_date  ON scores(game_id, date_utc);
CREATE INDEX IF NOT EXISTS idx_scores_user_game  ON scores(user_id, game_id);
CREATE INDEX IF NOT EXISTS idx_scores_date_score ON scores(date_utc, score DESC);

-- ── GUEST SCORES ──────────────────────────────────────────────────────────────
-- For players who play without an account (name only, no leaderboard)
CREATE TABLE IF NOT EXISTS guest_scores (
  id           TEXT    PRIMARY KEY,
  guest_name   TEXT    NOT NULL,
  game_id      INTEGER NOT NULL,
  date_utc     TEXT    NOT NULL,
  score        INTEGER NOT NULL DEFAULT 0,
  device_type  TEXT    DEFAULT 'unknown',
  submitted_at INTEGER NOT NULL
);

-- ── PERSONAL BESTS ────────────────────────────────────────────────────────────
-- Maintained separately for fast entry-screen lookups
CREATE TABLE IF NOT EXISTS personal_bests (
  user_id      TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id      INTEGER NOT NULL,
  best_score   INTEGER NOT NULL DEFAULT 0,
  best_date    TEXT,
  games_played INTEGER DEFAULT 0,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, game_id)
);

CREATE INDEX IF NOT EXISTS idx_pb_user ON personal_bests(user_id);
