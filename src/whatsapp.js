const MAX_TEXT = 4096; // limite da Cloud API para mensagens de texto
const NOT_ALLOWED = 131030; // "Recipient phone number not in allowed list" (modo de teste)

/**
 * Celulares do Brasil: a Meta costuma entregar o wa_id SEM o 9º dígito (55 + DDD + 8 dígitos),
 * mas o número cadastrado em "Para" tem o 9. Devolve a outra forma do número, se existir.
 */
export function brazilAlternateNumber(n) {
  const d = String(n).replace(/\D/g, '');
  if (/^55\d{2}[6-9]\d{7}$/.test(d)) return `${d.slice(0, 4)}9${d.slice(4)}`; // sem 9 → com 9
  if (/^55\d{2}9[6-9]\d{7}$/.test(d)) return `${d.slice(0, 4)}${d.slice(5)}`; // com 9 → sem 9
  return null;
}

/**
 * Cliente mínimo da WhatsApp Cloud API. `fetchImpl` é injetável para testes.
 */
export function createWhatsAppClient({ token, phoneNumberId, apiVersion = 'v23.0', fetchImpl = fetch, logger = console }) {
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
  const workingNumber = new Map(); // lembra qual forma do número funcionou

  async function post(body) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const err = new Error(`WhatsApp API ${res.status}: ${detail}`);
      try {
        err.code = JSON.parse(detail)?.error?.code;
      } catch {}
      throw err;
    }
    return res.json().catch(() => ({}));
  }

  const textBody = (to, text) => ({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: false, body: String(text).slice(0, MAX_TEXT) },
  });

  return {
    async sendText(to, text) {
      const target = workingNumber.get(to) || to;
      try {
        return await post(textBody(target, text));
      } catch (err) {
        const alt = brazilAlternateNumber(target);
        if (err.code !== NOT_ALLOWED || !alt) throw err;
        logger.warn?.(`[wa] ${target} não está na lista permitida; tentando ${alt} (9º dígito)`);
        const out = await post(textBody(alt, text));
        workingNumber.set(to, alt);
        return out;
      }
    },
    markAsRead(messageId) {
      return post({ messaging_product: 'whatsapp', status: 'read', message_id: messageId });
    },
  };
}
