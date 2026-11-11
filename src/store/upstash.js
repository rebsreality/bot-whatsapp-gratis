/**
 * Histórico no Upstash Redis via REST (tier gratuito, sem SDK).
 * Recomendado em produção no Render/Koyeb, onde o disco é apagado a cada deploy/reinício.
 */
export function createUpstashStore({ url, token, limit = 8, ttlSeconds = 60 * 60 * 24 * 30, fetchImpl = fetch }) {
  const base = url.replace(/\/+$/, '');
  const key = (userId) => `wa:hist:${userId}`;

  async function pipeline(commands) {
    const res = await fetchImpl(`${base}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
    });
    if (!res.ok) throw new Error(`Upstash ${res.status}: ${await res.text().catch(() => '')}`);
    const out = await res.json();
    const err = out.find((r) => r.error);
    if (err) throw new Error(`Upstash: ${err.error}`);
    return out.map((r) => r.result);
  }

  return {
    kind: 'upstash',
    async getHistory(userId) {
      const [items] = await pipeline([['LRANGE', key(userId), String(-limit), '-1']]);
      return (items || []).map((s) => JSON.parse(s));
    },
    async append(userId, role, text) {
      const k = key(userId);
      await pipeline([
        ['RPUSH', k, JSON.stringify({ role, text })],
        ['LTRIM', k, String(-limit), '-1'],
        ['EXPIRE', k, String(ttlSeconds)],
      ]);
    },
    async clear(userId) {
      await pipeline([['DEL', key(userId)]]);
    },
    async close() {},
  };
}
