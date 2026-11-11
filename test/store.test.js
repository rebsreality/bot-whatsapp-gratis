import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createSqliteStore } from '../src/store/sqlite.js';
import { createMemoryStore } from '../src/store/memory.js';
import { createUpstashStore } from '../src/store/upstash.js';
import { createStore } from '../src/store/index.js';

const silent = { info() {}, warn() {}, error() {} };

async function exercise(store) {
  for (let i = 1; i <= 10; i++) await store.append('u1', i % 2 ? 'user' : 'model', `m${i}`);
  await store.append('u2', 'user', 'outro');

  const h = await store.getHistory('u1');
  assert.equal(h.length, 8);
  assert.deepEqual(h.map((m) => m.text), ['m3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10']);
  assert.equal(h[0].role, 'user');
  assert.deepEqual(await store.getHistory('u2'), [{ role: 'user', text: 'outro' }]);
  assert.deepEqual(await store.getHistory('ninguem'), []);

  await store.clear('u1');
  assert.deepEqual(await store.getHistory('u1'), []);
}

describe('armazenamento de histórico', () => {
  test('SQLite (node:sqlite) guarda as últimas 8 por cliente', async () => {
    const store = await createSqliteStore({ file: ':memory:', limit: 8 });
    assert.equal(store.kind, 'sqlite');
    await exercise(store);
    await store.close();
  });

  test('memória RAM guarda as últimas 8 por cliente', async () => {
    await exercise(createMemoryStore({ limit: 8 }));
  });

  test('Upstash envia os comandos REST corretos', async () => {
    const lists = new Map();
    const requests = [];
    const fakeFetch = async (url, init) => {
      requests.push({ url, auth: init.headers.Authorization });
      const results = JSON.parse(init.body).map(([cmd, key, a, b]) => {
        const l = lists.get(key) || [];
        if (cmd === 'RPUSH') l.push(a);
        if (cmd === 'LTRIM') lists.set(key, l.slice(Number(a)));
        else lists.set(key, l);
        if (cmd === 'LRANGE') return { result: l.slice(Number(a)) };
        if (cmd === 'DEL') lists.delete(key);
        return { result: 'OK' };
      });
      return new Response(JSON.stringify(results), { status: 200 });
    };
    const store = createUpstashStore({ url: 'https://exemplo.upstash.io/', token: 'TK', limit: 8, fetchImpl: fakeFetch });
    await exercise(store);
    assert.equal(requests[0].url, 'https://exemplo.upstash.io/pipeline');
    assert.equal(requests[0].auth, 'Bearer TK');
  });

  test('createStore escolhe Upstash quando configurado, senão SQLite', async () => {
    const up = await createStore({ historyLimit: 8, upstashUrl: 'https://x', upstashToken: 't' }, silent);
    assert.equal(up.kind, 'upstash');
    const sq = await createStore({ historyLimit: 8, sqlitePath: ':memory:' }, silent);
    assert.equal(sq.kind, 'sqlite');
    await sq.close();
  });
});
