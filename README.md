# 🤖 Bot WhatsApp Grátis

Atendimento automático para **WhatsApp Business** com IA, **custo zero** e sem cartão de crédito.

| Peça | Escolha | Custo |
|------|---------|-------|
| IA | Google Gemini (`gemini-flash-latest`, sempre o Flash mais novo) via `@google/genai` | Tier gratuito (AI Studio) |
| WhatsApp | API Oficial da Meta (Cloud API) | Conversas iniciadas pelo cliente são grátis |
| Servidor | Node.js 24 + Express 5 | Render / Koyeb free |
| Memória | SQLite nativo (`node:sqlite`) → ou Upstash Redis | Grátis |

## Como funciona
```
Cliente → WhatsApp → Meta → POST /webhook → (histórico 8 msgs) → Gemini → Meta → Cliente
```
- Responde **só mensagens de texto**; ignora status (enviada/entregue/lida), áudio, imagem etc.
- Devolve `200` na hora para a Meta não reenviar; ignora mensagens duplicadas.
- Fila por cliente (ordem das respostas garantida).
- Se o Gemini falhar (ex.: limite gratuito), envia uma mensagem de fallback.
- Valida a assinatura `X-Hub-Signature-256` se `WHATSAPP_APP_SECRET` estiver definido.

## Personalizar o atendimento
Edite **[`PROMPT_ATENDIMENTO.md`](PROMPT_ATENDIMENTO.md)** (nome, horários, preços, regras). Faça commit e o Render publica de novo.

## Rodar localmente
```bash
cp .env.example .env   # preencha as chaves
npm install
npm test
npm start
```
Para a Meta alcançar seu PC, use um túnel grátis (ex.: `npx cloudflared tunnel --url http://localhost:3000`).

## Endpoints
| Método | Rota | Uso |
|--------|------|-----|
| GET | `/health` | Health check |
| GET | `/webhook` | Verificação da Meta (`hub.challenge`) |
| POST | `/webhook` | Recebe mensagens |

## Memória em produção
O disco do Render/Koyeb gratuito **é apagado a cada deploy/reinício**, então o SQLite perde o histórico.
Para memória persistente, crie um Redis grátis no [Upstash](https://console.upstash.com) e preencha
`UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`. O bot troca sozinho para o Upstash.

## Observações do plano gratuito
- **Render free** "dorme" após 15 min sem acesso; a primeira mensagem pode demorar ~1 min (a Meta reenvia, nada se perde). Para evitar, use um monitor grátis (ex.: UptimeRobot) chamando `/health` a cada 10 min.
- **Gemini free** tem limite de requisições por minuto/dia; acima disso o cliente recebe a mensagem de fallback.
- **Token da Meta**: o token temporário expira em 24 h. Para produção, gere um token permanente (Usuário do Sistema) — ver checklist.
