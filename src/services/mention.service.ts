import { MentionRepository, type StoredMention } from '../database/repositories/mention.repository.js';
import { formatDateTimeCordoba } from '../utils/date.js';

export class MentionService {
  constructor(private mentionRepo: MentionRepository) {}

  /**
   * Registra las menciones detectadas en un mensaje
   */
  public recordMentions(
    groupJid: string,
    messageId: string,
    senderJid: string,
    senderName: string,
    content: string,
    mentionedJids: string[],
    timestamp: number
  ): void {
    if (!mentionedJids || mentionedJids.length === 0) return;

    for (const mentionedUserJid of mentionedJids) {
      // Ignorar si el usuario se menciona a sí mismo
      if (mentionedUserJid === senderJid) continue;

      const mentionId = `${messageId}-${mentionedUserJid}`;
      this.mentionRepo.save({
        id: mentionId,
        groupJid,
        messageId,
        mentionedUserJid,
        mentionedByUserJid: senderJid,
        mentionedByName: senderName,
        messageContent: content,
        timestamp,
        createdAt: Date.now()
      });
    }
  }

  /**
   * Consulta las menciones exclusivas del usuario con paginación
   */
  public getUserMentionsFormatted(userJid: string, page: number = 1, pageSize: number = 5): string {
    const { mentions, total, totalPages } = this.mentionRepo.getUserMentions(userJid, page, pageSize);

    if (total === 0) {
      return '🔔 No tienes menciones registradas en este grupo.';
    }

    if (page > totalPages) {
      return `🔔 Página ${page} no encontrada. El total de páginas disponibles es ${totalPages}.`;
    }

    const lines: string[] = [
      `🔔 *Tus últimas menciones* (Página ${page}/${totalPages} - Total: ${total})\n`
    ];

    for (const m of mentions) {
      const timeStr = formatDateTimeCordoba(m.timestamp);
      lines.push(`• *${m.mentionedByName}* (${timeStr}):`);
      lines.push(`  "${m.messageContent.trim()}"`);
      lines.push('');
    }

    if (totalPages > 1) {
      lines.push(`_Escribe /menciones ${page < totalPages ? page + 1 : 1} para ver más._`);
    }

    return lines.join('\n');
  }

  public getLatestMention(groupJid: string, userJid: string): StoredMention | null {
    return this.mentionRepo.getLatestUserMention(groupJid, userJid);
  }
}
