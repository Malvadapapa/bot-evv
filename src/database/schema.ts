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

-- 8. Caché de horóscopo (Sigastra API) con expiración de 6 horas
CREATE TABLE IF NOT EXISTS horoscope_cache (
  cache_key TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- 9. Configuración Dinámica del Sistema (Guardrails y Parámetros)
CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 10. Administradores del Bot (Permisos y Canal Privado)
CREATE TABLE IF NOT EXISTS admin_users (
  phone TEXT PRIMARY KEY,
  jid TEXT,
  added_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 11. Grupos Autorizados y Estado de Bienvenida (Intro Sent)
CREATE TABLE IF NOT EXISTS authorized_groups (
  group_jid TEXT PRIMARY KEY,
  group_name TEXT NOT NULL,
  authorized_at INTEGER NOT NULL,
  authorized_by TEXT NOT NULL,
  intro_sent INTEGER NOT NULL DEFAULT 0
);

-- 12. Solicitudes de Adhesión a Nuevos Grupos (Aprobación Admin / Timeout 12h)
CREATE TABLE IF NOT EXISTS group_join_requests (
  id TEXT PRIMARY KEY,
  group_jid TEXT NOT NULL,
  group_name TEXT NOT NULL,
  invited_by_jid TEXT NOT NULL,
  invited_by_phone TEXT NOT NULL,
  status TEXT NOT NULL,                -- 'pending' | 'approved' | 'rejected' | 'expired'
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_group_join_status ON group_join_requests(status, expires_at);

-- 13. Auditoría de Comandos y Rate Limiting (1/s, 30/h)
CREATE TABLE IF NOT EXISTS command_audit_log (
  id TEXT PRIMARY KEY,
  user_jid TEXT NOT NULL,
  user_name TEXT NOT NULL,
  user_phone TEXT NOT NULL,
  group_jid TEXT NOT NULL,
  command TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  result TEXT NOT NULL,                 -- 'allowed' | 'blocked'
  block_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_command_audit_user_time ON command_audit_log(user_jid, timestamp DESC);

-- 14. Batería Social: Registro de Interacciones Directas (15/h por usuario)
CREATE TABLE IF NOT EXISTS social_battery_logs (
  id TEXT PRIMARY KEY,
  user_jid TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_social_battery_user_time ON social_battery_logs(user_jid, timestamp DESC);

-- 15. Apodos y Palabras de Activación para Entromisión
CREATE TABLE IF NOT EXISTS user_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_phone TEXT NOT NULL,
  user_jid TEXT NOT NULL,
  alias TEXT NOT NULL COLLATE NOCASE,
  added_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(user_phone, alias)
);
CREATE INDEX IF NOT EXISTS idx_user_aliases_alias ON user_aliases(alias);
CREATE INDEX IF NOT EXISTS idx_user_aliases_phone ON user_aliases(user_phone);

-- 16. Recordatorios y Avisos Programados
CREATE TABLE IF NOT EXISTS scheduled_reminders (
  id TEXT PRIMARY KEY,
  group_jid TEXT NOT NULL,
  created_by_jid TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  target_jid TEXT,                      -- JID de quien debe ser etiquetado o '@all' o NULL
  target_name TEXT,
  message TEXT NOT NULL,
  target_timestamp INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'sent' | 'cancelled'
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_reminders_status_time ON scheduled_reminders(status, target_timestamp);
CREATE INDEX IF NOT EXISTS idx_reminders_user_active ON scheduled_reminders(created_by_jid, status);
CREATE INDEX IF NOT EXISTS idx_reminders_group ON scheduled_reminders(group_jid, status);
`;
