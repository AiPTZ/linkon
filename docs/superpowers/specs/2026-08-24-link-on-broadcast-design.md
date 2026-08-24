# Link ON — Disparo em Massa (Broadcast)

Data: 2026-08-24

## 1. Objetivo

Criar um **gerenciador de disparo de mensagens em massa**: o usuário cria uma campanha de
disparo, varre a rede da conta (carrega as conexões), **seleciona para quem enviar**, escreve a
mensagem pronta e dispara. Depois, acompanha o progresso em tempo real (lista, detalhe por lead,
métricas de resposta e notificações).

A funcionalidade atual "Varrer rede" (modo `SWEEP`) deixa de ser um recurso isolado e vira uma
**etapa** dentro do fluxo de criação de um disparo.

## 2. Modelo de dados

### Campaign
- `mode`: novos valores permitidos `DISPARO` (além de `SEARCH` e `SWEEP`).
- Campanhas `DISPARO` usam `inviteMessage` para guardar a mensagem do disparo e `searchUrl`
  recebe o placeholder `"DISPARO"`.
- O ciclo de vida é igual ao das outras: `DRAFT → RUNNING → PAUSED/LIMIT_HIT/COMPLETED/ERROR`.

### Lead
- Novo campo `selected Boolean @default(false)`.
  - `selected = true`: contato escolhido para receber o disparo.
  - `selected = false`: conexão importada pela varredura mas ainda não escolhida (ou rejeitada).

### Notification (novo modelo)
- `id`, `accountId?`, `campaignId?`, `type`, `level` (INFO/WARN/ERROR), `message`, `payload?`,
  `read Boolean @default(false)`, `createdAt`.
- Usado pelo sino de notificações no frontend.

## 3. Backend

### Rotas (campaigns)
- `POST /api/campaigns` com `mode: "DISPARO"`:
  - Cria o rascunho **sem leads**; exige `inviteMessage` não vazio (ou fluxo definido).
  - `searchUrl` é preenchido com `"DISPARO"` internamente.
- `POST /api/campaigns/:id/sweep`:
  - Importa todas as conexões da conta como leads (`selected=false`, status `PENDING`),
    paginando `GET /api/v1/users/relations` (reusa `importLeadsFromSweep`).
  - Idempotente (upsert por `campaignId_providerId`), respeita `maxLeads`.
  - Responde `{ imported, total }` e cria notificação de importação concluída.
- `POST /api/campaigns/:id/leads/select`:
  - Body `{ action: "replace", providerIds: string[] }` | `{ action: "all" }` | `{ action: "none" }`.
  - `replace`: marca `selected=true` para os ids informados e `false` para os demais.
  - `all`/`none`: marca todos / nenhum.
  - Responde `{ selected }` (quantidade).
- `GET /api/campaigns/:id/leads`:
  - Novos query params opcionais: `selected` (`true`/`false`) e `q` (busca por nome).
- `POST /api/campaigns/:id/start`:
  - Para `DISPARO`: não enfileira importação; valida que existe ≥ 1 lead com `selected=true`;
    vai direto para `RUNNING`.
  - Para `SEARCH`/`SWEEP`: comportamento atual mantido.

### Rotas (notificações)
- `GET /api/notifications?unread=1&limit=N` — lista (não lidas primeiro).
- `POST /api/notifications/read-all` — marca todas como lidas.
- `POST /api/notifications/:id/read` — marca uma como lida.

### Serviço `notify()`
- `notify({ accountId?, campaignId?, type, level, message, payload? })` grava uma `Notification`.
- Chamado em: campanha iniciada, importação da varredura concluída, limite atingido
  (`LIMIT_HIT`), campanha concluída (`COMPLETED`), falha permanente relevante.

### Scheduler
- Em `processCampaigns`, novo ramo para `mode === "DISPARO"`:
  - Com fluxo → `processFlowCampaign`.
  - Sem fluxo → novo `processBroadcastCampaign`.
- `processBroadcastCampaign` (espelha `processSweepCampaign`), com a diferença de que o lead
  elegível exige `selected: true`. Completa quando não houver mais lead `selected` + `PENDING`.
- `processFlowCampaign`: a query de leads elegíveis passa a filtrar `selected: true` quando
  `campaign.mode === "DISPARO"`.

### flow.service (semântica de já-conectado)
- Criar helper `isConnectedMode(mode)` = `mode === "SWEEP" || mode === "DISPARO"`.
- Usar esse helper nos pontos hoje atrelados a `SWEEP`:
  - bloco `invite` → envia mensagem direta;
  - bloco `message` → permite status `PENDING`;
  - bloco `on_accept` → passa direto;
  - condição `accepted` → sempre verdadeira.

### Worker sweep
- `sweep.worker.ts`: ao processar job de campanha `DISPARO`, exige `lead.selected === true`
  (além de `status === "PENDING"` e `currentBlockId === null`).

### Compatibilidade
- Campanhas `SEARCH` (convite) e `SWEEP` antigas continuam funcionando no backend sem mudança de
  comportamento.

## 4. Frontend

### Navegação
- Item do menu "Varrer rede" (`/rede`) substituído por **"Disparos"** (`/disparos`).
- Página `SweepPage.tsx` removida; `DisparoNewPage` e `DisparoSelectPage` entram no lugar.

### Páginas
- `/disparos` (`DisparosPage`): lista de campanhas `DISPARO` com progresso em tempo real
  (poll 5s): enviados (`COMPLETED`), pendentes, respondidos (`RESPONDED`), falhas (`ERROR`),
  taxa de resposta, status e botão "Novo disparo".
- `/disparos/nova` (`DisparoNewPage`): formulário de configuração (nome, conta, mensagem,
  estratégia: limites, atrasos, horário, maxLeads). Cria o rascunho e navega para a seleção.
- `/disparos/:id/selecionar` (`DisparoSelectPage`):
  - Botão "Varrer rede" dispara `POST /campaigns/:id/sweep` e recarrega a lista.
  - Seletor de contatos: lista paginada, checkbox por lead, "selecionar todos", busca por nome,
    contador de selecionados.
  - Altera seleção via `POST /campaigns/:id/leads/select` (action replace).
  - Botão "Disparar" chama `POST /campaigns/:id/start` e navega para o detalhe.
- `/disparos/:id` (detalhe): reusa `CampaignDetailPage` com ajustes:
  - Badge/modo de varredura já existente cobre `DISPARO` (a mensagem, os filtros de lead por
    status e o fluxo opcional seguem funcionando).
  - Métricas de resposta: card com taxa de resposta (`RESPONDED/enviados`), aceites e falhas.

### Notificações (Layout)
- Sino no sidebar (desktop) e na barra superior (mobile) com badge de não lidas.
- Dropdown com as notificações recentes (poll 30s), ação "marcar todas como lidas".

## 5. Erros e limites
- `start` de disparo sem nenhum contato selecionado → `400` com mensagem clara.
- `sweep` em conta desconectada → `400` "Conta desconectada".
- Limite do LinkedIn (429 / limit_exceeded / cannot_resend) → campanha vai a `LIMIT_HIT` +
  notificação (comportamento atual preservado).
- Falha permanente por lead → `ERROR` + log (sem bloquear os demais).

## 6. Testes
- Unit:
  - `processBroadcastCampaign` envia só para `selected=true` e completa o ciclo.
  - `flow.service`: semântica `DISPARO` (invite → DM, message com PENDING, on_accept direto).
  - `lead select` (replace/all/none) e filtros `selected`/`q`.
  - `notify()` grava e marca leitura.
  - Regressão: suíte existente continua verde.
- Frontend: typecheck + build.
- Manual: criar disparo, varrer, selecionar, disparar e acompanhar na lista/detalhe/notificações.

## 7. Fora de escopo (YAGNI)
- Reagendar/editar seleção após o disparo iniciar (requer pausar).
- Agendamento futuro de disparos (data/hora).
- Segmentação avançada (por cargo/empresa) além de busca por nome.
- Relatórios exportáveis.
