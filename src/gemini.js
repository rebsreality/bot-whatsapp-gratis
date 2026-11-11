import { GoogleGenAI } from '@google/genai';

/**
 * Cliente de IA. Recebe o histórico [{role:'user'|'model', text}] e devolve o texto da resposta.
 */
export function createGeminiClient({ apiKey, model, client }) {
  const ai = client || new GoogleGenAI({ apiKey }); // `client` permite injetar um mock nos testes

  return {
    async reply({ systemPrompt, history }) {
      const contents = history.map((m) => ({
        role: m.role === 'model' ? 'model' : 'user',
        parts: [{ text: m.text }],
      }));

      const res = await ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: systemPrompt,
          temperature: 0.4,
          maxOutputTokens: 800,
          // Respostas rápidas e baratas: sem "thinking" no 2.5-flash.
          ...(model.startsWith('gemini-2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      });

      const text = (res.text || '').trim();
      if (!text) throw new Error('Gemini retornou resposta vazia');
      return text;
    },
  };
}
