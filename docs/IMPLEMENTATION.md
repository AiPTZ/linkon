# LinkON — Implementação

Este documento descreve o estado atual da implementação no repositório.

## Stack e ferramentas

- **Backend**: Node.js (>= 20), Express 4, TypeScript, Prisma 6 (SQLite), BullMQ 5 + ioredis,
  node-cron, jsonwebtoken, bcryptjs, zod, exceljs.
- **Frontend**: React 18, Vite, TailwindCSS.
- **Testes**: Vitest (backend, testes junto ao código em `*.test.ts`).
- **Monorepo**: npm workspaces (`backend`, `frontend`).

## Estrutura e comandos

| Comando | Descrição |
| --- | --- |
| `npm install` | Instala dependências (raiz, workspaces) |
| `npm run dev` | Sobe tudo via `start.sh` (API + workers + frontend) |
| `npm run build` | Builda backend e frontend |
| `npm run typecheck` | Typecheck de backend e frontend |
| `npm run db:push` | Sincroniza o schema Prisma com o banco |
| `npm test -w @linkon/backend` | Roda a suíte de testes do backend |
| `npm run dev -w @linkon/backend` | Sobe apenas a API (porta 3001) |
| `npm run dev:<worker>-worker -w @linkon/backend` | Sobe um worker (invite, chatbot, search, sweep, contacts) |
| `npm run dev -w @linkon/frontend` | Sobe o frontend (porta 5173) |

## O que está implementado

### Backend

- **API REST** completa sob `/api` (ver [API.md](./API.md)), com 404 padrão para rotas inexistentes.
- **Autenticação**: JWT (`AUTH_SECRET`, expiração 7 dias), payload `{ sub, username, role, status }`;
  seed do admin no boot (`ensureAdminSeeded`); `requireAuth` rejeita não-`ACTIVE`; `requireAdmin`
  restringe rotas de admin.
- **Tenancy**: `resolveScope` + `X-Operate-As`; registros globais com `userId` nulo; rotas de
  `/admin` para a base completa.
- **Rate limit**: middleware próprio em memória (`middleware/rateLimit.ts`) aplicado ao
  `POST /auth/login` (10/min por IP, `429` + `Retry-After`). Sem dependência externa.
- **Unipile**: serviço `unipile.service.ts` (auth nativa, hosted, envio, busca); config via env ou
  `AppConfig`.
- **Campanhas**: `campaign.service.ts` (start/pause/resume), `invite.service.ts` (limites, atraso,
  reenvio), `broadcast.service.ts` (sweep/disparo), `flow.service.ts` (fluxos validados),
  `chatbot.service.ts` (regras), `search.service.ts` (importação de busca),
  `sweep.service.ts` (varredura), `contacts.service.ts` (scrape de contato de leads).
- **Contatos da rede**: `network.service.ts` (sync da rede via `getRelations` com paginação, upsert
  dedup `accountId+providerId`, scrape via `getUserContactDetails`, estatísticas, XLSX, lista/consulta,
  `upsertRelationContact` no aceite de convite); rotas `/contacts`; worker `contacts.worker.ts`
  (jobs `sync-network` e `scrape`). Gatilhos de sync ao conectar/ativar conta e no
  webhook `new_relation`. A extração por URL (`extraction.service.ts`/`extraction.worker.ts`) foi
  removida.
- **Limite de 1 conta LinkedIn por usuário**: garantido no service (`assertCanConnectLinkedIn` em
  `auth.service.ts`) — novas conexões (`connectNative` com `userId`, `confirmHosted`) retornam `409`;
  re-confirmar a mesma conta do usuário é idempotente.
- **Cadência de disparo**: até 5 cópias em DISPARO — JSON string em `Campaign.cadence`,
  `Lead.cadenceStep`, envio apenas para leads que não responderam, placeholders `{nome}/{cargo}/{link}`,
  agendamento `waitDays` dias após a cópia anterior.
- **Filas/workers**: 5 filas BullMQ com workers em processos separados.
- **Scheduler**: `node-cron` a cada 5 minutos processando campanhas `RUNNING` (limites, janela de
  horário, fluxos, enfileiramento).
- **Notificações e logs**: `notification.service.ts`, `log.service.ts`.
- **Agendamento automático**: `calendar.service.ts` (OAuth + Google Calendar/Meet via `fetch` nativo,
  sem lib Google), `scheduling.service.ts` (helpers puros + máquina de estados
  `NONE → OFFERING → AWAITING_EMAIL → CONFIRMING → BOOKED`), rotas `/api/calendar/*` com callback
  OAuth público, campos de agendamento no `NativeAgent`, timeout de 24h no scheduler
  (`expireStaleScheduling`) e UI (bloco "Agendamento de reuniões", card Google Agenda + janelas,
  chip de reunião no Inbox).

### Frontend

- SPA com rotas protegidas (`RequireAuth`) e rota admin (`RequireAdmin`).
- Temas: ink `#0a0a0b`, dourado `#d4af37`, creme `#f5f2ea`; tipografia Playfair Display + Inter.
- Cliente HTTP com Bearer JWT e `X-Operate-As` (`lib/api.ts`), estado de auth reidratado no mount.
- Páginas: landing, login/registro, contas (assistente do LinkedIn), campanhas, disparos, contatos,
  configurações (adaptada por papel), administração (usuários, contas, saúde), tutorial.

## Testes

- Suíte Vitest no backend (**31 arquivos de teste, 317 testes**), cobrindo: user/auth, rate limit,
  scheduler (incl. `expireStaleScheduling`), flows, chatbot, search, contacts, sweep, campaign,
  notification, broadcast, time, scope, queue (tipos de job), network (sync/scrape/xlsx/lista),
  contacts.routes, `calendar.service` (OAuth/evento/retry com fetch mockado),
  `scheduling.service` (janelas, slots com fuso, e-mail, match, máquina de estados),
  `calendar.routes` (status, oauth/url, availability, disconnect, bookings, callback),
  webhooks (incl. `new_relation` → upsert de contato),
  cadência (`cadence.ts`, `personalize.ts`, `campaigns.routes`, scheduler/sweep com follow-up).
- Rodar: `npm test -w @linkon/backend`.
- Typecheck de backend e frontend passando (`npm run typecheck`).
- Build de backend e frontend passando (`npm run build`).

## Decisões técnicas

- **bcrypt (custo 12)** para senhas; nenhuma rota devolve hash ou credenciais de conta.
- **SQLite por padrão** (`DATABASE_URL=file:./dev.db`), trocável por Postgres via Prisma.
- **Rate limit em memória** (sem dependência): suficiente para um único processo; para múltiplos
  processos/instâncias, migrar para uma store compartilhada (ex.: Redis).
- **Webhooks respondem `200` imediatamente** e processam em segundo plano (evita retry desnecessário).
- **Registros globais** (`userId: null`) como base do admin; `X-Operate-As` permite operar por usuário.
- **Usuário criado pelo admin nasce `ACTIVE`**; usuário auto-cadastrado nasce `PENDING` (aprovação).
- **Google Agenda via `fetch` nativo** (sem dependência Google): `calendar.service.ts` faz OAuth
  (`access_type=offline` + `prompt=consent`) e cria eventos com Meet; refresh token criptografado em
  repouso; `createEventRobust` trata `401` (refresh + retry), `429`/`5xx` (backoff) e desconexão.

## Segurança

- `.gitignore` protege `.env*` (exceto `.env.example`), banco local, `dump.rdb`, `*.zip`, build
  artifacts e diretórios de planos locais.
- `.env.example` com placeholders; valores reais nunca commitados.
- Senhas nunca voltam na API; usuário desativado (`PENDING`/`BLOCKED`) recebe `401`.
- Sem exclusão física de usuários na API (bloqueio via `status`); exclusão física só existe para
  campanhas do próprio escopo.
- Credenciais de contas criptografadas em repouso (AES-256-GCM, `CREDENTIALS_ENCRYPTION_KEY`).
- CORS com `origin: true` (reflete o origin do request); o backend valida o secret do webhook.

## Limitações conhecidas

- O rate limit é por processo (em memória); reiniciar o backend zera as contagens.
- O `X-Operate-As` aceita o id de qualquer usuário (não valida existência do alvo antes do uso).
- Campanhas dependem do Redis estar no ar; sem Redis, filas não funcionam (o health reporta `redis: false`).
- O preview de relações (`/accounts/:id/relations`) é limitado a 10.000 resultados por chamada.
- `syncAccounts` silenciosamente ignora falhas da Unipile (retorna contas locais).
- O agendamento só funciona com `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` configurados e o
  `CalendarConnection` do usuário `CONNECTED`; sem isso, conversas com intenção de agendar são
  transferidas ao humano.

## Fora de escopo deste repositório

- Rebranding da interface ou migração de stack.
- Apagamento de histórico de usuários ou envios.
- Publicação em showcase ou deploy gerenciado.
