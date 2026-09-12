import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from './schema.js';

export class Database {
  private static instance: Database | null = null;
  public readonly sqlite: DatabaseSync;

  constructor(dbPath: string = './data/bot.db') {
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.sqlite = new DatabaseSync(dbPath);

    if (dbPath !== ':memory:') {
      this.sqlite.exec('PRAGMA journal_mode = WAL;');
      this.sqlite.exec('PRAGMA synchronous = NORMAL;');
    }

    // Inicializar tablas e índices
    this.sqlite.exec(SCHEMA_SQL);

    // Migración idempotente para bases de datos existentes
    try {
      this.sqlite.exec('ALTER TABLE birthdays ADD COLUMN gender TEXT;');
    } catch {
      // La columna ya existe, ignorar error
    }
  }

  public static getInstance(dbPath?: string): Database {
    if (!Database.instance) {
      Database.instance = new Database(dbPath);
    }
    return Database.instance;
  }

  public static createInMemory(): Database {
    return new Database(':memory:');
  }

  public close(): void {
    this.sqlite.close();
    if (Database.instance === this) {
      Database.instance = null;
    }
  }
}
