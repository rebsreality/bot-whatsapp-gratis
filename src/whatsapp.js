const MAX_TEXT = 4096; // limite da Cloud API para mensagens de texto

/**
 * Cliente mínimo da WhatsApp Cloud API. `fetchImpl` é injetável para testes.
 */
export function createWhatsAppClient({ token, phoneNumberId, apiVersion = 'v23.0', fetchImpl = fetch }) {
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  async function post(body) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`WhatsApp API ${res.status}: ${detail}`);
    }
    return res.json().catch(() => ({}));
  }

  return {
    sendText(to, text) {
      return post({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: false, body: String(text).slice(0, MAX_TEXT) },
      });
    },
    markAsRead(messageId) {
      return post({ messaging_product: 'whatsapp', status: 'read', message_id: messageId });
    },
  };
}
