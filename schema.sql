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
