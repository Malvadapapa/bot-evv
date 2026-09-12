import type { proto, WAMessage } from '@whiskeysockets/baileys';

/**
 * Desempaqueta mensajes anidados (como mensajes efímeros o view once)
 */
export function unwrapMessage(message: proto.IMessage | null | undefined): proto.IMessage | undefined {
  if (!message) return undefined;

  if (message.ephemeralMessage?.message) {
    return unwrapMessage(message.ephemeralMessage.message);
  }
  if (message.viewOnceMessage?.message) {
    return unwrapMessage(message.viewOnceMessage.message);
  }
  if (message.viewOnceMessageV2?.message) {
    return unwrapMessage(message.viewOnceMessageV2.message);
  }
  if (message.documentWithCaptionMessage?.message) {
    return unwrapMessage(message.documentWithCaptionMessage.message);
  }

  if (message.editedMessage?.message) {
    return unwrapMessage(message.editedMessage.message);
  }

  return message;
}

/**
 * Extrae el texto legible de un mensaje de WhatsApp
 */
export function getMessageText(msg: WAMessage): string {
  const inner = unwrapMessage(msg.message);
  if (!inner) return '';

  if (inner.conversation) {
    return inner.conversation;
  }
  if (inner.extendedTextMessage?.text) {
    return inner.extendedTextMessage.text;
  }
  if (inner.imageMessage?.caption) {
    return inner.imageMessage.caption;
  }
  if (inner.videoMessage?.caption) {
    return inner.videoMessage.caption;
  }
  if ((inner as any).interactiveResponseMessage?.body?.text) {
    return (inner as any).interactiveResponseMessage.body.text;
  }
  if ((inner as any).interactiveMessage?.body?.text) {
    return (inner as any).interactiveMessage.body.text;
  }
  if ((inner as any).templateButtonReplyMessage?.selectedDisplayText) {
    return (inner as any).templateButtonReplyMessage.selectedDisplayText;
  }
  if ((inner as any).buttonsResponseMessage?.selectedDisplayText) {
    return (inner as any).buttonsResponseMessage.selectedDisplayText;
  }
  if ((inner as any).botInvokeMessage) {
    const botMsg = (inner as any).botInvokeMessage;
    if (botMsg.message) return getMessageText({ ...msg, message: botMsg.message });
  }

  return '';
}

/**
 * Extrae la lista de JIDs mencionados en el mensaje
 */
export function getMentionedJids(msg: WAMessage): string[] {
  const inner = unwrapMessage(msg.message);
  if (!inner) return [];

  const contextInfo =
    inner.extendedTextMessage?.contextInfo ||
    inner.imageMessage?.contextInfo ||
    inner.videoMessage?.contextInfo;

  return contextInfo?.mentionedJid || [];
}

/**
 * Extrae el JID del remitente real (en grupo o chat privado)
 */
export function getSenderJid(msg: WAMessage): string {
  return msg.key.participant || msg.participant || msg.key.remoteJid || '';
}

/**
 * Obtiene el contexto del mensaje citado si existe
 */
export function getQuotedContext(msg: WAMessage) {
  const inner = unwrapMessage(msg.message);
  if (!inner) return null;

  const contextInfo =
    inner.extendedTextMessage?.contextInfo ||
    inner.imageMessage?.contextInfo ||
    inner.videoMessage?.contextInfo;

  if (!contextInfo?.quotedMessage) return null;

  const quotedInner = unwrapMessage(contextInfo.quotedMessage);
  const quotedText =
    quotedInner?.conversation ||
    quotedInner?.extendedTextMessage?.text ||
    quotedInner?.imageMessage?.caption ||
    '';

  return {
    participant: contextInfo.participant,
    text: quotedText,
    stanzaId: contextInfo.stanzaId
  };
}
