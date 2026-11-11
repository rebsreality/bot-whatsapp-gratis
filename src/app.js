import express from 'express';
import { extractTextMessages, isValidSignature, createMessageHandler } from './webhook.js';

/**
 * Monta o app Express. Todas as dependências são injetadas (facilita testes).
 */
export function createApp({ config, ai, whatsapp, store, getSystemPrompt, logger = console }) {
  const app = express();
  app.disable('x-powered-by');

  // Guarda o corpo bruto para validar a assinatura da Meta.
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  const handle = createMessageHandler({
    ai,
    whatsapp,
    store,
    getSystemPrompt,
    fallbackMessage: config.fallbackMessage,
    phoneNumberId: config.whatsappPhoneNumberId,
    logger,
  });

  // Jobs em andamento (o 200 é devolvido antes da resposta da IA; os testes aguardam por aqui).
  const pending = new Set();
  app.locals.idle = () => Promise.allSettled([...pending]);

  app.get(['/', '/health'], (_req, res) => {
    res.json({ status: 'ok', store: store.kind });
  });

  // Verificação do webhook (Meta envia hub.mode, hub.verify_token e hub.challenge).
  app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token && token === config.whatsappVerifyToken) {
      logger.info?.('[webhook] verificado pela Meta');
      return res.status(200).type('text/plain').send(String(challenge ?? ''));
    }
    return res.sendStatus(403);
  });

  // Recebimento de mensagens.
  app.post('/webhook', (req, res) => {
    if (!isValidSignature(req.rawBody, req.get('x-hub-signature-256'), config.whatsappAppSecret)) {
      logger.warn?.('[webhook] assinatura inválida');
      return res.sendStatus(401);
    }

    // Responde 200 imediatamente para a Meta não reenviar o evento.
    res.sendStatus(200);

    const messages = extractTextMessages(req.body);
    if (!messages.length) {
      const value = req.body?.entry?.[0]?.changes?.[0]?.value || {};
      const kind = value.statuses ? `status ${value.statuses[0]?.status}` : value.messages ? `mensagem tipo ${value.messages[0]?.type}` : 'outro evento';
      logger.info?.(`[webhook] evento ignorado (${kind})`);
      // Erros de envio chegam como status "failed": mostra o motivo no log.
      for (const s of value.statuses || []) {
        if (s.status === 'failed') logger.error?.(`[webhook] ❌ envio falhou: ${JSON.stringify(s.errors)}`);
      }
    }

    for (const msg of messages) {
      const job = handle(msg);
      pending.add(job);
      job.finally(() => pending.delete(job));
    }
  });

  // JSON inválido ou outros erros.
  app.use((err, _req, res, _next) => {
    logger.warn?.(`[http] ${err.message}`);
    res.status(err.status || 500).json({ error: err.status === 400 ? 'JSON inválido' : 'erro interno' });
  });

  return app;
}
