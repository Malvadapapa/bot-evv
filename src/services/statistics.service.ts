import { StatisticsRepository, type UserActivityStat } from '../database/repositories/statistics.repository.js';

export class StatisticsService {
  constructor(private statsRepo: StatisticsRepository) {}

  public recordMessage(groupJid: string, userJid: string, userName: string, timestamp: number): void {
    this.statsRepo.recordMessage(groupJid, userJid, userName, timestamp);
  }

  public getTopActiveUsers(groupJid: string, limit: number = 10): UserActivityStat[] {
    return this.statsRepo.getTopActiveUsers(groupJid, limit);
  }

  public formatTopLeaderboard(groupJid: string, limit: number = 10): string {
    const top = this.getTopActiveUsers(groupJid, limit);

    if (top.length === 0) {
      return '📊 No hay estadísticas de actividad registradas todavía en este grupo.';
    }

    const medals = ['🥇', '🥈', '🥉'];
    const lines: string[] = [
      `🏆 *TOP ${top.length} USUARIOS MÁS ACTIVOS*\n`
    ];

    top.forEach((user, idx) => {
      const medal = medals[idx] || `${idx + 1}.`;
      lines.push(`${medal} *${user.userName}* — ${user.messageCount} mensajes`);
    });

    lines.push('\n_¡Sigan participando para no perder el podio!_ 🔥');
    return lines.join('\n');
  }
}
