import { MentionRepository } from '../database/repositories/mention.repository.js';
import { MessageRepository } from '../database/repositories/message.repository.js';
import { formatTimeCordoba } from '../utils/date.js';

export interface MarkerResult {
  text: string;
  quotedMessageId?: string;
}

export class ContextMarkerService {
  constructor(
    private mentionRepo: MentionRepository,
    private messageRepo: MessageRepository
  ) {}

  public getContextForUser(
    groupJid: string,
    userJid: string,
    beforeCount: number = 3,
    afterCount: number = 3
  ): MarkerResult {
    const latestMention = this.mentionRepo.getLatestUserMention(groupJid, userJid);

    if (!latestMention) {
      return {
        text: '📍 No tienes menciones registradas en este grupo para marcar contexto.'
      };
    }

    const context = this.messageRepo.getContextAround(
      groupJid,
      latestMention.timestamp,
      beforeCount,
      afterCount
    );

    const lines: string[] = [
      `📍 *Contexto de tu última mención*`,
      `Mencionado por *${latestMention.mentionedByName}* (${formatTimeCordoba(latestMention.timestamp)}):\n`
    ];

    if (context.before.length > 0) {
      lines.push('--- [Antes] ---');
      for (const msg of context.before) {
        lines.push(`• ${msg.senderName} (${formatTimeCordoba(msg.timestamp)}): ${msg.content}`);
      }
      lines.push('');
    }

    lines.push('👉 *[MENCIÓN]*');
    lines.push(`• *${latestMention.mentionedByName}*: ${latestMention.messageContent}`);
    lines.push('');

    if (context.after.length > 0) {
      lines.push('--- [Después] ---');
      for (const msg of context.after) {
        lines.push(`• ${msg.senderName} (${formatTimeCordoba(msg.timestamp)}): ${msg.content}`);
      }
      lines.push('');
    }

    lines.push('💡 _He citado el mensaje original de la mención para que puedas ubicarlo en el chat._');

    return {
      text: lines.join('\n'),
      quotedMessageId: latestMention.messageId
    };
  }
}
