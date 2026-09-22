import fs from 'fs';
import { Boom } from '@hapi/boom';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WASocket
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';

import { env } from './config/env.js';
import { character } from './config/character.js';
import {
  Database,
  MessageRepository,
  MentionRepository,
  SummaryRepository,
  BirthdayRepository,
  StatisticsRepository,
  JobExecutionRepository,
  NewsRepository,
  HoroscopeRepository,
  GuardrailsRepository
} from './database/index.js';
import { MetaAIProvider } from './ai/providers/meta-ai.provider.js';
import { ExternalLLMProvider } from './ai/providers/external-llm.provider.js';
import {
  AIService,
  SummaryService,
  MentionService,
  ContextMarkerService,
  BirthdayService,
  StatisticsService,
  InactivityService,
  NewsService,
  CommandService,
  SchedulerService,
  WeatherService,
  HoroscopeService,
  GuardrailsService,
  type SchedulerTargetAdapter
} from './services/index.js';
import { EventHandler } from './bot/event-handler.js';

let currentSocket: WASocket | null = null;
const getSocket = () => currentSocket;

// 1. Inicialización de Base de Datos SQLite (Nativa Node v24)
console.log(`📦 [Database] Conectando base de datos SQLite en: ${env.DB_PATH}`);
const db = Database.getInstance(env.DB_PATH);

// 2. Instanciación de Repositorios
const messageRepo = new MessageRepository(db);
const mentionRepo = new MentionRepository(db);
const summaryRepo = new SummaryRepository(db);
const birthdayRepo = new BirthdayRepository(db);
const statsRepo = new StatisticsRepository(db);
const jobExecutionRepo = new JobExecutionRepository(db);
const newsRepo = new NewsRepository(db);
const horoscopeRepo = new HoroscopeRepository(db);
const guardrailsRepo = new GuardrailsRepository(db);

// 3. Configuración de Proveedores de IA
const metaAiProvider = new MetaAIProvider(env.META_AI_BRIDGE_URL, env.META_AI_TIMEOUT_MS);
const externalProvider = env.AI_API_KEY
  ? new ExternalLLMProvider(env.AI_PROVIDER, env.AI_API_KEY, env.AI_MODEL)
  : undefined;

// 4. Instanciación de Capa de Servicios
const aiService = new AIService({
  metaProvider: metaAiProvider,
  externalProvider
});
const summaryService = new SummaryService(summaryRepo, messageRepo, aiService);
const mentionService = new MentionService(mentionRepo);
const contextMarkerService = new ContextMarkerService(mentionRepo, messageRepo);
const birthdayService = new BirthdayService(birthdayRepo, jobExecutionRepo, aiService);
const statisticsService = new StatisticsService(statsRepo);
const newsService = new NewsService(newsRepo, aiService);
const weatherService = new WeatherService();
const horoscopeService = new HoroscopeService(horoscopeRepo, env.TIMEZONE);
const inactivityService = new InactivityService(messageRepo, statsRepo, aiService, {
  thresholdMs: env.INACTIVITY_THRESHOLD_HOURS * 3600000,
  cooldownMs: env.INACTIVITY_COOLDOWN_HOURS * 3600000,
  mentionTopActive: true,
  timezone: env.TIMEZONE,
  inactiveDaysThreshold: env.INACTIVE_MEMBER_ALERT_DAYS,
  maxGhostAlertsPerDay: env.MAX_GHOST_ALERTS_PER_DAY,
  ghostAlertCooldownMs: env.GHOST_ALERT_COOLDOWN_HOURS * 3600000
});

// 5. Adapter y Servicio de Automatización / Scheduler (00:00, 09:00, 12:00, Inactividad)
const schedulerAdapter: SchedulerTargetAdapter = {
  sendMessage: async (groupJid: string, text: string, options?: { mentions?: string[] }) => {
    if (env.DRY_RUN) {
      console.log(`🧪 [DRY_RUN Scheduler] Para ${groupJid}:\n"${text.slice(0, 100)}..."`);
      return;
    }
    if (currentSocket) {
      await currentSocket.sendMessage(groupJid, {
        text,
        mentions: options?.mentions
      });
    }
  },
  getTargetGroupJid: () => env.TARGET_GROUP_JID,
  getBotCleanJid: () => {
    const rawId = currentSocket?.user?.id;
    return rawId ? rawId.split(':')[0] + '@s.whatsapp.net' : '';
  }
};

const scheduler = new SchedulerService(
  summaryService,
  birthdayService,
  inactivityService,
  newsService,
  weatherService,
  aiService,
  jobExecutionRepo,
  schedulerAdapter,
  env.TIMEZONE
);

const guardrailsService = new GuardrailsService(guardrailsRepo, {
  botInstanceId: 'bot-principal',
  initialAdminSuffixes: env.ADMIN_PHONE_SUFFIX.split(',').map((s) => s.trim()),
  targetGroupJid: env.TARGET_GROUP_JID
});

const commandService = new CommandService(
  summaryService,
  mentionService,
  contextMarkerService,
  birthdayService,
  statisticsService,
  scheduler,
  newsService,
  horoscopeService,
  aiService,
  env.ADMIN_PHONE_SUFFIX,
  guardrailsService
);

// 6. Router de Eventos y Mensajes (Regla 1: activado ante @Bot, cita o intervención espontánea sobre miembros clave)
const eventHandler = new EventHandler({
  getSocket,
  messageRepo,
  mentionService,
  statsRepo,
  commandService,
  aiService,
  guardrailsService,
  birthdayRepo,
  targetGroupJid: env.TARGET_GROUP_JID,
  userCooldownMs: env.COOLDOWN_USER_MS,
  groupCooldownMs: env.COOLDOWN_GROUP_MS,
  spontaneousChance: env.SPONTANEOUS_CHANCE,
  spontaneousCooldownMs: env.SPONTANEOUS_COOLDOWN_MINUTES * 60000,
  spontaneousMessageInterval: env.SPONTANEOUS_MESSAGE_INTERVAL,
  dryRun: env.DRY_RUN
});

console.log('\n======================================================');
console.log(`🤖 INICIANDO BOT ASISTENTE "${character.displayName.toUpperCase()}"`);
console.log('======================================================');
console.log(`🎯 TARGET_GROUP_JID:    ${env.TARGET_GROUP_JID || '(Escuchando en todos los grupos)'}`);
console.log(`⏰ TIMEZONE:            ${env.TIMEZONE}`);
console.log(`🧠 META_AI_BRIDGE_URL:  ${metaAiProvider.isConfigured ? `${env.META_AI_BRIDGE_URL} (wa-metaai)` : '(No configurado)'}`);
console.log(`🌐 Proveedor externo:    ${env.AI_PROVIDER.toUpperCase()} / ${env.AI_MODEL} (${env.AI_API_KEY ? '✅ API Key OK' : '❌ Sin API Key'})`);
console.log(`🧪 DRY_RUN:              ${env.DRY_RUN}`);
console.log('======================================================\n');

// Validación de arranque: al menos un proveedor de IA debe estar disponible
if (!metaAiProvider.isConfigured && !env.AI_API_KEY) {
  console.error('❌ ERROR FATAL: No hay proveedor de IA configurado en .env.');
  process.exit(1);
}

async function startBot(): Promise<void> {
  const authDir = fs.existsSync('./auth_info_baileys') ? './auth_info_baileys' : './auth_info_poc';
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    auth: state,
    printQRInTerminal: false,
    generateHighQualityLinkPreview: false
  });

  currentSocket = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n📲 ESCANEA ESTE CÓDIGO QR PARA VINCULAR EL BOT:');
      qrcode.generate(qr, { small: true });
      console.log('Abre WhatsApp > Dispositivos vinculados > Vincular un dispositivo.\n');
    }

    if (connection === 'close') {
      scheduler.stop();
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`⚠️ Conexión cerrada (status: ${statusCode}). Reconectando: ${shouldReconnect}`);

      if (shouldReconnect) {
        startBot();
      } else {
        console.error(`❌ Sesión cerrada por el servidor. Debes re-vincular en ${authDir}.`);
      }
    } else if (connection === 'open') {
      const botNumber = sock.user?.id.split(':')[0] || sock.user?.id;
      console.log('\n======================================================');
      console.log(`🚀 ¡BOT ASISTENTE ACTIVO Y OPERATIVO!`);
      console.log(`📱 Número: ${botNumber}`);
      console.log(`🎭 Nombre de personaje: ${character.displayName}`);
      console.log('======================================================\n');

      // Iniciar scheduler de tareas programadas
      scheduler.start();
    }
  });

  // Listener de incorporación a grupos con flujo de autorización (Guardrails)
  sock.ev.on('group-participants.update', async (update) => {
    if (update.action !== 'add') return;

    const botFullId = sock.user?.id || '';
    const botCleanJid = botFullId ? botFullId.split(':')[0] + '@s.whatsapp.net' : '';
    const botPhone = botCleanJid.split('@')[0];
    const botLid = sock.user?.lid ? sock.user.lid.split(':')[0] + '@lid' : '';
    const botLidNum = botLid ? botLid.split('@')[0] : '';

    const isBotAdded = update.participants.some(
      (p) => (botPhone && p.includes(botPhone)) || (botLidNum && p.includes(botLidNum))
    );

    if (isBotAdded) {
      const groupJid = update.id;
      if (!guardrailsService.isGroupAuthorized(groupJid)) {
        let groupName = 'Grupo nuevo de WhatsApp';
        try {
          const meta = await sock.groupMetadata(groupJid);
          if (meta?.subject) groupName = meta.subject;
        } catch {}

        const inviter = (update as any).author || 'desconocido';
        const joinReq = guardrailsService.createGroupJoinRequest(groupJid, groupName, inviter);

        console.log(`🛡️ [Guardrails] Bot agregado a grupo no autorizado: "${groupName}" (${groupJid}). Solicitud: ${joinReq.id}`);

        const adminJids = guardrailsService.getAllAdmins().map((a) => a.jid).filter((jid): jid is string => typeof jid === 'string' && jid.includes('@'));
        const alertMsg = [
          '🔔 *SOLICITUD DE INGRESO A NUEVO GRUPO*',
          '---------------------------------------',
          `📌 *Grupo:* ${groupName}`,
          `🆔 *JID:* ${groupJid}`,
          `🔢 *Solicitud:* ${joinReq.id}`,
          '',
          `⏳ *Tenés 12 horas para responder:*`,
          `• Para autorizar: */aprobar ${joinReq.id}*`,
          `• Para rechazar y salir: */rechazar ${joinReq.id}*`,
          '',
          `_Si no se aprueba en 12 horas, el bot abandonará el grupo automáticamente._`
        ].join('\n');

        for (const adminJid of adminJids) {
          try {
            await sock.sendMessage(adminJid, { text: alertMsg });
          } catch (err: any) {
            console.warn(`⚠️ [Guardrails] Error enviando alerta a admin ${adminJid}:`, err?.message || err);
          }
        }
      }
    }
  });

  // Procesamiento de mensajes entrantes con ingestión pasiva + enrutador modular
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      await eventHandler.handleMessage(msg);
    }
  });
}

let groupExpirationInterval: NodeJS.Timeout | null = null;
groupExpirationInterval = setInterval(async () => {
  if (!currentSocket) return;
  try {
    const expiredList = guardrailsService.getExpiredGroupRequests();
    for (const req of expiredList) {
      console.log(`⏰ [Guardrails] Solicitud ${req.id} para "${req.groupName}" expiró tras 12h. Abandonando grupo...`);
      guardrailsService.expireGroupRequest(req.id);
      try {
        await currentSocket.groupLeave(req.groupJid);
        console.log(`👋 [Guardrails] Bot abandonó el grupo expirado: ${req.groupJid}`);
      } catch (e: any) {
        console.warn(`⚠️ [Guardrails] Error saliendo de grupo expirado:`, e?.message || e);
      }

      const adminJids = guardrailsService.getAllAdmins().map((a) => a.jid).filter((jid): jid is string => Boolean(jid));
      const notice = `⏳ *SOLICITUD EXPIRADA*\nLa solicitud *${req.id}* para el grupo "${req.groupName}" no fue aprobada en 12 horas. El bot abandonó el grupo automáticamente.`;
      for (const adminJid of adminJids) {
        try {
          await currentSocket.sendMessage(adminJid, { text: notice });
        } catch {}
      }
    }
  } catch (err: any) {
    console.error('❌ Error verificando solicitudes expiradas:', err?.message || err);
  }
}, 5 * 60 * 1000);

function handleShutdown(signal: string) {
  console.log(`\n🛑 Recibida señal ${signal}. Cerrando bot de forma ordenada...`);
  if (groupExpirationInterval) {
    clearInterval(groupExpirationInterval);
  }
  scheduler.stop();
  db.close();
  if (currentSocket) {
    currentSocket.end(undefined);
  }
  process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

startBot().catch((err) => {
  console.error('❌ Error fatal al iniciar el bot:', err);
});
