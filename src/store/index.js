import { createMemoryStore } from './memory.js';
import { createSqliteStore } from './sqlite.js';
import { createUpstashStore } from './upstash.js';

/**
 * Escolhe o armazenamento: Upstash (se configurado) → SQLite → memória RAM.
 */
export async function createStore(cfg, logger = console) {
  const limit = cfg.historyLimit;

  if (cfg.upstashUrl && cfg.upstashToken) {
    logger.info?.('[store] usando Upstash Redis');
    return createUpstashStore({ url: cfg.upstashUrl, token: cfg.upstashToken, limit });
  }

  try {
    const store = await createSqliteStore({ file: cfg.sqlitePath, limit });
    logger.info?.(`[store] usando SQLite em ${cfg.sqlitePath}`);
    return store;
  } catch (err) {
    logger.warn?.(`[store] SQLite indisponível (${err.message}); usando memória RAM`);
    return createMemoryStore({ limit });
  }
}
