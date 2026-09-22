import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  // WhatsApp group and Meta AI identifiers
  TARGET_GROUP_JID: z.string().default(''),
  META_AI_JID: z.string().default(''),
  META_AI_BRIDGE_URL: z.string().default('http://localhost:8788'),

  // Execution options
  DRY_RUN: z
    .string()
    .default('false')
    .transform((val) => val.toLowerCase() === 'true'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // AI Provider & Fallback settings
  AI_PROVIDER: z.enum(['groq', 'together', 'openrouter']).default('groq'),
  AI_API_KEY: z.string().default(''),
  AI_MODEL: z.string().default('qwen/qwen3.8-27b'),

  // Database & Timezone settings
  DB_PATH: z.string().default('data/bot.sqlite'),
  TIMEZONE: z.string().default('America/Argentina/Cordoba'),

  // Admin security settings
  ADMIN_PHONE_SUFFIX: z.string().default('3811,266180782755958'),

  // Inactivity & Scheduler settings
  INACTIVITY_THRESHOLD_HOURS: z.coerce.number().default(3.5),
  INACTIVITY_COOLDOWN_HOURS: z.coerce.number().default(8),
  INACTIVE_MEMBER_ALERT_DAYS: z.coerce.number().default(7),
  MAX_GHOST_ALERTS_PER_DAY: z.coerce.number().default(4),
  GHOST_ALERT_COOLDOWN_HOURS: z.coerce.number().default(2),
  NEWS_COUNT: z.coerce.number().default(3),

  // Spontaneous Interventions settings
  SPONTANEOUS_CHANCE: z.coerce.number().default(0.35),
  SPONTANEOUS_COOLDOWN_MINUTES: z.coerce.number().default(25),
  SPONTANEOUS_MESSAGE_INTERVAL: z.coerce.number().default(18),

  // Timing & Cooldowns (in milliseconds)
  COOLDOWN_USER_MS: z.coerce.number().default(8000),
  COOLDOWN_GROUP_MS: z.coerce.number().default(2500),
  PRESENCE_DELAY_MIN_MS: z.coerce.number().default(1500),
  PRESENCE_DELAY_MAX_MS: z.coerce.number().default(3500),
  META_AI_TIMEOUT_MS: z.coerce.number().default(45000)
});

export type EnvConfig = z.infer<typeof envSchema>;

export function loadEnv(): EnvConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Error de validación en variables de entorno:');
    console.error(result.error.format());
    process.exit(1);
  }

  return result.data;
}

export const env = loadEnv();
