import fs from 'node:fs';
import path from 'node:path';

// Carrega o .env local (Node >= 20.12). Em produção as variáveis vêm do painel do Render/Koyeb.
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envPath);
}

const env = process.env;

export const config = {
  port: Number(env.PORT) || 3000,

  // Google Gemini
  geminiApiKey: env.GEMINI_API_KEY || '',
  geminiModel: env.GEMINI_MODEL || 'gemini-2.5-flash',

  // WhatsApp Cloud API (Meta)
  whatsappToken: env.WHATSAPP_TOKEN || '',
  whatsappPhoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
  whatsappVerifyToken: env.WHATSAPP_VERIFY_TOKEN || '',
  whatsappAppSecret: env.WHATSAPP_APP_SECRET || '', // opcional: valida assinatura X-Hub-Signature-256
  graphApiVersion: env.GRAPH_API_VERSION || 'v23.0',

  // Memória
  historyLimit: Number(env.HISTORY_LIMIT) || 8,
  sqlitePath: env.SQLITE_PATH || './data/historico.db',
  upstashUrl: env.UPSTASH_REDIS_REST_URL || '',
  upstashToken: env.UPSTASH_REDIS_REST_TOKEN || '',

  // Atendimento
  promptFile: env.PROMPT_FILE || './PROMPT_ATENDIMENTO.md',
  fallbackMessage:
    env.FALLBACK_MESSAGE ||
    'Desculpe, estou com uma instabilidade no momento. Pode repetir sua mensagem em alguns minutos? 🙏',
};

export function missingRequiredConfig(cfg = config) {
  const required = {
    GEMINI_API_KEY: cfg.geminiApiKey,
    WHATSAPP_TOKEN: cfg.whatsappToken,
    WHATSAPP_PHONE_NUMBER_ID: cfg.whatsappPhoneNumberId,
    WHATSAPP_VERIFY_TOKEN: cfg.whatsappVerifyToken,
  };
  return Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k);
}
