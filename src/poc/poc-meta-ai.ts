import 'dotenv/config';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WAMessage
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { getMessageText, getMentionedJids, getSenderJid } from '../utils/message.js';

// Logger con nivel configurable
const logLevel = (process.env.LOG_LEVEL || 'info') as pino.LevelWithSilent;
const logger = pino({
  level: logLevel,
  transport: {
    target: 'pino-pretty',
    options: { colorize: true, ignore: 'pid,hostname' }
  }
});

const TARGET_GROUP_JID = process.env.TARGET_GROUP_JID?.trim() || '';
const META_AI_JID = process.env.META_AI_JID?.trim() || '';

console.log('\n======================================================');
console.log('🤖 INICIANDO FASE 1: PRUEBA DE CONCEPTO (META AI REDIRECT)');
console.log('======================================================');
console.log(`📌 TARGET_GROUP_JID configurado: ${TARGET_GROUP_JID || '(No configurado aún en .env)'}`);
console.log(`📌 META_AI_JID configurado:       ${META_AI_JID || '(No configurado aún en .env)'}`);
console.log('------------------------------------------------------\n');

// Cola o promesas pendientes para respuestas de Meta AI
interface PendingQuery {
  id: string;
  originalMsg: WAMessage;
  groupJid: string;
  questionText: string;
  sentTimestamp: number;
  resolve: (replyText: string) => void;
  reject: (err: Error) => void;
}

const pendingQueries: PendingQuery[] = [];

async function startPoc() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info_poc');
  const { version, isLatest } = await fetchLatestBaileysVersion();

  logger.info(`Versión de WhatsApp Web: ${version.join('.')} (isLatest: ${isLatest})`);

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }), // Silenciamos logs internos de Baileys para dar visibilidad limpia a la PoC
    auth: state,
    printQRInTerminal: false, // Lo manejamos nosotros con qrcode-terminal
    generateHighQualityLinkPreview: false
  });

  // Guardar credenciales al actualizarse
  sock.ev.on('creds.update', saveCreds);

  // Manejo de conexión y QR
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n📲 ESCANEA ESTE CÓDIGO QR CON TU WHATSAPP:');
      qrcode.generate(qr, { small: true });
      console.log('Abre WhatsApp > Dispositivos vinculados > Vincular un dispositivo.\n');
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`⚠️ Conexión cerrada. Motivo statusCode: ${statusCode}. Reconectar: ${shouldReconnect}`);

      if (shouldReconnect) {
        console.log('🔄 Reconectando socket...');
        startPoc();
      } else {
        console.log('❌ Sesión cerrada permanentemente (Logged out). Borra auth_info_poc y vuelve a escanear.');
      }
    } else if (connection === 'open') {
      const botNumber = sock.user?.id.split(':')[0] || sock.user?.id || 'Desconocido';
      console.log('\n======================================================');
      console.log(`✅ ¡CONEXIÓN ESTABLECIDA EXITOSAMENTE!`);
      console.log(`📱 Número del bot: ${botNumber}`);
      console.log('======================================================');

      // Sondeo de números conocidos de Meta AI
      try {
        console.log('🔍 [SONDEO] Verificando números oficiales de Meta AI en WhatsApp...');
        const metaCandidates = ['13135550002', '13135550000', '13135550001'];
        const results = await sock.onWhatsApp(...metaCandidates);
        if (results && Array.isArray(results)) {
          for (const res of results) {
            if (res.exists) {
              console.log(`⭐ META AI ENCONTRADO: JID "${res.jid}" (Colócalo en META_AI_JID en tu .env)`);
            }
          }
        }
      } catch (err: any) {
        console.log('Info de sondeo:', err?.message || err);
      }

      if (!META_AI_JID) {
        console.log('\n👉 [HERRAMIENTA DE DESCUBRIMIENTO]');
        console.log('   Si tu WhatsApp usa un chat de Meta AI diferente:');
        console.log('   1. Abre WhatsApp en tu celular.');
        console.log('   2. Entra al chat oficial de Meta AI (icono de círculo azul/violeta).');
        console.log('   3. Escribe cualquier mensaje y observa el JID que aparece aquí.');
        console.log('------------------------------------------------------\n');
      }
    }
  });

  // Escuchar actualización de chats para descubrir JID de Meta AI en la lista de conversaciones
  sock.ev.on('chats.upsert', (chats) => {
    for (const chat of chats) {
      if (chat.id && (chat.id.includes('meta') || chat.id.includes('bot') || chat.id.startsWith('1313') || chat.name?.toLowerCase().includes('meta'))) {
        console.log(`🔥 [CHAT DE META DETECTADO EN BANDEJA] JID: "${chat.id}" | Nombre: "${chat.name || ''}"`);
      }
    }
  });

  // Escuchar mensajes entrantes y salientes (notify y append)
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const msg of messages) {
      const remoteJid = msg.key.remoteJid || '';
      const fromMe = msg.key.fromMe;
      const text = getMessageText(msg).trim();
      const sender = getSenderJid(msg);
      const pushName = msg.pushName || (fromMe ? 'Tú (desde celular)' : 'Desconocido');
      const msgKeys = Object.keys(msg.message || {}).join(', ');

      // Log completo de descubrimiento para diagnosticar cualquier interacción
      const isGroup = remoteJid.endsWith('@g.us');
      if (!isGroup) {
        console.log(`📩 [CHAT PRIVADO/CONTACTO] JID: "${remoteJid}" | De: ${pushName} | fromMe: ${fromMe} | Evento: ${type}`);
        if (text) {
          console.log(`   💬 Texto: "${text.slice(0, 80)}"`);
        } else if (msgKeys) {
          console.log(`   📦 Tipo de contenido: [${msgKeys}]`);
        }
        if (remoteJid.includes('meta') || remoteJid.includes('bot') || remoteJid.startsWith('1313') || pushName.toLowerCase().includes('meta')) {
          console.log(`   👉 ⭐ POSIBLE JID DE META AI: "${remoteJid}"`);
        }
      } else if (!TARGET_GROUP_JID || remoteJid === TARGET_GROUP_JID) {
        console.log(`📢 [GRUPO] JID: "${remoteJid}" | De: ${pushName} | Texto: "${text.slice(0, 60)}"`);
      }

      // -------------------------------------------------------------------
      // 1. RECEPCIÓN DE RESPUESTAS DE META AI
      // -------------------------------------------------------------------
      const metaJid = process.env.META_AI_JID?.trim() || META_AI_JID || '13135550002@s.whatsapp.net';
      const isMetaAiMessage =
        remoteJid === metaJid ||
        remoteJid.includes('1313555') ||
        remoteJid.toLowerCase().includes('meta');

      if (isMetaAiMessage && !fromMe && text) {
        console.log(`\n🤖 [Fase 1] [3/4] Respuesta recibida de Meta AI (${remoteJid}):`);
        console.log(`📄 Vista previa: "${text.slice(0, 100)}..." (${text.length} caracteres)`);

        if (pendingQueries.length > 0) {
          const query = pendingQueries.shift()!;
          query.resolve(text);
        } else {
          console.log('ℹ️ (No había preguntas pendientes en la cola para esta respuesta)');
        }
        continue;
      }

      // -------------------------------------------------------------------
      // 2. RECEPCIÓN DE PREGUNTAS EN EL GRUPO OBJETIVO
      // -------------------------------------------------------------------
      if (fromMe) continue; // Nunca procesar mensajes propios para evitar bucles

      // Verificar si el mensaje pertenece al grupo objetivo
      const isTargetGroup = TARGET_GROUP_JID ? remoteJid === TARGET_GROUP_JID : remoteJid.endsWith('@g.us');
      if (!isTargetGroup) continue;

      // Verificar trigger (@bot, mención de teléfono o mención de LID del bot)
      const botPhone = sock.user?.id ? sock.user.id.split(':')[0] : '';
      const botCleanId = botPhone ? `${botPhone}@s.whatsapp.net` : '';
      const botLid = sock.user?.lid ? sock.user.lid.split(':')[0] + '@lid' : '';
      const mentions = getMentionedJids(msg);

      const isMentioned =
        text.toLowerCase().includes('@bot') ||
        (botCleanId && mentions.includes(botCleanId)) ||
        (botLid && mentions.includes(botLid)) ||
        (botPhone && text.includes(botPhone)) ||
        mentions.some((j) => (botPhone && j.includes(botPhone)) || (botLid && j.includes(botLid.split('@')[0])));

      if (!isMentioned) continue;

      // Extraer pregunta limpia (removiendo tags de mención)
      const question = text
        .replace(/@bot/gi, '')
        .replace(/@\d+/g, '')
        .trim() || text;

      console.log('\n======================================================');
      console.log(`📥 [Fase 1] [1/4] Mensaje recibido en grupo [${remoteJid}]`);
      console.log(`👤 Remitente: ${pushName} (${sender})`);
      console.log(`💬 Pregunta a Meta AI: "${question}"`);

      const targetMetaJid = process.env.META_AI_JID?.trim() || META_AI_JID || '13135550002@s.whatsapp.net';
      if (!targetMetaJid) {
        console.log('❌ ERROR: META_AI_JID no está configurado en .env.');
        console.log('   Configura META_AI_JID en tu archivo .env y reinicia el script.');
        await sock.sendMessage(
          remoteJid,
          { text: '⚠️ Error de configuración: META_AI_JID no está definido en el archivo .env.' },
          { quoted: msg }
        );
        continue;
      }

      // Despachar a Meta AI
      try {
        console.log(`➡️ [Fase 1] [2/4] Reenviando texto tal cual a Meta AI (${targetMetaJid})...`);
        await sock.sendMessage(targetMetaJid, { text: question });
        console.log(`✅ [Fase 1] [2/4] Mensaje enviado a Meta AI. Esperando respuesta...`);

        // Esperar la respuesta con heartbeat
        const replyText = await waitForMetaAiResponse({
          msg,
          groupJid: remoteJid,
          questionText: question
        });

        // Reenviar respuesta al grupo citando el mensaje original
        console.log(`📤 [Fase 1] [4/4] Reenviando respuesta al grupo citando el mensaje original...`);
        await sock.sendMessage(
          remoteJid,
          { text: replyText },
          { quoted: msg }
        );
        console.log(`🎉 [Fase 1] [4/4] ¡Flujo completado exitosamente!`);
        console.log('======================================================\n');
      } catch (error: any) {
        console.error(`❌ Error durante el flujo de Meta AI:`, error?.message || error);
        await sock.sendMessage(
          remoteJid,
          { text: `⚠️ Error procesando la respuesta con Meta AI: ${error?.message || 'Error desconocido'}` },
          { quoted: msg }
        );
      }
    }
  });
}

/**
 * Espera la respuesta de Meta AI con logs periódicos de actividad
 */
function waitForMetaAiResponse(params: { msg: WAMessage; groupJid: string; questionText: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const queryId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // Intervalo de logging "esperando respuesta..."
    const interval = setInterval(() => {
      const elapsedSec = Math.round((Date.now() - startTime) / 1000);
      console.log(`⏳ [Fase 1] [3/4] Esperando respuesta de Meta AI... (${elapsedSec}s transcurridos)`);
    }, 4000);

    const pendingItem: PendingQuery = {
      id: queryId,
      originalMsg: params.msg,
      groupJid: params.groupJid,
      questionText: params.questionText,
      sentTimestamp: startTime,
      resolve: (replyText: string) => {
        clearInterval(interval);
        resolve(replyText);
      },
      reject: (err: Error) => {
        clearInterval(interval);
        reject(err);
      }
    };

    pendingQueries.push(pendingItem);
  });
}

// Iniciar PoC
startPoc().catch((err) => {
  console.error('Error fatal al iniciar PoC:', err);
});
