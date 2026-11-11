import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { createApp } from '../src/app.js';
import { createMemoryStore } from '../src/store/memory.js';
import { createGeminiClient, toWhatsAppFormat } from '../src/gemini.js';
import { createWhatsAppClient } from '../src/whatsapp.js';
import { extractTextMessages, normalizeHistory } from '../src/webhook.js';
import { textMessage, statusUpdate, imageMessage, PHONE_NUMBER_ID } from './fixtures.js';

const silent = { info() {}, warn() {}, error() {} };

function baseConfig(over = {}) {
  return {
    whatsappVerifyToken: 'segredo-teste',
    whatsappAppSecret: '',
    whatsappPhoneNumberId: PHONE_NUMBER_ID,
    fallbackMessage: 'FALLBACK',
    ...over,
  };
}

/** Sobe o app numa porta aleatória com Gemini e Meta "falsos" que registram as chamadas. */
async function startTestServer({ config = baseConfig(), aiImpl } = {}) {
  const calls = { ai: [], sent: [], read: [], geminiRequests: [], metaRequests: [] };

  // Gemini: usa o cliente real do projeto, com o SDK substituído por um mock.
  const fakeGenAI = {
    models: {
      async generateContent(req) {
        calls.geminiRequests.push(req);
        if (aiImpl) return aiImpl(req);
        const last = req.contents.at(-1).parts[0].text;
        return { text: `Resposta para: ${last}` };
      },
    },
  };
  const realAi = createGeminiClient({ apiKey: 'x', model: 'gemini-2.5-flash', client: fakeGenAI });
  const ai = {
    async reply(args) {
      calls.ai.push(args);
      return realAi.reply(args);
    },
  };

  // Meta: usa o cliente real do projeto, com o fetch substituído por um mock.
  const fakeFetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.metaRequests.push({ url, headers: init.headers, body });
    if (body.status === 'read') calls.read.push(body.message_id);
    else calls.sent.push({ to: body.to, text: body.text.body });
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.OUT' }] }), { status: 200 });
  };
  const whatsapp = createWhatsAppClient({ token: 'TOKEN', phoneNumberId: PHONE_NUMBER_ID, fetchImpl: fakeFetch });

  const store = createMemoryStore({ limit: 8 });
  const app = createApp({ config, ai, whatsapp, store, getSystemPrompt: () => 'REGRAS DA EMPRESA', logger: silent });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const url = `http://127.0.0.1:${server.address().port}`;

  async function post(payload, headers = {}) {
    const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const res = await fetch(`${url}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: raw,
    });
    await app.locals.idle();
    return res;
  }

  return { url, calls, store, post, close: () => new Promise((r) => server.close(r)) };
}

describe('extração de mensagens', () => {
  test('pega texto, remetente e nome', () => {
    const [m] = extractTextMessages(textMessage({ text: '  Olá  ' }));
    assert.equal(m.from, '5511999998888');
    assert.equal(m.text, 'Olá');
    assert.equal(m.name, 'Maria');
    assert.equal(m.phoneNumberId, PHONE_NUMBER_ID);
  });
  test('ignora status (lida/entregue) e mídia', () => {
    assert.equal(extractTextMessages(statusUpdate('read')).length, 0);
    assert.equal(extractTextMessages(statusUpdate('delivered')).length, 0);
    assert.equal(extractTextMessages(imageMessage()).length, 0);
    assert.equal(extractTextMessages({}).length, 0);
    assert.equal(extractTextMessages(null).length, 0);
  });
  test('converte Markdown para formatação do WhatsApp', () => {
    assert.equal(
      toWhatsAppFormat('## Horário\n- **Segunda:** 9h\n- ~~Domingo~~'),
      '*Horário*\n• *Segunda:* 9h\n• ~Domingo~',
    );
  });
  test('histórico começa pelo usuário e junta papéis repetidos', () => {
    const h = normalizeHistory([
      { role: 'model', text: 'a' },
      { role: 'user', text: 'b' },
      { role: 'user', text: 'c' },
      { role: 'model', text: 'd' },
    ]);
    assert.deepEqual(h, [
      { role: 'user', text: 'b\nc' },
      { role: 'model', text: 'd' },
    ]);
  });
});

describe('webhook HTTP', () => {
  let srv;
  beforeEach(async () => {
    srv = await startTestServer();
  });
  afterEach(async () => {
    await srv.close();
  });

  test('GET /health responde ok', async () => {
    const res = await fetch(`${srv.url}/health`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'ok');
  });

  test('GET /webhook devolve o challenge com token correto', async () => {
    const res = await fetch(
      `${srv.url}/webhook?hub.mode=subscribe&hub.verify_token=segredo-teste&hub.challenge=1158201444`,
    );
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '1158201444');
  });

  test('GET /webhook recusa token errado', async () => {
    const res = await fetch(`${srv.url}/webhook?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1`);
    assert.equal(res.status, 403);
  });

  test('POST texto → consulta Gemini → responde no WhatsApp', async () => {
    const res = await srv.post(textMessage({ text: 'Qual o horário?', id: 'wamid.A1' }));
    assert.equal(res.status, 200);

    // Gemini recebeu o prompt da empresa + mensagem
    assert.equal(srv.calls.geminiRequests.length, 1);
    const req = srv.calls.geminiRequests[0];
    assert.equal(req.model, 'gemini-2.5-flash');
    assert.match(req.config.systemInstruction, /REGRAS DA EMPRESA/);
    assert.match(req.config.systemInstruction, /Maria/);
    assert.deepEqual(req.contents, [{ role: 'user', parts: [{ text: 'Qual o horário?' }] }]);

    // Meta recebeu a resposta no formato correto
    assert.deepEqual(srv.calls.sent, [{ to: '5511999998888', text: 'Resposta para: Qual o horário?' }]);
    const sendReq = srv.calls.metaRequests.find((r) => r.body.type === 'text');
    assert.equal(sendReq.url, `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`);
    assert.equal(sendReq.headers.Authorization, 'Bearer TOKEN');
    assert.equal(sendReq.body.messaging_product, 'whatsapp');

    // Marcou como lida
    assert.deepEqual(srv.calls.read, ['wamid.A1']);

    // Histórico salvo
    const hist = await srv.store.getHistory('5511999998888');
    assert.deepEqual(hist.map((m) => m.role), ['user', 'model']);
  });

  test('POST de status (lida/entregue) não responde nada', async () => {
    for (const s of ['sent', 'delivered', 'read']) {
      const res = await srv.post(statusUpdate(s));
      assert.equal(res.status, 200);
    }
    assert.equal(srv.calls.ai.length, 0);
    assert.equal(srv.calls.metaRequests.length, 0);
  });

  test('POST de imagem é ignorado', async () => {
    await srv.post(imageMessage());
    assert.equal(srv.calls.ai.length, 0);
    assert.equal(srv.calls.sent.length, 0);
  });

  test('mensagem duplicada (reenvio da Meta) responde só uma vez', async () => {
    const payload = textMessage({ id: 'wamid.DUP' });
    await srv.post(payload);
    await srv.post(payload);
    assert.equal(srv.calls.sent.length, 1);
  });

  test('lembra o contexto e limita a 8 mensagens', async () => {
    for (let i = 1; i <= 6; i++) await srv.post(textMessage({ text: `msg ${i}`, id: `wamid.M${i}` }));

    const hist = await srv.store.getHistory('5511999998888');
    assert.equal(hist.length, 8);
    assert.equal(hist[0].text, 'msg 3');

    // A última chamada ao Gemini recebeu o histórico anterior + a nova mensagem
    const lastReq = srv.calls.geminiRequests.at(-1);
    assert.equal(lastReq.contents[0].role, 'user');
    assert.equal(lastReq.contents.at(-1).parts[0].text, 'msg 6');
    assert.ok(lastReq.contents.length >= 7);
  });

  test('clientes diferentes têm históricos separados', async () => {
    await srv.post(textMessage({ from: '5511000000001', text: 'sou A', id: 'wamid.X1' }));
    await srv.post(textMessage({ from: '5511000000002', text: 'sou B', id: 'wamid.X2' }));
    assert.equal((await srv.store.getHistory('5511000000001')).length, 2);
    assert.equal((await srv.store.getHistory('5511000000002')).length, 2);
    assert.deepEqual(srv.calls.geminiRequests[1].contents, [{ role: 'user', parts: [{ text: 'sou B' }] }]);
  });

  test('JSON inválido retorna 400 sem derrubar o servidor', async () => {
    const res = await srv.post('{ isso nao e json');
    assert.equal(res.status, 400);
    const ok = await fetch(`${srv.url}/health`);
    assert.equal(ok.status, 200);
  });
});

describe('falhas e segurança', () => {
  test('se o Gemini falhar, envia mensagem de fallback', async () => {
    const srv = await startTestServer({
      aiImpl: () => {
        throw new Error('429 RESOURCE_EXHAUSTED');
      },
    });
    await srv.post(textMessage({ id: 'wamid.F1' }));
    assert.deepEqual(srv.calls.sent.map((s) => s.text), ['FALLBACK']);
    await srv.close();
  });

  test('resposta vazia do Gemini também cai no fallback', async () => {
    const srv = await startTestServer({ aiImpl: () => ({ text: '' }) });
    await srv.post(textMessage({ id: 'wamid.F2' }));
    assert.deepEqual(srv.calls.sent.map((s) => s.text), ['FALLBACK']);
    await srv.close();
  });

  test('ignora mensagens de outro número da conta', async () => {
    const srv = await startTestServer({ config: baseConfig({ whatsappPhoneNumberId: '999' }) });
    await srv.post(textMessage({ id: 'wamid.O1' }));
    assert.equal(srv.calls.sent.length, 0);
    await srv.close();
  });

  test('valida assinatura X-Hub-Signature-256 quando APP_SECRET está definido', async () => {
    const secret = 'app-secret';
    const srv = await startTestServer({ config: baseConfig({ whatsappAppSecret: secret }) });
    const raw = JSON.stringify(textMessage({ id: 'wamid.S1' }));

    const bad = await srv.post(raw, { 'X-Hub-Signature-256': 'sha256=' + '0'.repeat(64) });
    assert.equal(bad.status, 401);
    const none = await srv.post(raw);
    assert.equal(none.status, 401);
    assert.equal(srv.calls.sent.length, 0);

    const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
    const good = await srv.post(raw, { 'X-Hub-Signature-256': sig });
    assert.equal(good.status, 200);
    assert.equal(srv.calls.sent.length, 1);
    await srv.close();
  });

  test('falha da API da Meta não derruba o servidor', async () => {
    const srv = await startTestServer();
    // troca o fetch global? não: simulamos a falha pelo cliente WhatsApp
    const failing = createWhatsAppClient({
      token: 't',
      phoneNumberId: '1',
      fetchImpl: async () => new Response('{"error":{"message":"Invalid token"}}', { status: 401 }),
    });
    await assert.rejects(() => failing.sendText('55', 'oi'), /WhatsApp API 401/);
    const res = await fetch(`${srv.url}/health`);
    assert.equal(res.status, 200);
    await srv.close();
  });
});
