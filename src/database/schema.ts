export const SCHEMA_SQL = `
-- 1. Mensajes observados para resúmenes y contexto de /marcar
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  group_jid TEXT NOT NULL,
  sender_jid TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  raw_quoted TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_group_time ON messages(group_jid, timestamp);

-- 2. Menciones detectadas entre usuarios
CREATE TABLE IF NOT EXISTS mentions (
  id TEXT PRIMARY KEY,
  group_jid TEXT NOT NULL,
  message_id TEXT NOT NULL,
  mentioned_user_jid TEXT NOT NULL,
  mentioned_by_user_jid TEXT NOT NULL,
  mentioned_by_name TEXT NOT NULL,
  message_content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mentions_user ON mentions(mentioned_user_jid, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_mentions_group_user ON mentions(group_jid, mentioned_user_jid);

-- 3. Checkpoints de resumen diario por grupo
CREATE TABLE IF NOT EXISTS summary_checkpoints (
  group_jid TEXT PRIMARY KEY,
  cycle_date TEXT NOT NULL,
  accumulated_summary TEXT,
  last_message_id TEXT,
  last_message_timestamp INTEGER,
  updated_at INTEGER NOT NULL
);

-- 4. Registro de cumpleaños y género/pronombre de usuarios
CREATE TABLE IF NOT EXISTS birthdays (
  user_jid TEXT PRIMARY KEY,
  day INTEGER NOT NULL,
  month INTEGER NOT NULL,
  gender TEXT,                         -- 'male' | 'female' | NULL
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_birthdays_date ON birthdays(month, day);

-- 5. Estadísticas de participación por grupo (Top 10)
CREATE TABLE IF NOT EXISTS user_statistics (
  group_jid TEXT NOT NULL,
  user_jid TEXT NOT NULL,
  user_name TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  last_message_at INTEGER NOT NULL,
  PRIMARY KEY (group_jid, user_jid)
);
CREATE INDEX IF NOT EXISTS idx_user_stats_count ON user_statistics(group_jid, message_count DESC);

-- 6. Noticias de software y tecnología publicadas (Deduplicación)
CREATE TABLE IF NOT EXISTS published_news (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  published_at INTEGER NOT NULL
);

-- 7. Registro de ejecuciones de Jobs para IDEMPOTENCIA
CREATE TABLE IF NOT EXISTS job_executions (
  job_key TEXT NOT NULL,
  group_jid TEXT NOT NULL,
  executed_at INTEGER NOT NULL,
  PRIMARY KEY (job_key)
);
`;
