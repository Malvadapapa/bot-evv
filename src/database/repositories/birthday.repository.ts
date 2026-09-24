import { Database } from '../db.js';

export interface StoredBirthday {
  userJid: string;
  day: number;
  month: number;
  gender?: 'male' | 'female' | null;
  userName?: string | null;
  updatedAt?: number;
}

export class BirthdayRepository {
  constructor(private db: Database) {}

  public save(
    userJid: string,
    day: number,
    month: number,
    gender?: 'male' | 'female' | null,
    userName?: string | null
  ): void {
    // Si no se pasa género o nombre pero ya existía uno registrado, conservarlo
    const existing = this.get(userJid);
    const finalGender = gender !== undefined ? gender : existing?.gender || null;
    const finalUserName = userName !== undefined ? userName : existing?.userName || null;

    const stmt = this.db.sqlite.prepare(`
      INSERT OR REPLACE INTO birthdays (user_jid, day, month, gender, user_name, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(userJid, day, month, finalGender, finalUserName, Date.now());
  }

  public updateGender(userJid: string, gender: 'male' | 'female', userName?: string | null): void {
    const existing = this.get(userJid);
    if (existing) {
      this.save(userJid, existing.day, existing.month, gender, userName || existing.userName);
    } else {
      // Registrar solo género si aún no ha puesto fecha
      const stmt = this.db.sqlite.prepare(`
        INSERT OR REPLACE INTO birthdays (user_jid, day, month, gender, user_name, updated_at)
        VALUES (?, 0, 0, ?, ?, ?)
      `);
      stmt.run(userJid, gender, userName || null, Date.now());
    }
  }

  public get(userJid: string): StoredBirthday | null {
    const stmt = this.db.sqlite.prepare(`
      SELECT user_jid as userJid, day, month, gender, user_name as userName, updated_at as updatedAt
      FROM birthdays
      WHERE user_jid = ?
    `);
    const row = stmt.get(userJid) as unknown as StoredBirthday | undefined;
    return row || null;
  }

  public getByDate(day: number, month: number): StoredBirthday[] {
    const stmt = this.db.sqlite.prepare(`
      SELECT user_jid as userJid, day, month, gender, user_name as userName, updated_at as updatedAt
      FROM birthdays
      WHERE day = ? AND month = ?
    `);
    return stmt.all(day, month) as unknown as StoredBirthday[];
  }
}
