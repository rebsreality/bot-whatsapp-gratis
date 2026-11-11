/** Histórico em memória RAM (fallback; perde tudo ao reiniciar). */
export function createMemoryStore({ limit = 8 } = {}) {
  const data = new Map();
  return {
    kind: 'memory',
    async getHistory(userId) {
      return [...(data.get(userId) || [])];
    },
    async append(userId, role, text) {
      const list = data.get(userId) || [];
      list.push({ role, text });
      data.set(userId, list.slice(-limit));
    },
    async clear(userId) {
      data.delete(userId);
    },
    async close() {},
  };
}
