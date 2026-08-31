# LinkON — Referência da API

Base URL: `http://localhost:3001/api` (todas as rotas abaixo são prefixadas com `/api`).

Convenções:

- Corpo e resposta em JSON (exceto exportações XLSX, que retornam `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`).
- Autenticação: `Authorization: Bearer <jwt>` (token de `POST /auth/login`). Exceções indicadas como **pública**.
- Erros: resposta `{ "error": "mensagem" }`. Erros de validação zod retornam `400` com `{ "error": ..., "issues": [...] }`.
- Rota inexistente: `404 { "error": "Rota não encontrada" }`.
- **Rotas legadas sem autenticação respondem `404`** (o middleware `requireAuth` protege tudo exceto o que está listado como público).
- Rate limit: `POST /auth/login` permite 10 tentativas por minuto por IP; acima disso `429 { "error": "Muitas tentativas..." }` com header `Retry-After`.

## Índice de rotas

### Públicas (sem token)

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/health` | Saúde do sistema (Redis, Unipile, contagens) |
| GET | `/webhooks/ping` | Ping do serviço de webhooks |
| GET | `/webhooks/unipile` | Confirmação de webhook (GET de verificação) |
| POST | `/webhooks/unipile` | Recebe eventos da Unipile |
| POST | `/auth/login` | Login (com rate limit) |
| POST | `/auth/register` | Auto-cadastro (usuário nasce `PENDING`) |

### Autenticadas (Bearer JWT)

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/auth/me` | Dados do usuário logado |
| POST | `/auth/change-password` | Altera a própria senha |
| POST | `/auth/native` | **Admin** — conecta conta por login nativo |
| POST | `/auth/native/checkpoint` | **Admin** — resolve checkpoint/2FA |
| POST | `/auth/hosted` | Cria URL de auth hospedada da Unipile |
| POST | `/auth/webhooks` | **Admin** — registra webhooks na Unipile |
| GET | `/config` | Status da configuração Unipile e webhooks |
| PUT | `/config` | **Admin** — grava DSN, token e URL pública do webhook |
| POST | `/accounts/confirm-hosted` | Confirma conexão hospedada |
| GET | `/accounts` | Lista contas do escopo |
| GET | `/accounts/:id` | Detalhe da conta (campanhas e últimos logs) |
| POST | `/accounts/:id/disconnect` | Desconecta conta |
| GET | `/accounts/:id/relations` | Preview das relações da conta |
| POST | `/campaigns` | Cria campanha |
| GET | `/campaigns` | Lista campanhas do escopo com stats |
| GET | `/campaigns/:id` | Detalhe da campanha com stats |
| PUT | `/campaigns/:id` | Atualiza campanha (parcial) |
| POST | `/campaigns/:id/start` | Inicia campanha |
| POST | `/campaigns/:id/pause` | Pausa campanha |
| POST | `/campaigns/:id/resume` | Retoma campanha |
| POST | `/campaigns/:id/sweep` | Importa leads da varredura/disparo |
| DELETE | `/campaigns/:id` | Exclui campanha (logs, notificações e campanha) |
| GET | `/campaigns/:id/leads/selection` | Contagem de leads selecionados |
| POST | `/campaigns/:id/leads/select` | Seleciona/desseleciona leads |
| GET | `/campaigns/:id/leads` | Lista leads (filtros) |
| POST | `/campaigns/:id/scrape-contacts` | Agenda coleta de contatos dos leads |
| GET | `/campaigns/:id/scrape-status` | Status da coleta de contatos |
| GET | `/campaigns/:id/export-xlsx` | Exporta leads em `.xlsx` |
| GET | `/campaigns/:id/logs` | Logs da campanha (paginado) |
| POST | `/extractions` | Cria extração |
| GET | `/extractions` | Lista extrações do escopo |
| GET | `/extractions/:id` | Detalhe da extração + `leadsCount` |
| GET | `/extractions/:id/leads` | Lista leads extraídos |
| GET | `/extractions/:id/export-xlsx` | Exporta extração em `.xlsx` |
| DELETE | `/extractions/:id` | Exclui extração |
| GET | `/logs` | Logs globais (paginado, filtro `campaignId`) |
| GET | `/notifications` | Notificações recentes |
| POST | `/notifications/read-all` | Marca todas como lidas |
| POST | `/notifications/:id/read` | Marca uma notificação como lida |

### Administrativas (**Admin**)

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/admin/overview` | Saúde: Redis, filas, contagens |
| GET | `/admin/logs` | Logs globais (filtro `level`) |
| GET | `/admin/accounts` | Contas de todos os usuários (com dono) |
| POST | `/admin/accounts/:id/disconnect` | Desconecta conta (via Unipile) |
| POST | `/admin/accounts/:id/approve` | Aprova conta `PENDING_LINKEDIN` |
| POST | `/admin/accounts/:id/reject` | Rejeita conta `PENDING_LINKEDIN` |
| POST | `/admin/users` | Cria usuário (nasce `ACTIVE`) |
| GET | `/admin/users` | Lista usuários com contagens |
| POST | `/admin/users/:id/approve` | Aprova usuário (`PENDING` → `ACTIVE`) |
| POST | `/admin/users/:id/block` | Bloqueia usuário (pausa campanhas ativas) |
| POST | `/admin/users/:id/unblock` | Desbloqueia usuário |
| POST | `/admin/users/:id/reset-password` | Redefine senha de usuário |
| GET | `/admin/global` | Contagem de campanhas/extrações globais |

### Calendar (Agendamento)

| Método | Rota | Descrição | Auth |
| --- | --- | --- | --- |
| GET | `/calendar/status` | Status da conexão Google Agenda | JWT |
| GET | `/calendar/oauth/url` | URL de conexão OAuth (state JWT 10 min) | JWT |
| GET | `/calendar/oauth/callback` | Callback OAuth → redirect `?calendar=connected\|error` | Público |
| POST | `/calendar/disconnect` | Desconecta (limpa refresh token) | JWT |
| GET | `/calendar/availability` | Janelas de disponibilidade | JWT |
| PUT | `/calendar/availability` | Substitui janelas (valida overlap) | JWT |
| GET | `/calendar/bookings` | Bookings CONFIRMED do vendedor | JWT |

`PUT /api/agents/:accountId` agora aceita `schedulingEnabled`, `meetingDurationMin`, `meetingTitle`.

### Inbox (atendimento humano)

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET /api/inbox?offset=&limit=` | Lista conversas paginada. Retorna `{ items, needsHuman, total, hasMore }`. |
| `GET /api/inbox/:id/messages?cursor=&limit=` | Histórico paginado. Retorna `{ items, nextCursor }` (ascendente). |
| `POST /api/inbox/:id/read` | 204. Marca como lida (zera unread). |
| `PATCH /api/inbox/:id` | Body `{ note?, resolved? }`. Atualiza nota interna/status resolvida. |
| `POST /api/inbox/:id/suggest-reply` | Body `{ text? }`. Gera rascunho de resposta do vendedor com a base do agente. 502 em falha do LLM. |

## Detalhes

### GET /health

Resposta:

```json
{
  "ok": true,
  "timestamp": "2026-08-26T00:00:00.000Z",
  "redis": true,
  "unipileConfigured": true,
  "accounts": 3,
  "campaigns": 4
}
```

### POST /auth/login

Corpo: `{ "username": string, "password": string }`.

Resposta `200`:

```json
{
  "token": "<jwt>",
  "user": { "id": "cuid", "username": "arcanjo", "name": "Administrador", "role": "ADMIN", "status": "ACTIVE" }
}
```

Erros: `401` credenciais inválidas; `401` usuário `PENDING` ("Aguardando aprovação do administrador."); `401` usuário `BLOCKED`; `429` rate limit.

### POST /auth/register

Corpo: `{ "name": string(1-120), "username": string(3-40), "password": string(6-100), "whatsapp?": string(max 25) }`.

Resposta `201` com o usuário público (status `PENDING`). `409` se o username já existir.

### GET /auth/me

Resposta: `{ "id", "username", "name", "role", "status" }`. `401` se o usuário não existir mais.

### POST /auth/change-password

Corpo: `{ "currentPassword": string, "newPassword": string(min 6) }`. Resposta `{ "ok": true }`. Erros: `400` senha atual incorreta.

### POST /auth/native (Admin)

Corpo: `{ "username": string, "password": string, "country"?: string, "userId"?: string }`.

Resposta `201`: `{ "status": "OK", "accountId", "account" }`. Se houver checkpoint: `202 { "status": "CHECKPOINT", "checkpoint", "accountId" }`.

### POST /auth/native/checkpoint (Admin)

Corpo: `{ "accountId": string, "code": string }`. Resposta: `{ "status": "OK", "accountId" }` ou `202` com novo checkpoint.

### POST /auth/hosted

Resposta: `{ "url": "<url-de-auth-hospedada>" }`. O escopo segue a regra de tenancy (`X-Operate-As` para admin).

### POST /auth/webhooks (Admin)

Resposta: `{ "ok": true, ... }` (registro de webhooks na Unipile usando `WEBHOOK_PUBLIC_URL`).

### GET /config

Resposta:

```json
{
  "unipileDsnConfigured": true,
  "unipileAccessTokenConfigured": true,
  "webhookPublicUrl": "https://exemplo.com",
  "webhookPublicUrlConfigured": true,
  "webhooks": []
}
```

### PUT /config (Admin)

Corpo (qualquer campo opcional, objeto estrito): `{ "unipileDsn"?: string(url), "unipileAccessToken"?: string, "webhookPublicUrl"?: string(url) }`. Resposta `{ "ok": true }`.

### GET /accounts

Resposta: `{ "items": [ { "id", "unipileAccountId", "provider", "username", "authMethod", "status", "checkpointType", "createdAt", "updatedAt", "_count": { "campaigns" } } ] }`.

Antes de listar, tenta `syncAccounts()` com a Unipile; se a Unipile não estiver configurada, retorna as contas locais mesmo assim.

### POST /accounts/confirm-hosted

Confirma a conexão hospedada pendente do usuário. Usuário comum: cria conta local em modo "pending". Resposta: `{ "accounts": [...] }` (contas confirmadas).

### GET /accounts/:id

Inclui `campaigns` (id, name, status) e `logs` (últimos 20).

### POST /accounts/:id/disconnect

Resposta `{ "ok": true }`. `404` se a conta não existir no escopo.

### GET /accounts/:id/relations

Query: `?cap=` (padrão 5000, mínimo 100, máximo 10000). Resposta: preview das relações da conta + `{ "account": { "id", "username" } }`.

### POST /campaigns

Corpo (zod):

```json
{
  "name": "string(1-200)",
  "mode": "SEARCH | SWEEP | DISPARO",
  "searchUrl": "string (obrigatório se SEARCH; para SWEEP/DISPARO é derivado)",
  "accountId": "string",
  "inviteMessage": "string(max 300)",
  "dailyLimit": 40,
  "weeklyLimit": 150,
  "minDelayMin": 5,
  "maxDelayMin": 15,
  "workStartHour": 9,
  "workEndHour": 18,
  "chatbotEnabled": false,
  "chatbotRules": [ { "matchType": "contains|keywords|regex", "pattern": "string", "reply": "string" } ],
  "chatbotDefaultReply": "",
  "chatbotReplyDelayMin": 1,
  "chatbotReplyDelayMax": 3,
  "chatbotStopKeywords": [],
  "maxRepliesPerLead": 3,
  "maxLeads": 1000,
  "flow": { "nodes": [], "edges": [] }
}
```

Regras: SWEEP/DISPARO exigem `inviteMessage` ou `flow.nodes` não vazio. `minDelayMin <= maxDelayMin`. `accountId` deve pertencer ao escopo. Resposta `201` com a campanha criada.

### GET /campaigns

Resposta: `{ "items": [ campanha + { "stats": { total, selected, ...por status }, "nextInviteAt" } ] }`.

### GET /campaigns/:id

Detalhe com `account` (id, username, status), `stats` e `nextInviteAt`.

### PUT /campaigns/:id

Mesmo corpo de criação, parcial. Fluxo, quando presente, é validado (`400` com erros de validação).

### POST /campaigns/:id/start | /pause | /resume

Resposta `{ "ok": true }`.

### POST /campaigns/:id/sweep

Dispara `importBroadcastLeads` (importa relações/leads para SWEEP/DISPARO). Resposta: resultado da importação.

### DELETE /campaigns/:id

Transação: apaga logs, notificações e campanha. Resposta `{ "ok": true }`.

### GET /campaigns/:id/leads/selection

Resposta: `{ "selected": n, "total": n }`.

### POST /campaigns/:id/leads/select

Corpo: `{ "action": "replace|all|none|toggle", "providerIds"?: string[] }`. Resposta: `{ "selected": n }`.

### GET /campaigns/:id/leads

Query: `page` (1+), `pageSize` (1-200, padrão 50), `status`, `selected` (`true`/`false`/`all`), `q` (busca por nome). Em campanhas `DISPARO` sem filtro, retorna apenas `selected` em ordem de criação. Resposta: `{ "items", "total", "page", "pageSize" }`.

### POST /campaigns/:id/scrape-contacts

Agenda coleta de contatos. Resposta: resultado do agendamento.

### GET /campaigns/:id/scrape-status

Resposta: stats da coleta de contatos.

### GET /campaigns/:id/export-xlsx

Baixa `.xlsx` com os leads. Header `Content-Disposition: attachment`.

### GET /campaigns/:id/logs

Query: `page`, `pageSize`. Resposta: `{ "items", "total", "page", "pageSize" }`.

### POST /extractions

Corpo: `{ "name"?: string(max 120), "searchUrl": string(1-2000), "accountId": string, "maxResults"?: int(1-500) }`. A conta deve pertencer ao escopo. Resposta `201` com a extração (status `PROCESSING`).

### GET /extractions

Resposta: `{ "items": [...] }`.

### GET /extractions/:id

Detalhe + `{ "leadsCount": n }`.

### GET /extractions/:id/leads

Query: `onlyWithContact=1|true`. Resposta: `{ "items", "total" }`.

### GET /extractions/:id/export-xlsx

Query: `providerIds=a,b,c`. Baixa `.xlsx` (todos ou apenas os `providerIds`).

### DELETE /extractions/:id

Resposta `{ "ok": true }`.

### GET /logs

Query: `campaignId`, `page`, `pageSize`. Resposta: `{ "items", "total", "page", "pageSize" }`.

### GET /notifications

Query: `limit` (1-50, padrão 20). Resposta: `{ "items", "unread" }`.

### POST /notifications/read-all

Resposta `{ "ok": true }`.

### POST /notifications/:id/read

`404` se não existir. Resposta `{ "ok": true }`.

### GET /api/inbox

Query: `offset` (base 0, padrão 0), `limit` (1-100, padrão 50). Resposta:
`{ "items", "needsHuman", "total", "hasMore" }`. Ordena por status + `lastMessageAt` desc.
`items[]` incluem `id`, `status`, `note`, `resolved`, `lastMessageAt`, `lead`, `campaign`, `account`,
`lastMessage`, `unread` (mensagens LEAD após `readAt`; `readAt` nulo = todas) e `booking` (próximo CONFIRMED).

### GET /api/inbox/:id/messages

Query: `cursor` (id da mensagem), `limit` (1-100, padrão 50). Resposta: `{ "items", "nextCursor" }`
ascendente (as mais recentes primeiro por cursor). `nextCursor` é `null` quando não há mais páginas.

### POST /api/inbox/:id/read

Resposta `204` sem corpo. Seta `conversation.readAt` para agora (zera o `unread`).

### PATCH /api/inbox/:id

Body: `{ "note"?: string(max 2000), "resolved"?: boolean }` (parcial). Resposta: o item atualizado
(mesmo shape do `items[]` de `GET /api/inbox`). `404` se a conversa não existir no escopo.

### POST /api/inbox/:id/suggest-reply

Body: `{ "text"?: string(max 3000) }`. Sem `text`, usa a última mensagem do lead. Resposta:
`{ "reply", "costUsd" }` (rascunho gerado pela base de conhecimento do agente + custo estimado).
`400` sem mensagem para responder; `502` em falha do LLM.

### Admin

#### GET /admin/overview

Resposta:

```json
{
  "redis": true,
  "queues": {
    "invites": { "waiting": 0, "active": 0, "delayed": 0, "failed": 0, "completed": 0 },
    "chatbot": { ... },
    "search": { ... },
    "pendingJobs": 0,
    "failedJobs": 0
  },
  "counts": { "accounts": 1, "campaigns": 2, "leads": 5, "logs": 10, "leadByStatus": { "PENDING": 5 } },
  "timestamp": "..."
}
```

#### GET /admin/logs

Query: `page`, `pageSize`, `level`. Resposta: `{ "items", "total", "page", "pageSize" }`.

#### GET /admin/accounts

Resposta: `{ "items": [ conta + { "user": { "id", "username" } | null } ] }`.

#### POST /admin/accounts/:id/disconnect

Desconecta na Unipile e marca `DISCONNECTED`. `400` se a Unipile não estiver configurada. `404` se a conta não existir.

#### POST /admin/accounts/:id/approve

Só para status `PENDING_LINKEDIN` (`400` caso contrário). Marca `OK`, limpa `checkpointType`. Loga `ACCOUNT_CONNECTED`.

#### POST /admin/accounts/:id/reject

Só para status `PENDING_LINKEDIN`. Marca `REJECTED`.

#### POST /admin/users

Corpo: `{ "name": string(1-120), "username": string(3-40), "password": string(6-100), "whatsapp"?: string(max 25) }`. Resposta `201` com o usuário (status `ACTIVE`). `409` se username existir.

#### GET /admin/users

Resposta: `{ "items": [ { "id", "username", "name", "role", "status", "whatsapp", "createdAt", "_count": { "accounts", "campaigns", "extractions" } } ] }`.

#### POST /admin/users/:id/approve | /block | /unblock

`approve`: `PENDING` → `ACTIVE`. `block`: `BLOCKED` + pausa campanhas RUNNING/IMPORTING do usuário. `unblock`: `ACTIVE`. Resposta `{ "ok": true }`. `404` se o usuário não existir.

#### POST /admin/users/:id/reset-password

Corpo: `{ "password": string(min 6) }`. Resposta `{ "ok": true }`.

#### GET /admin/global

Resposta: `{ "campaigns": n, "extractions": n }` (registros com `userId` nulo).

## Webhooks da Unipile

- `POST /webhooks/unipile` — recebe eventos. Valida o header `unipile-auth` (ou `authorization`) contra
  `UNIPILE_WEBHOOK_SECRET`; se o secret estiver configurado e não bater: `401`. Responde `200 { "ok": true }`
  imediatamente e processa em segundo plano.
- Eventos tratados:
  - `message_received` — atualiza o lead (status `RESPONDED`), avança fluxo e, se o chatbot estiver
    habilitado, enfileira resposta no `linkon-chatbot`.
  - `new_relation` — marca lead `ACCEPTED` e avança fluxo.
- `GET /webhooks/unipile` — verificação (mesma regra de secret).
- `GET /webhooks/ping` — `{ "ok": true, "timestamp" }`.

## Códigos de erro comuns

| Código | Significado |
| --- | --- |
| 400 | Validação de corpo (zod) ou regra de negócio (ex.: mensagem de disparo ausente) |
| 401 | Não autenticado, sessão inválida, usuário PENDING/BLOCKED, ou credenciais inválidas |
| 403 | Fora do escopo (conta/campanha de outro usuário) ou ação restrita ao admin |
| 404 | Recurso não encontrado (ou rota sem autenticação, que responde 404) |
| 409 | Conflito (ex.: username duplicado) |
| 429 | Rate limit no login |
