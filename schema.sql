CREATE TABLE IF NOT EXISTS users (
  discord_id TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  verified   INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS otps (
  discord_id TEXT,
  code       TEXT,
  expires_at INTEGER,
  PRIMARY KEY(discord_id, code)
);

CREATE TABLE IF NOT EXISTS doubts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id  TEXT    NOT NULL,
  username    TEXT    NOT NULL,
  question    TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'open',
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS solutions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  doubt_id   INTEGER NOT NULL,
  solver_id  TEXT    NOT NULL,
  answer     TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
