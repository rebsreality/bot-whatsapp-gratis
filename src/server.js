import { config, missingRequiredConfig } from './config.js';
import { createApp } from './app.js';
import { createGeminiClient } from './gemini.js';
import { createWhatsAppClient } from './whatsapp.js';
import { createStore } from './store/index.js';
import { loadSystemPrompt } from './prompt.js';

const missing = missingRequiredConfig();
if (missing.length) {
  console.error(`❌ Variáveis de ambiente faltando: ${missing.join(', ')}. Veja o .env.example.`);
  process.exit(1);
}

const store = await createStore(config);
const app = createApp({
  config,
  store,
  ai: createGeminiClient({ apiKey: config.geminiApiKey, model: config.geminiModel }),
  whatsapp: createWhatsAppClient({
    token: config.whatsappToken,
    phoneNumberId: config.whatsappPhoneNumberId,
    apiVersion: config.graphApiVersion,
  }),
  getSystemPrompt: () => loadSystemPrompt(config.promptFile),
});

// Confere na largada se o token e o ID do número da Meta estão certos.
fetch(`https://graph.facebook.com/${config.graphApiVersion}/${config.whatsappPhoneNumberId}?fields=display_phone_number,verified_name`, {
  headers: { Authorization: `Bearer ${config.whatsappToken}` },
})
  .then(async (r) => {
    const body = await r.json().catch(() => ({}));
    if (r.ok) console.log(`✅ Meta OK: número ${body.display_phone_number} (${body.verified_name})`);
    else console.error(`❌ Meta recusou o token/ID do número: ${body.error?.message || r.status}`);
  })
  .catch((err) => console.error(`❌ Não consegui falar com a Meta: ${err.message}`));

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`✅ Bot rodando na porta ${config.port} | modelo: ${config.geminiModel} | memória: ${store.kind}`);
});

async function shutdown(signal) {
  console.log(`Recebido ${signal}, encerrando...`);
  server.close();
  await app.locals.idle();
  await store.close();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
