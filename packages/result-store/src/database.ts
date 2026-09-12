import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Local persistent database. Values contain no signer keys. Queries use bound parameters. */
export class CommonDatabase {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records (namespace TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(namespace,id)) STRICT;`);
  }
  get<T>(namespace: string, id: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM records WHERE namespace=? AND id=?').get(namespace, id);
    return row ? JSON.parse(row['value'] as string) as T : undefined;
  }
  set(namespace: string, id: string, value: unknown): void {
    this.db.prepare('INSERT INTO records(namespace,id,value) VALUES(?,?,?) ON CONFLICT(namespace,id) DO UPDATE SET value=excluded.value').run(namespace, id, JSON.stringify(value));
  }
  insert(namespace: string, id: string, value: unknown): boolean {
    return this.db.prepare('INSERT OR IGNORE INTO records(namespace,id,value) VALUES(?,?,?)').run(namespace, id, JSON.stringify(value)).changes === 1;
  }
  remove(namespace: string, id: string): void { this.db.prepare('DELETE FROM records WHERE namespace=? AND id=?').run(namespace, id); }
  list<T>(namespace: string): { id: string; value: T }[] {
    return this.db.prepare('SELECT id,value FROM records WHERE namespace=? ORDER BY id').all(namespace).map(row => ({ id: row['id'] as string, value: JSON.parse(row['value'] as string) as T }));
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      if (value && typeof (value as { then?: unknown }).then === 'function') throw new Error('Database transactions must be synchronous');
      this.db.exec('COMMIT'); return value;
    } catch (err) { this.db.exec('ROLLBACK'); throw err; }
  }
  close(): void { this.db.close(); }
}
