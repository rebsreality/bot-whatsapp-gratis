import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_PROMPT =
  'Você é um atendente virtual educado e objetivo de uma empresa. Responda em português do Brasil, ' +
  'de forma curta. Se não souber algo, diga que vai encaminhar para um atendente humano.';

let cache = { file: null, mtimeMs: 0, text: DEFAULT_PROMPT };

/**
 * Lê o PROMPT_ATENDIMENTO.md. Recarrega automaticamente quando o arquivo muda,
 * então você pode editar sem reiniciar o servidor (em ambiente local).
 */
export function loadSystemPrompt(file) {
  const full = path.resolve(file);
  try {
    const { mtimeMs } = fs.statSync(full);
    if (cache.file !== full || cache.mtimeMs !== mtimeMs) {
      const text = fs.readFileSync(full, 'utf8').trim();
      cache = { file: full, mtimeMs, text: text || DEFAULT_PROMPT };
    }
    return cache.text;
  } catch {
    return DEFAULT_PROMPT;
  }
}
