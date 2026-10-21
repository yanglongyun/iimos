-- iimos.ai:形态社区和账号。形态本体(gzip 的 JSON)和封面在 R2:shapes/bundles/<id>.gz、shapes/covers/<id>.png。
-- shapes.owner_id 是后加的列,在 src/index.js 的 ensureSchema 里 ALTER TABLE 补上(老库没有它)
CREATE TABLE IF NOT EXISTS shapes (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  story        TEXT NOT NULL DEFAULT '',   -- 让它长成这样的话
  author       TEXT NOT NULL DEFAULT '',
  seed_version TEXT NOT NULL DEFAULT '',
  lineage      TEXT NOT NULL DEFAULT '[]', -- [{id,name}],最早的在前
  parent_id    TEXT,                       -- lineage 的最后一个:直接从哪个形态长过来
  files        TEXT NOT NULL DEFAULT '[]', -- [[path, size]],详情页列文件用
  file_count   INTEGER NOT NULL DEFAULT 0,
  size         INTEGER NOT NULL DEFAULT 0,
  has_cover    INTEGER NOT NULL DEFAULT 0,
  edit_hash    TEXT NOT NULL,              -- 删除令牌的哈希,令牌只在作者本机
  ip_hash      TEXT NOT NULL DEFAULT '',   -- 限流用,加盐哈希
  downloads    INTEGER NOT NULL DEFAULT 0,
  published    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS shapes_new ON shapes(published, created_at DESC);
CREATE INDEX IF NOT EXISTS shapes_hot ON shapes(published, downloads DESC);
CREATE INDEX IF NOT EXISTS shapes_parent ON shapes(parent_id);
CREATE INDEX IF NOT EXISTS shapes_ip ON shapes(ip_hash, created_at);

-- 账号:只有谷歌登录。id 是 'g:' + 谷歌的 sub
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  picture    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login TEXT NOT NULL DEFAULT (datetime('now'))
);
-- 浏览器会话(cookie 里是原文,这里只存哈希)
CREATE TABLE IF NOT EXISTS sessions (
  hash       TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
-- agent 的 API 令牌(设备授权换来的,只存哈希)
CREATE TABLE IF NOT EXISTS tokens (
  hash       TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used  TEXT
);
-- 设备授权:agent 拿 device_code(存哈希),用户在 /device 页输入 user_code 同意
CREATE TABLE IF NOT EXISTS devices (
  hash       TEXT PRIMARY KEY,
  user_code  TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL DEFAULT '',
  user_id    TEXT,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS tokens_user ON tokens(user_id);
