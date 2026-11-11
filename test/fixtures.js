// Payloads no formato real enviado pela Meta (WhatsApp Cloud API).
export const PHONE_NUMBER_ID = '106540352242922';

const base = (value) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '102290129340398',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15550783881', phone_number_id: PHONE_NUMBER_ID },
            ...value,
          },
        },
      ],
    },
  ],
});

export function textMessage({ from = '5511999998888', text = 'Oi, qual o horário de vocês?', id, name = 'Maria' } = {}) {
  return base({
    contacts: [{ profile: { name }, wa_id: from }],
    messages: [
      {
        from,
        id: id || `wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA${Math.random().toString(36).slice(2)}`,
        timestamp: '1749416383',
        type: 'text',
        text: { body: text },
      },
    ],
  });
}

export function statusUpdate(status = 'read') {
  return base({
    statuses: [
      {
        id: 'wamid.HBgLMTY0NjcwNDM1OTUVAgARGBI1RjQyNUE3NEYxMzAzMzQ5MkEA',
        status,
        timestamp: '1749416400',
        recipient_id: '5511999998888',
        conversation: { id: 'CONVERSATION_ID', origin: { type: 'service' } },
        pricing: { billable: false, pricing_model: 'PMP', category: 'service', type: 'free_customer_service' },
      },
    ],
  });
}

export function imageMessage(from = '5511999998888') {
  return base({
    contacts: [{ profile: { name: 'Maria' }, wa_id: from }],
    messages: [
      {
        from,
        id: 'wamid.IMAGEM123',
        timestamp: '1749416383',
        type: 'image',
        image: { mime_type: 'image/jpeg', sha256: 'abc', id: '1003383421387256' },
      },
    ],
  });
}
