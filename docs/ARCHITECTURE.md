# LinkON — Arquitetura

## Visão de alto nível

```
┌──────────────┐    HTTP (JWT)     ┌──────────────────┐
│   Frontend   │ ────────────────► │  API (Express)   │
│ React + Vite │ ◄──────────────── │  porta 3001      │
└──────────────┘      JSON/API     └────────┬─────────┘
                                            │
                       ┌────────────────────┼─────────────────────┐
                       │ Prisma (SQLite)    │ Redis (BullMQ)      │
                       ▼                    ▼                     ▼
                 ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐
                 │  dev.db      │   │   Redis      │   │  Workers BullMQ      │
                 │ (AppConfig,  │   │  6379        │   │  invites, chatbot,   │
                 │  User, ...)  │   └──────────────┘   │  search, sweep,      │
                 └──────────────┘                      │  contacts, extraction│
                                                       └──────────────────────┘
                                                       ┌──────────────────────┐
                                                       │  Scheduler (cron 5m) │
                                                       │  node-cron           │
                                                       └──────────────────────┘
```

Integração externa: **Unipile API** (autenticação de contas, envio de mensagens/convites, webhooks de
eventos). O frontend NÃO chama a Unipile diretamente.

## Monorepo

Workspaces npm (`package.json` raiz): `backend` e `frontend`.

- `backend/` — API, serviços, filas, workers, scheduler.
- `frontend/` — SPA React + Vite + Tailwind.
- `start.sh` — sobe API, workers (invite, chatbot, search, sweep) e frontend.

## Backend (Express + TypeScript)

Estrutura em `backend/src/`:

| Pasta | Conteúdo |
| --- | --- |
| `index.ts` | Bootstrap: Express, CORS, JSON (limite 2mb), monta `/api`, 404 padrão, seed do admin, scheduler, shutdown gracioso |
| `config/` | `env.ts` — variáveis de ambiente validadas com zod |
| `lib/` | `prisma.ts`, `redis.ts` — clientes |
| `middleware/` | `auth.ts` (requireAuth/requireAdmin), `rateLimit.ts` (login) |
| `routes/` | Controllers da API (ver [API.md](./API.md)) |
| `services/` | Lógica de negócio (user, auth, campaign, invite, chatbot, flow, sweep, broadcast, search, contacts, extraction, config, queue, log, notification, unipile, calendar, scheduling) |
| `workers/` | Processos BullMQ |
| `scheduler.ts` | Cron de 5 minutos que processa campanhas RUNNING |
| `utils/` | `time`, `crypto`, `errors`, `logger`, `scope` |

### Modelo de dados (Prisma, SQLite)

- `AppConfig` — pares chave/valor para configuração (DSN Unipile, access token, URL pública do webhook).
- `User` — `{ id, name, username (único), passwordHash, whatsapp, role, status }`. `status`: `PENDING`,
  `ACTIVE`, `BLOCKED`. `role`: `USER` | `ADMIN`.
- `Account` — conta LinkedIn conectada; `userId` opcional (nulo = global). Guarda `credentialsEnc`
  (criptografado), `authMethod` (`NATIVE`/`HOSTED`), `status`, `checkpointType`. Cada usuário pode ter
  no máximo uma conta com `status ≠ "REJECTED"` — regra garantida no service
  (`assertCanConnectLinkedIn` em `auth.service.ts`), sem constraint de banco.
- `Campaign` — `mode` (`SEARCH`/`SWEEP`/`DISPARO`), limites, janela de trabalho, chatbot, `flow`
  (JSON serializado), contadores de envio (`invitesSentToday`, `invitesSentWeek`), `userId` opcional.
  Em DISPARO pode ter `cadence` (JSON string com 1-5 itens `{body, waitDays}`) para follow-ups.
- `Lead` — lead de campanha; `status` (`PENDING`, `INVITED`, `ACCEPTED`, `RESPONDED`, ...), `selected`
  (para DISPARO), controle de reenvio (`nextInviteAt`), `currentBlockId` (fluxos), `cadenceStep`
  (cópia atual da cadência).
- `Extraction` / `ExtractedLead` — extrações e leads extraídos (emails, telefones, socials, distância).
- `LogEvent` — log com `type`, `level`, `message`, `payload`, vínculos opcionais.
- `Notification` — notificação com `read`.
- `WebhookRegistration` — registro de webhooks da Unipile.
- `CalendarConnection` — conexão Google Agenda do usuário (`userId` único); `refreshToken`
  (criptografado), `googleEmail`, `status` (`CONNECTED`/`DISCONNECTED`), `disconnectedAt`.
- `SellerAvailability` — janelas de disponibilidade do vendedor (`userId` único), `windows` em JSON.
- `Booking` — reunião agendada (`startTime`, `endTime`, `title`, `meetLink`, `googleEventId`,
  `status` `CONFIRMING`/`CONFIRMED`/`CANCELLED`); `@@unique([userId, startTime, endTime])` evita
  duplicidade; vínculos com `User`, `Account` e `Conversation`.
- `NativeAgent` (extra) — campos `schedulingEnabled`, `meetingDurationMin`, `meetingTitle`.
- `Conversation` (extra) — `scheduleState` (máquina de agendamento) e `scheduleData` (JSON com o
  contexto da oferta: slots, rodada, e-mail), relação `bookings`. Para atendimento humano também
  persiste `note` (nota interna) e `resolved` (status resolvida).

### Filas e workers (BullMQ)

Filas em `services/queue.service.ts`, consumidas por processos separados (`workers/`):

| Fila | Worker | Consumo |
| --- | --- | --- |
| `linkon-invites` | `invite.worker.ts` | Envia convite para um lead (`{leadId, campaignId}`) |
| `linkon-chatbot` | `chatbot.worker.ts` | Envia resposta automática (`{chatId, leadId, campaignId, message}`) |
| `linkon-search` | `search.worker.ts` | Importa leads de busca/varredura (`{campaignId}`) |
| `linkon-sweep` | `sweep.worker.ts` | Envia mensagem de varredura para um lead |
| `linkon-contacts` | `contacts.worker.ts` | Coleta contato (email/telefone) de um lead |
| `linkon-extraction` | `extraction.worker.ts` | Executa extração e scrape de perfis (`{extractionId, type}`) |

### Scheduler

`cron.schedule("*/5 * * * *", ...)` (a cada 5 minutos). Para cada campanha `RUNNING`:

- Reseta contadores diários quando necessário (`refreshCounters`).
- Aplica limites (semanal → pausa com `LIMIT_HIT`; diário → aguarda próximo dia) e janela de horário.
- Campanhas com `flow` → `processFlowCampaign`; sem fluxo → `processBroadcastCampaign` (SWEEP/DISPARO)
  ou `processInviteCampaign` (SEARCH), enfileirando os jobs correspondentes.

O scheduler roda dentro do processo da API (`startScheduler` em `index.ts`).

**Cadência de disparo:** para campanhas DISPARO com `cadence`, `processBroadcastCampaign` seleciona
primeiro os leads da cópia 1 (`PENDING`), depois os follow-ups (`COMPLETED` + `cadenceStep < length` +
`nextInviteAt` vencido). O `sweep.worker` aceita leads `COMPLETED` em cadência via `isEligibleForSweep`;
`sendSweepMessage` resolve o texto em `cadence[cadenceStep]` (ou `inviteMessage` quando não há cadência),
aplica `applyPlaceholders` (`{nome}`, `{cargo}`, `{link}`), incrementa `cadenceStep` e agenda a próxima
cópia `waitDays * 24h` após o envio (sem próximo agendamento na última cópia). Um reply do webhook
(`RESPONDED`) desqualifica o lead. A campanha só conclui quando não restam leads `PENDING` nem
follow-ups.

Além do cron de campanhas, o scheduler roda `expireStaleScheduling()` a cada 5 minutos (junto das
campanhas) e também em um cron dedicado a cada 15 minutos: conversas presas em `OFFERING` /
`AWAITING_EMAIL` / `CONFIRMING` com `updatedAt` há mais de 24h são resetadas para `NONE` (timeout
de segurança da máquina de agendamento).

### Agendamento automático (scheduling)

Fluxo: **webhook → `chatbot-ai.service` → `scheduling.service` → `calendar.service` → Google**.

1. No `handleIncomingMessage`, após o check de conversa travada (humano), conversas em estado de
   agendamento ativo roteiam para `advanceScheduling`; se a decisão do LLM for `intent: "schedule"`
   e o agente tiver `schedulingEnabled`, inicia `startBooking`.
2. `scheduling.service` mantém a máquina de estados por conversa (persistida em
   `Conversation.scheduleState`/`scheduleData`):
   `NONE → OFFERING → AWAITING_EMAIL → CONFIRMING → BOOKED` (com `FAILED` como terminal). Cada
   transição gera uma mensagem ao lead via `recordMessage`.
3. A oferta usa `generateSlots` (janelas do `SellerAvailability`, fuso `APP_TIMEZONE`, descontando
   `Booking` CONFIRMED/CONFIRMING já existentes); a extração de intenção/e-mail usa
   `generateExtraction`; a confirmação usa `generateConfirmationMessage` (todas em `ai.service`).
4. `completeBooking` chama `createEventRobust` (Google Calendar com Meet via fetch nativo, sem lib
   Google). Desconectado → transfere ao humano; falha retryável exaurida → cancela e reoferece.
5. O `Booking` é persistido (status `CONFIRMING` → `CONFIRMED` com `googleEventId`/`meetLink`), o
   evento aparece no Google Agenda e a conversa volta a `NONE`.

### Inbox (atendimento humano)

- Unread: mensagens LEAD após `conversation.readAt` (`readAt` nulo = todas não lidas); `POST /read` seta `readAt` e zera o contador.
- Paginação: lista por offset (ordena por status + lastMessageAt); mensagens por cursor (`id`), janela das mais recentes.
- `note`/`resolved` persistidos em `Conversation` (PATCH `/inbox/:id`).
- Resposta assistida: `generateHumanReply` (ai.service.ts) reusa a base de conhecimento do agente (NativeAgent) e devolve rascunho editável + custo estimado.

### Autenticação e escopo

- **JWT**: payload `{ sub, username, role, status }`, assinado com `AUTH_SECRET`, expira em 7 dias.
- `requireAuth`: exige `Authorization: Bearer <token>` e `status === "ACTIVE"`; caso contrário `401`.
- `requireAdmin`: exige `role === "ADMIN"`; caso contrário `403`.
- `resolveScope(req)`: ADMIN sem `X-Operate-As` → escopo global (`userId: null`); ADMIN com
  `X-Operate-As: <id>` → escopo daquele usuário; USER → o próprio `sub`.
- `assertAccountInScope`: impede operar conta de outro usuário (403).

### Segurança de dados

- Senhas com bcrypt (custo 12); nenhuma rota devolve `passwordHash` ou credenciais de conta.
- Credenciais de contas criptografadas em repouso (AES-256-GCM, chave `CREDENTIALS_ENCRYPTION_KEY`).
- Webhooks validados por segredo compartilhado (`UNIPILE_WEBHOOK_SECRET`).
- Rate limit por IP no `POST /api/auth/login` (10/min, `429` + `Retry-After`).

## Frontend (React + Vite + Tailwind)

SPA em `frontend/`, tema dark/ink `#0a0a0b` com dourado `#d4af37` e creme `#f5f2ea`, tipografia
Playfair Display + Inter.

Rotas (`App.tsx`):

| Rota | Página |
| --- | --- |
| `/` | Landing |
| `/login`, `/registro` | Login / auto-cadastro |
| `/campanhas`, `/campanhas/nova`, `/campanhas/:id`, `/campanhas/:id/fluxo` | Campanhas |
| `/conectar` | Contas LinkedIn |
| `/disparos`, `/disparos/nova`, `/disparos/:id`, `/disparos/:id/selecionar` | Disparos |
| `/extracao`, `/extracao/:id` | Extrações |
| `/configuracoes` | Configurações (por papel) |
| `/administracao` | Painel admin (RequireAdmin) |
| `/tutorial` | Tutorial |

- `src/lib/api.ts` — cliente HTTP com Bearer JWT e `X-Operate-As`; guarda o usuário operante em
  `linkon_operating_as` e restaura no mount.
- `src/lib/auth.tsx` — contexto de autenticação.
- `src/lib/flow.ts`, `src/lib/theme.ts` — helpers de fluxo e tema.
- `src/components/` — `Layout`, `FlowEditor`, `Logo`, `NextSendCountdown`, `Pagination`, `Spinner`,
  `StatCard`, `SupportBubble`, `Toast`.
- `src/pages/` — páginas listadas acima; `SweepPage` e `DisparoSelectPage` auxiliam os modos.

O frontend não conhece segredos; usa apenas `VITE_WHATSAPP_SUPPORT` (link de suporte na tela de login).

## Fluxos de dados principais

1. **SEARCH** — usuário cola URL de busca salva → `POST /api/campaigns` (mode SEARCH) → iniciar →
   `search.worker` importa leads → scheduler/`invite.worker` envia convites respeitando limites.
2. **SWEEP** — modo SWEEP → `search.worker`/`sweep.worker` varrem relações e enviam mensagens.
3. **DISPARO** — usuário seleciona leads (`POST /api/campaigns/:id/leads/select`) → scheduler dispara
   mensagem ou fluxo para os selecionados.
4. **Chatbot** — webhook `message_received` → marca lead `RESPONDED`, avança fluxo e (se habilitado)
   enfileira resposta no `linkon-chatbot`. Com agendamento habilitado, conversas em estado ativo
   roteiam para a máquina de agendamento (ver seção acima).
5. **Extração** — `POST /api/extractions` → `extraction.worker` roda busca + scrape → export `.xlsx`.
