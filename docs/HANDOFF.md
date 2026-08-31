# Handoff do LinkON

Guia de passagem de bastão para o desenvolvedor que assume o LinkON. Leia este documento do início ao
fim antes de tocar no código. Ele reflete o estado do repositório no último commit desta fase.

> Índice completo de documentos: [README.md](./README.md). Referência técnica: [ARCHITECTURE.md](./ARCHITECTURE.md),
> [API.md](./API.md), [INTEGRATION.md](./INTEGRATION.md), [IMPLEMENTATION.md](./IMPLEMENTATION.md).

---

## 1. O que é o LinkON

Plataforma de automação de prospecção no LinkedIn via **Unipile**. Envia convites personalizados com
comportamento humano (atrasos, limites, janela comercial), responde automaticamente mensagens (bot por
regras, por fluxo visual ou com IA), varre redes de contatos (sweep), faz disparos em massa e extrai
dados de perfis com exportação para `.xlsx`.

- **Frontend**: React 18 + Vite + TailwindCSS (`frontend/`)
- **Backend**: Node + Express + TypeScript (`backend/`)
- **Filas**: BullMQ + Redis
- **Banco**: SQLite via Prisma (`DATABASE_URL` trocável para Postgres)
- **Integração**: Unipile (native auth, hosted auth, webhooks) e LLM (OpenAI-compatível)

---

## 2. Estado atual (o que já está pronto)

- Agente de IA **por conta** ("Agente nativo") com limites diários/semanais, delay de resposta,
  mensagem de transferência, base de conhecimento e tom. Configurado em **Contas LinkedIn**.
- **Bot por campanha** (`Campaign.agentEnabled`): toggle em Criar Campanha e nos Detalhes. Desligado,
  as respostas dos leads são apenas registradas no Inbox (log `AGENT_DISABLED`), sem resposta do bot.
  Convivência com o agente por conta: o gate por campanha só vale para leads daquela campanha;
  conversas nativas continuam regidas pelo agente da conta.
- Inbox unificado com status humano/bot, reativação de conversa, mensagens e eventos.
- **Agendamento automático** ("Agente nativo"): a IA oferece horários ao lead, coleta o e-mail e cria
  reunião no Google Agenda (com Google Meet), persistindo o `Booking` e mostrando um chip de reunião
  confirmada no Inbox. Configuração em **Configurações → Google Agenda** (conectar conta + janelas) e
  no bloco **Agendamento de reuniões** do agente nativo.
- Multi-usuário com papéis USER/ADMIN, escopo por usuário, aprovação de cadastro e painel admin.
- Rate limits por IP real (login, registro, API autenticada e webhooks) e proteções para rodar atrás
  de Cloudflare (ver seção 5).
- `docs/` com arquitetura, API e integração; `docs/superpowers/` com os designs/planos de cada fase
  (gitignored, só local).

---

## 3. Como rodar

### Pré-requisitos

- Node 20+, Redis (`redis-server`)
- Conta Unipile (DSN + Access Token) e, para o bot IA, uma `USER_LLM_API_KEY`
- Para o agendamento: app Google OAuth com `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e
  `GOOGLE_REDIRECT_URI` (a rota pública `/api/calendar/oauth/callback`)

### Passos

```bash
# 1. Dependências (monorepo npm workspaces)
npm install

# 2. Envs (nunca commite valores reais; .env* é gitignored)
cp .env.example backend/.env
cp frontend/.env.example frontend/.env

# 3. Banco (sem migrations: schema.prisma é a fonte da verdade)
npm run db:push          # cria/atualiza dev.db (SQLite)

# 4. Redis
redis-server --daemonize yes

# 5. Subir tudo (API + workers + frontend)
./start.sh
```

- Frontend: http://localhost:5173 (proxy `/api` -> http://localhost:3001, `allowedHosts` inclui
  `*.monkeycode-ai.live` para previews).
- API: http://localhost:3001 · Health: `/api/health`.
- Workers de contatos e extração são **separados**:
  `npm run dev:contacts-worker -w @linkon/backend` e `npm run dev:extraction-worker -w @linkon/backend`.

### Contas demo (base de preview)

| Usuário | Senha | Papel |
| --- | --- | --- |
| `arcanjo` | `29172510` | ADMIN |
| `teste` | `123456` | USER |
| `maria` | `maria123` | USER |

Em instalação nova só existe o admin (de `ADMIN_USERNAME`/`ADMIN_PASSWORD` no `.env`).

---

## 4. Arquitetura em um minuto

```
                 ┌─────────────────────────────── Vite :5173 ───────────────────────────────┐
                 │  React (proxy /api -> :3001)                                              │
                 └───────────────┬───────────────────────────────────────────────────────────┘
                                 │ HTTP /api (JWT Bearer)
                                 ▼
                 ┌─────────────────────────────── Express :3001 ────────────────────────────┐
                 │  securityHeaders -> cors -> rateLimit -> rotas                            │
                 │  /health /webhooks /auth (públicas)                                       │
                 │  /config /accounts /agents /campaigns /extractions /logs /notifications   │
                 │  /inbox /admin (requireAuth + rateLimit + escopo por usuário)             │
                 └───────┬─────────────┬──────────────┬──────────────┬───────────────────────┘
                         │             │              │              │
                 Redis/BullMQ    Prisma/SQLite    Unipile API     Scheduler (node-cron)
                 (filas)         (dados)         (LinkedIn)       (reset de limites, etc.)
                         │
            ┌────────────┴────────────────────────────────────────────┐
            ▼                                                          ▼
   Workers: invite, chatbot, search, sweep, contacts, extraction    Webhooks unipile
```

- **Filas BullMQ**: `invitesQueue`, `chatbotQueue`, `searchQueue`, `sweepQueue` (em
  `backend/src/services/queue.service.ts`), além de contatos/extração. Cada worker consome a própria fila.
- **Escopo**: `backend/src/utils/scope.ts` resolve o usuário (do JWT ou `X-Operate-As` do admin) e
  filtra dados por `userId`. Contas/campanhas legadas têm `userId=null` e ficam visíveis ao admin.
- **Modelo de dados**: `backend/prisma/schema.prisma`. **Não há migrations** — altere o schema e rode
  `npx prisma db push --skip-generate && npx prisma generate`.

---

## 5. Segurança e proteções (Cloudflare + rate limits)

### 5.1. Trust proxy e IP real

`app.set("trust proxy", env.TRUST_PROXY)` (padrão `1`, um hop). O IP real do cliente é resolvido por
`getClientIp()` (`backend/src/utils/clientIp.ts`), que prefere o header `CF-Connecting-IP` (enviado pelo
Cloudflare) e cai para `req.ip`. **Todos os rate limits usam esse IP** — sem isso, atrás de proxy todos
pareceriam vir do mesmo IP e os limites falhariam (ou poderiam ser burlados).

Em produção: `TRUST_PROXY=1` atrás do Cloudflare. Se houver outro proxy (ex.: nginx) entre o Cloudflare e
a API, ajuste o número de hops.

### 5.2. Rate limits (configuráveis por env, janela por IP real)

| Rota | Env | Padrão | Janela |
| --- | --- | --- | --- |
| `POST /api/auth/login` | `RATE_LIMIT_LOGIN_MAX` | 10 | 60s |
| `POST /api/auth/register` | `RATE_LIMIT_REGISTER_MAX` | 5 | 15min |
| API autenticada (`/api/*` após login) | `RATE_LIMIT_API_MAX` | 600 | 60s |
| Webhooks (`/api/webhooks/*`) | `RATE_LIMIT_WEBHOOK_MAX` | 600 | 60s |

Resposta `429` com header `Retry-After`. **Cada limitador tem bucket próprio** (isolados entre si) —
não regresse isso: antes, todos compartilhavam um `Map` global e o limite de uma rota esgotava o de
outras (bug corrigido, coberto por teste).

### 5.3. Webhooks Unipile

- `POST /api/webhooks/unipile` valida o segredo `UNIPILE_WEBHOOK_SECRET` (header `unipile-auth` ou
  `authorization`) com **comparação timing-safe** (`crypto.timingSafeEqual`). Retorna `401` se inválido.
- Responde `200 {ok:true}` **antes** de processar; o processamento é assíncrono (não pode falhar o
  delivery do unipile por erro de app).
- Eventos tratados: `message_received` (resposta de lead → bot/fila) e `new_relation` (convite aceito).
- **Registro de webhooks**: configurar `WEBHOOK_PUBLIC_URL` e registrar via painel (Configurações) —
  o endpoint público deve ser `https://SEU-DOMINIO/api/webhooks/unipile`.

### 5.4. CORS

- Em `NODE_ENV=development`: reflete a origem (comportamento dev/preview, necessário porque o host de
  preview varia).
- Em `NODE_ENV=production`: só responde a origens listadas em `CORS_ORIGINS` (vírgula-separado).
  Configurar no deploy: `NODE_ENV=production` + `CORS_ORIGINS=https://app.linkon.com.br,...`.

### 5.5. Headers de segurança

Middleware `securityHeaders` (`backend/src/middleware/security.ts`) aplica `X-Content-Type-Options`,
`X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` e HSTS (quando `req.secure`, ou seja,
só atrás de HTTPS).

### 5.6. Checklist para o deploy real

1. Gere segredos fortes: `AUTH_SECRET` (≥16), `CREDENTIALS_ENCRYPTION_KEY` (≥16),
   `UNIPILE_WEBHOOK_SECRET` (≥8). Troque `ADMIN_PASSWORD`.
2. `NODE_ENV=production`, `TRUST_PROXY=1`, `CORS_ORIGINS=<origens do front>`,
   `FRONTEND_ORIGIN=<url do front>`.
3. Aponte o domínio para o Cloudflare (proxied). A API e o front devem estar atrás dele; o rate limit
   passa a enxergar o IP real via `CF-Connecting-IP`.
4. Limite o webhook a entregas da Unipile se possível (ou confie no segredo + rate limit).
5. Troque `DATABASE_URL` para Postgres em produção (o Prisma já está pronto).
6. Rode `npm run build` e suba `dist/` + `node dist/workers/*.js` com um gerenciador de processos.

### 5.7. Relatório de segurança GitGuard

Os achados do GitGuard (Semgrep + Trivy) do commit `cb3f0ed` foram tratados: dependências atualizadas
(`brace-expansion@5.0.9`, `uuid@14.0.2`, `react-router-dom@7.18.3`), tag GCM explícita e RNG criptográfico.
Três findings foram avaliados como não aplicáveis/aceitos. Detalhes e justificativas:
[docs/SECURITY.md](./SECURITY.md).

---

## 6. Operação

- **Comandos úteis** (em `backend/`): `npx vitest run` (testes), `npx tsc --noEmit` (typecheck),
  `npm run db:push`, `npm run build`.
- **Logs**: a API loga em stdout (scheduler, webhooks, erros). Workers logam no próprio stdout.
- **Reiniciar depois de editar código**: `tsx` **não** faz reload — o processo precisa ser reiniciado
  para pegar mudanças em arquivos já carregados (ver gotcha 7.1).
- **Redis**: o `dump.rdb` na raiz é do Redis local (gitignored). Limpe com cuidado se quiser zerar filas.
- **Scheduler**: `backend/src/scheduler.ts` roda a cada 5 min (resets de limites de resposta do bot,
  health checks de contas, etc.).

---

## 7. Gotchas e decisões que você precisa saber

### 7.1. `tsx` não recarrega código (trabalhe com `tsx watch` ou reinicie)

Os scripts `npm run dev*` usam `tsx watch`, mas quando você sobe processos manualmente com
`npx tsx src/index.ts`, mudanças no código **não** são aplicadas até reiniciar. Sintoma típico: um fix
parece não funcionar. Sempre reinicie API/workers após editar.

### 7.2. Webhook: `account_id` vem no top-level do payload (não em `account_info`)

O unipile envia `account_id` no **top-level** do payload. `handleMessageReceived` resolve a conta com
`event.account_id ?? event.account_info?.account_id`. **Não** reverta isso para ler só de
`account_info` — foi a causa do bug "bot não responde" (toda mensagem legítima era dropada com
"account not resolved"). Há teste de regressão.

### 7.3. Detecção de "mensagem de conta própria" é por conta, não global

`isOwnAccount` global (antigo) descartava leads que também são contas conectadas (ex.: o Gabriel é lead
da Renata e tem conta própria). Hoje o self-check é `senderId === ownId || senderId === account.providerId`
**após** resolver a conta da mensagem. Não volte para busca global por `providerId`.

### 7.4. Gate do bot em dois pontos (webhook + worker)

O bot por campanha é checado duas vezes: no webhook (antes de enfileirar) e no worker
(`handleIncomingMessage` retorna `"none"` se `campaign.agentEnabled === false`). Isso cobre o caso de
desligar o bot enquanto jobs já estão na fila com delay. Não remova o re-check do worker.

### 7.5. Sem migrations: `db push`

Qualquer mudança de schema: editar `schema.prisma` → `npx prisma db push --skip-generate` →
`npx prisma generate`. O `dev.db` local pode ser apagado à vontade (é gitignored) para recriar do zero.

### 7.6. JWT e status

O JWT carrega `{ sub, username, role, status }`. `requireAuth` bloqueia `status !== "ACTIVE"` (401
"Acesso bloqueado"). Tokens de teste gerados fora do app precisam incluir `status: "ACTIVE"`.

### 7.7. Testes com datas "bombadas"

`native-agent.service.test.ts` usa datas fixas (ex.: `2026-08-17`) para limites diários/semanais.
Se falharem por data, atualize as constantes para a data atual.

### 7.8. Credenciais LLM

O bot IA usa `USER_LLM_API_KEY`/`USER_LLM_BASE_URL`/`USER_LLM_MODEL` do `.env` do backend (padrão
OpenAI-compatível). Vazio → bot em modo RULES. **Nunca** commite a chave real; o `.env` é gitignored.

### 7.9. Contas demo e dados de teste

A base de preview contém contas LinkedIn conectadas (status OK/DISCONNECTED) e campanhas reais. Não
deletar contas que o cliente ainda usa. Usuários criados em testes de rate limit (ex.: `limiteuser*`)
podem ser bloqueados/removidos pelo admin.

### 7.10. Agendamento depende de calendário CONNECTED + janelas cadastradas

O fluxo de agendamento só oferece reuniões se: o agente tiver `schedulingEnabled`, o
`CalendarConnection` estiver `CONNECTED` e existirem janelas de disponibilidade cadastradas
(Configurações → Google Agenda). Sem janelas ou com calendário desconectado, `startBooking` transfere
a conversa ao humano. Conversas presas em `OFFERING`/`AWAITING_EMAIL`/`CONFIRMING` por mais de 24h são
resetadas pelo `expireStaleScheduling` do scheduler (cron de 5/15 min).

### 7.11. Google sem lib: `fetch` nativo e refresh token criptografado

O `calendar.service` usa `fetch` (sem dependência Google) e guarda o refresh token criptografado
(AES-256-GCM) no `CalendarConnection`. `createEventRobust` refaz o request após `401` (refresh) e faz
backoff em `429`/`5xx`. Testes mockam o fetch globalmente (`vi.stubGlobal`).

- 7.12 Inbox paginado: o frontend pausa o polling de 8s do histórico enquanto `nextCursor` está ativo (evita colapsar a janela carregada); o polling da lista continua rodando. `POST /suggest-reply` exige `USER_LLM_API_KEY`; sem ela retorna 502 (o botão mostra toast).
- 7.13 Unread usa `conversation.readAt` (não `updatedAt`): `updatedAt @updatedAt` é bumped por qualquer `conversation.update` (ex.: `lastMessageAt` no webhook), o que tornava `createdAt > updatedAt` sempre falso. `unread` = mensagens LEAD após `readAt`; `readAt` nulo = todas não lidas. `POST /inbox/:id/read` seta `readAt`.
- 7.14 Cadência: vive em `Campaign.cadence` (JSON string, array 1-5 de `{body, waitDays}`) e `Lead.cadenceStep`. `nextInviteAt` é agendado no envio (`waitDays` inteiros); cópias 2..5 só são enviadas para leads `COMPLETED` com `cadenceStep < length` e `nextInviteAt` vencido (e `currentBlockId` nulo, sem `RESPONDED`). O card "Próximo envio" da página de detalhe não inclui follow-ups (mostra apenas o próximo envio de leads `PENDING`); o próximo follow-up aparece na coluna "Próximo envio" por lead. O scheduler só completa a campanha quando não há `PENDING` nem follow-ups. Placeholders (`{nome}`, `{cargo}`, `{link}`) são aplicados na cadência e no disparo simples via `applyPlaceholders`.
- 7.15 Limite de 1 conta LinkedIn por usuário é garantido no service (`assertCanConnectLinkedIn`), não no banco (sem constraint). O fluxo native (`POST /auth/native`) só aplica o limite quando o body traz `userId` (conexão admin/global não é bloqueada); `confirm-hosted` é idempotente para a mesma conta do usuário (atualiza status sem `409`) e retorna `409` para outra conta.

---

## 8. Testes

- Backend: `npx vitest run` (175 testes, 21 arquivos). Testes de rotas mockam o Prisma
  (`vi.mock("../lib/prisma")`) e chamam os handlers diretamente (sem HTTP).
- Rate limit: `backend/src/middleware/rateLimit.test.ts` (inclui teste de isolamento entre instâncias e
  chave por `CF-Connecting-IP`).
- Typecheck: `npm run typecheck` (raiz) ou `npx tsc --noEmit` em cada workspace.
- Frontend não tem suíte de testes — validar via typecheck e manualmente.

---

## 9. Troubleshooting rápido

| Sintoma | Causa provável | Ação |
| --- | --- | --- |
| Bot não responde | Webhook sem `account_id` no top-level resolvido (7.2) OU worker desatualizado (7.1) | Reiniciar API + worker; checar `LogEvent` (tipo `AGENT_DISABLED`, `MESSAGE_RECEIVED`) |
| Mensagem dropada como "self" | Self-check global (7.3) | Conferir se o código usa `account.providerId` por conta |
| 429 em todo lugar | Buckets compartilhados (5.2) | Confirmar que cada `rateLimit()` tem bucket próprio |
| 401 "Acesso bloqueado" | JWT sem `status` ou usuário não-ACTIVE (7.6) | Gerar token com `status: "ACTIVE"` |
| Job enfileirado mas não roda | Worker correspondente não está no ar | Subir `dev:chatbot-worker` (ou o worker da fila) |
| Teste de agente nativo falha por data | Time-bomb (7.7) | Atualizar datas do teste |

**Para inspecionar decisões de webhook em produção**, os `LogEvent` gravam os motivos
(`AGENT_DISABLED`, `BOT_SELF_MESSAGE`, `MESSAGE_RECEIVED`, `INVITE_ACCEPTED`). O payload não é mais
logado em texto puro (removido por privacidade).

---

## 10. Referências

- [README](../README.md) — porta de entrada
- [ARCHITECTURE.md](./ARCHITECTURE.md) — arquitetura e modelo de dados
- [API.md](./API.md) — referência completa das rotas
- [INTEGRATION.md](./INTEGRATION.md) — Unipile, webhooks, Redis
- [IMPLEMENTATION.md](./IMPLEMENTATION.md) — estado, testes, decisões e limitações
- [PRODUCT.md](./PRODUCT.md) — produto e papéis
