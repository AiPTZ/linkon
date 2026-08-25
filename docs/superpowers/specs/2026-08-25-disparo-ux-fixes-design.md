# Design: Ajustes de uso do disparo em massa (desconectar, exibição, status, tutorial)

Data: 2026-08-25
Status: Aprovado

## Contexto

Após validar o disparo em massa, o usuário solicitou quatro ajustes de uso:
desconectar contas do LinkedIn, restringir a área de exibição do disparo aos
contatos selecionados em ordem de envio, exibir o status concluído como
"Enviado" e criar uma rota de tutorial.

## Mudanças

### 1. Desconectar conta LinkedIn

- Backend: nova rota `POST /api/accounts/:id/disconnect`.
- Usa `unipile.deleteAccount` (`DELETE /api/v1/accounts/{id}`), confirmado por
  sondagem como o único mecanismo de desconexão disponível nesta versão da API
  da Unipile (o endpoint `/disconnect` não existe).
- Marca a conta local como `DISCONNECTED`, pausa campanhas `RUNNING`/`IMPORTING`
  da conta, registra log `ACCOUNT_DISCONNECTED` e mantém todos os dados locais.
- Frontend (Contas LinkedIn): botão "Desconectar" por conta com confirmação,
  loading e toast.

### 2. Área de exibição do disparo

- `GET /campaigns/:id/leads`: em campanhas `DISPARO`, por padrão retorna apenas
  leads `selected: true` ordenados por `createdAt asc` (ordem de envio do
  agendador). Sem migração de schema.
- `DisparoSelectPage` passa `selected=all` para manter a exibição completa na
  tela de seleção.
- Detalhe do disparo mostra aviso: "Exibindo apenas os contatos selecionados,
  em ordem de envio".

### 3. Status "Enviado"

- Badge de lead: `LEAD_STATUS_LABEL.COMPLETED` passa a ser "Enviado".
- Badge de campanha: `StatusBadge` ganha prop opcional `mode`; para
  `kind="campaign"`, `status === "COMPLETED"` e `mode === "DISPARO"` exibe
  "Enviado". Aplicado em `CampaignDetailPage`, `DisparosPage`,
  `DisparoSelectPage` e `FlowPage`.

### 4. Rota de tutorial

- Nova página `frontend/src/pages/TutorialPage.tsx`: guia passo a passo em
  pt-BR (conectar conta, criar disparo, selecionar contatos, acompanhar,
  fluxo/chatbot).
- Rota `/tutorial` e item no menu lateral (`Layout`).

## Testes

- Backend: teste unitário do `disconnectAccount`.
- Frontend: typecheck e build.
