import fs from 'node:fs';
import path from 'node:path';

/**
 * Histórico em SQLite usando o módulo nativo `node:sqlite` (sem dependências nativas para compilar).
 */
export async function createSqliteStore({ file = './data/historico.db', limit = 8 } = {}) {
  const { DatabaseSync } = await import('node:sqlite');

  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user','model')),
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id, id);
  `);

  const insert = db.prepare('INSERT INTO messages (user_id, role, text) VALUES (?, ?, ?)');
  const prune = db.prepare(`
    DELETE FROM messages WHERE user_id = ? AND id NOT IN (
      SELECT id FROM messages WHERE user_id = ? ORDER BY id DESC LIMIT ?
    )`);
  const select = db.prepare(`
    SELECT role, text FROM (
      SELECT id, role, text FROM messages WHERE user_id = ? ORDER BY id DESC LIMIT ?
    ) ORDER BY id ASC`);
  const del = db.prepare('DELETE FROM messages WHERE user_id = ?');

  return {
    kind: 'sqlite',
    async getHistory(userId) {
      return select.all(userId, limit).map((r) => ({ role: r.role, text: r.text }));
    },
    async append(userId, role, text) {
      insert.run(userId, role, text);
      prune.run(userId, userId, limit);
    },
    async clear(userId) {
      del.run(userId);
    },
    async close() {
      db.close();
    },
  };
}
