import { Database } from '../db.js';

export interface StoredBirthday {
  userJid: string;
  day: number;
  month: number;
  gender?: 'male' | 'female' | null;
  updatedAt?: number;
}

export class BirthdayRepository {
  constructor(private db: Database) {}

  public save(
    userJid: string,
    day: number,
    month: number,
    gender?: 'male' | 'female' | null
  ): void {
    // Si no se pasa género pero ya existía uno registrado, conservarlo
    const existing = this.get(userJid);
    const finalGender = gender !== undefined ? gender : existing?.gender || null;

    const stmt = this.db.sqlite.prepare(`
      INSERT OR REPLACE INTO birthdays (user_jid, day, month, gender, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(userJid, day, month, finalGender, Date.now());
  }

  public updateGender(userJid: string, gender: 'male' | 'female'): void {
    const existing = this.get(userJid);
    if (existing) {
      this.save(userJid, existing.day, existing.month, gender);
    } else {
      // Registrar solo género si aún no ha puesto fecha
      const stmt = this.db.sqlite.prepare(`
        INSERT OR REPLACE INTO birthdays (user_jid, day, month, gender, updated_at)
        VALUES (?, 0, 0, ?, ?)
      `);
      stmt.run(userJid, gender, Date.now());
    }
  }

  public get(userJid: string): StoredBirthday | null {
    const stmt = this.db.sqlite.prepare(`
      SELECT user_jid as userJid, day, month, gender, updated_at as updatedAt
      FROM birthdays
      WHERE user_jid = ?
    `);
    const row = stmt.get(userJid) as unknown as StoredBirthday | undefined;
    return row || null;
  }

  public getByDate(day: number, month: number): StoredBirthday[] {
    const stmt = this.db.sqlite.prepare(`
      SELECT user_jid as userJid, day, month, gender, updated_at as updatedAt
      FROM birthdays
      WHERE day = ? AND month = ?
    `);
    return stmt.all(day, month) as unknown as StoredBirthday[];
  }
}
