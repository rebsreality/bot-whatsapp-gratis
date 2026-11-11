import crypto from 'node:crypto';

/**
 * Extrai apenas mensagens de TEXTO do payload da Meta.
 * Ignora: status (sent/delivered/read/failed), áudio, imagem, figurinha, reações, etc.
 */
export function extractTextMessages(body) {
  const out = [];
  if (!body || body.object !== 'whatsapp_business_account' || !Array.isArray(body.entry)) return out;

  for (const entry of body.entry) {
    for (const change of entry?.changes || []) {
      if (change?.field !== 'messages') continue;
      const value = change.value || {};
      const contacts = value.contacts || [];
      for (const msg of value.messages || []) {
        if (msg?.type !== 'text' || !msg.text?.body || !msg.from) continue;
        const contact = contacts.find((c) => c.wa_id === msg.from) || contacts[0];
        out.push({
          id: msg.id,
          from: msg.from,
          text: msg.text.body.trim(),
          name: contact?.profile?.name || '',
          phoneNumberId: value.metadata?.phone_number_id || '',
          timestamp: Number(msg.timestamp) || 0,
        });
      }
    }
  }
  return out.filter((m) => m.text);
}

/** Valida o header X-Hub-Signature-256 (HMAC-SHA256 do corpo bruto com o App Secret). */
export function isValidSignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret) return true; // validação desligada
  if (!rawBody || typeof signatureHeader !== 'string' || !signatureHeader.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const received = signatureHeader.slice('sha256='.length);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(received, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Esconde o meio do número nos logs (privacidade). */
export const mask = (n) => String(n).replace(/^(\d{4})\d+(\d{4})$/, '$1****$2');

/** Gemini exige que a conversa comece pelo usuário; também juntamos falas seguidas do mesmo papel. */
export function normalizeHistory(history) {
  const out = [];
  for (const m of history) {
    if (!out.length && m.role !== 'user') continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.text += `\n${m.text}`;
    else out.push({ role: m.role, text: m.text });
  }
  return out;
}

/**
 * Cria o processador de mensagens: histórico → Gemini → resposta no WhatsApp.
 * Mensagens do mesmo cliente são processadas em fila (ordem garantida).
 */
export function createMessageHandler({
  ai,
  whatsapp,
  store,
  getSystemPrompt,
  fallbackMessage,
  phoneNumberId = '',
  logger = console,
}) {
  const seen = new Set(); // deduplicação: a Meta reenvia o webhook se não receber 200 a tempo
  const SEEN_MAX = 5000;
  const queues = new Map();

  function alreadySeen(id) {
    if (!id) return false;
    if (seen.has(id)) return true;
    seen.add(id);
    if (seen.size > SEEN_MAX) seen.delete(seen.values().next().value);
    return false;
  }

  async function process(msg) {
    whatsapp.markAsRead(msg.id).catch((err) => logger.warn?.(`[wa] markAsRead falhou: ${err.message}`));

    const previous = await store.getHistory(msg.from);
    await store.append(msg.from, 'user', msg.text);

    let systemPrompt = getSystemPrompt();
    if (msg.name) systemPrompt += `\n\n(O nome do cliente no WhatsApp é: ${msg.name})`;

    let reply;
    try {
      reply = await ai.reply({
        systemPrompt,
        history: normalizeHistory([...previous, { role: 'user', text: msg.text }]),
      });
    } catch (err) {
      logger.error?.(`[ai] erro ao gerar resposta: ${err.message}`);
      await whatsapp.sendText(msg.from, fallbackMessage);
      return { status: 'fallback' };
    }

    await whatsapp.sendText(msg.from, reply);
    await store.append(msg.from, 'model', reply);
    logger.info?.(`[webhook] ✅ respondido para ${mask(msg.from)}`);
    return { status: 'replied', reply };
  }

  return function handle(msg) {
    logger.info?.(`[webhook] 📩 mensagem de ${mask(msg.from)} para o número ${msg.phoneNumberId}`);
    if (phoneNumberId && msg.phoneNumberId && msg.phoneNumberId !== phoneNumberId) {
      logger.warn?.(
        `[webhook] ⚠️ ignorada: WHATSAPP_PHONE_NUMBER_ID=${phoneNumberId}, mas a mensagem chegou no número ` +
          `${msg.phoneNumberId}. Corrija a variável no Render para ${msg.phoneNumberId}.`,
      );
      return Promise.resolve({ status: 'ignored-other-number' });
    }
    if (alreadySeen(msg.id)) return Promise.resolve({ status: 'duplicate' });

    const prev = queues.get(msg.from) || Promise.resolve();
    const job = prev
      .catch(() => {})
      .then(() => process(msg))
      .catch((err) => {
        logger.error?.(`[webhook] falha ao processar ${msg.id}: ${err.message}`);
        return { status: 'error', error: err.message };
      });
    queues.set(msg.from, job);
    job.finally(() => {
      if (queues.get(msg.from) === job) queues.delete(msg.from);
    });
    return job;
  };
}
