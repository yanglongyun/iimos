-- iimos 形态社区。形态本体(gzip 的 JSON)和封面在 R2:bundles/<id>.gz、covers/<id>.png。
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
