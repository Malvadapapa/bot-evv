import 'dotenv/config';
import crypto from 'crypto';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  proto,
  generateMessageIDV2,
  type BinaryNode
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { getMessageText } from '../utils/message.js';

const META_AI_BOT_JID = '867051314767696@bot';

console.log('\n======================================================');
console.log('🧪 PRUEBA PROTOCOLO BOT META AI (867051314767696@bot)');
console.log('======================================================\n');

async function runTest() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info_poc');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    auth: state,
    printQRInTerminal: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
      console.log('⚠️ Conexión cerrada. Reconectando...');
      runTest();
    } else if (connection === 'open') {
      console.log('✅ Conexión establecida.');
      console.log(`📱 Usuario: ${sock.user?.id}`);
      console.log(`🤖 Destinatario Meta AI: ${META_AI_BOT_JID}`);
      console.log('------------------------------------------------------\n');

      // Ejecutar la prueba de envío
      await sendBotPrompt(sock, '¿Cuánto es 2 + 2 y por qué?');
    }
  });

  // 0. Capturar el nodo binario crudo que envía WhatsApp para ver cómo viene cifrada la respuesta
  sock.ws.on('CB:message', (node: any) => {
    const from = node.attrs?.from || '';
    if (from.includes('867051') || from.includes('bot') || from.includes('1313555')) {
      console.log('\n🔥 [NODO BINARIO CRUDO RECIBIDO DE META AI]:');
      console.log(
        JSON.stringify(
          node,
          (k, v) => (v instanceof Uint8Array || Buffer.isBuffer(v) ? `<Buffer ${v.length} bytes>` : v),
          2
        )
      );
    }
  });

  // 1. Escuchar mensajes nuevos (messages.upsert)
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    for (const msg of messages) {
      const remoteJid = msg.key.remoteJid || '';
      const text = getMessageText(msg);
      const isFromBot = remoteJid.includes('867051') || remoteJid.includes('@bot') || remoteJid.includes('1313555');

      if (isFromBot || !msg.key.fromMe) {
        console.log(`\n📩 [UPSERT RECIBIDO] JID: "${remoteJid}" | fromMe: ${msg.key.fromMe}`);
        if (text) console.log(`   💬 Texto: "${text}"`);
        const keys = Object.keys(msg.message || {});
        if (keys.length) console.log(`   📦 Tipo mensaje: [${keys.join(', ')}]`);
      }
    }
  });

  // 2. Escuchar ediciones de mensaje (messages.update) -> ¡CLAVE PARA STREAMING DE META AI!
  sock.ev.on('messages.update', (updates) => {
    for (const { key, update } of updates) {
      const remoteJid = key.remoteJid || '';
      const isFromBot = remoteJid.includes('867051') || remoteJid.includes('@bot') || remoteJid.includes('1313555');

      if (isFromBot || !key.fromMe) {
        console.log(`\n🔄 [MESSAGE UPDATE / EDIT RECIBIDO] JID: "${remoteJid}" | ID: ${key.id}`);
        const msgObj = (update as any).message;
        if (msgObj) {
          const editedText = getMessageText({ key, message: msgObj });
          if (editedText) {
            console.log(`\n🎉 [¡RESPUESTA DE META AI RECIBIDA!]:`);
            console.log(`------------------------------------------------------`);
            console.log(`${editedText}`);
            console.log(`------------------------------------------------------\n`);
          } else {
            console.log('   📦 Payload recibido:', JSON.stringify(msgObj, null, 2));
          }
        } else {
          console.log('   ℹ️ Update recibido:', JSON.stringify(update, null, 2));
        }
      }
    }
  });

  // 3. Escuchar receipts (entregado, leído, ticks)
  sock.ev.on('message-receipt.update', (receipts) => {
    for (const r of receipts) {
      if (r.key.remoteJid?.includes('bot')) {
        console.log(`📬 [RECEIPT RECIBIDO] JID: ${r.key.remoteJid} | Status: ${(r.receipt as any)?.readTimestamp ? 'LEÍDO (doble tick)' : 'ENTREGADO'}`);
      }
    }
  });
}

async function sendBotPrompt(sock: any, promptText: string) {
  console.log(`🚀 Preparando invocación para: "${promptText}"`);

  // Paso A: Generar MessageSecret (32 bytes aleatorios)
  const messageSecret = crypto.randomBytes(32);

  // Paso B: Derivar BotMessageSecret mediante HKDF-SHA256 con info="Bot Message"
  const botMessageSecret = Buffer.from(
    crypto.hkdfSync('sha256', messageSecret, Buffer.alloc(0), Buffer.from('Bot Message', 'utf-8'), 32)
  );

  console.log(`🔑 MessageSecret generado (32 bytes).`);
  console.log(`🛡️ BotMessageSecret derivado vía HKDF-SHA256 (32 bytes).`);

  // Paso C: Construir protobuf Message con MessageContextInfo y BotInvokeMessage
  const innerMsg: proto.IMessage = {
    conversation: promptText
  };

  const fullMessage: proto.IMessage = {
    messageContextInfo: {
      messageSecret,
      botMessageSecret,
      botMetadata: {
        invokerJid: sock.user?.id?.split(':')[0] + '@s.whatsapp.net'
      }
    },
    botInvokeMessage: {
      message: innerMsg
    }
  };

  // Paso D: Stanza adicional <bot>
  const additionalNodes: BinaryNode[] = [
    {
      tag: 'bot',
      attrs: { edit: '1' }
    }
  ];

  const msgId = generateMessageIDV2(sock.user?.id);

  console.log(`➡️ Despachando mensaje hacia ${META_AI_BOT_JID} con relayMessage...`);

  try {
    const sentId = await sock.relayMessage(
      META_AI_BOT_JID,
      fullMessage,
      {
        messageId: msgId,
        additionalNodes,
        additionalAttributes: {
          bot_mode: '1'
        }
      }
    );

    console.log(`✅ ¡Relay exitoso! msgId: ${sentId}`);
    console.log('⏳ Esperando eventos (upsert, update o receipt) de Meta AI...\n');
  } catch (error: any) {
    console.error(`❌ Error en relayMessage:`, error?.message || error);
  }
}

runTest().catch(console.error);
