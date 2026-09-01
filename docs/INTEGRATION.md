# LinkON — Integrações

## Unipile

O LinkON usa a [API da Unipile](https://developer.unipile.com) para toda a interação com o LinkedIn:
autenticação de contas (native e hosted), envio de convites/mensagens, busca de perfis, varredura de
relações e webhooks de eventos.

### Configuração

A configuração pode vir de duas fontes (a configuração gravada no painel tem precedência sobre o `.env`
em operações que usam `configService`):

1. Variáveis de ambiente (`backend/.env`):
   - `UNIPILE_DSN` — DSN (endereço) da instância Unipile.
   - `UNIPILE_ACCESS_TOKEN` — token de acesso da instância.
   - `UNIPILE_WEBHOOK_SECRET` — segredo compartilhado para validar webhooks (mínimo 8 caracteres).
   - `WEBHOOK_PUBLIC_URL` — URL pública do backend para registro de webhooks.
2. Painel (**Configurações → PUT /api/config**): `unipileDsn`, `unipileAccessToken`,
   `webhookPublicUrl` — gravados na tabela `AppConfig`.

O `GET /api/config` expõe apenas *se* estão configurados (`unipileDsnConfigured`, etc.), nunca o valor.

### Autenticação de contas LinkedIn

- **Login nativo** (`POST /api/auth/native`, admin): envia usuário/senha para a Unipile. Em caso de
  checkpoint/2FA, retorna `202` e o código é resolvido em `POST /api/auth/native/checkpoint`.
- **Auth hospedada** (`POST /api/auth/hosted`): gera uma URL da Unipile; após o fluxo, o usuário
  confirma em `POST /api/accounts/confirm-hosted`.
- `GET /api/accounts` sincroniza as contas com a Unipile (`syncAccounts`); se a Unipile não estiver
  configurada, retorna as contas locais.

### Webhooks

- Registro: `POST /api/auth/webhooks` (admin) usa `WEBHOOK_PUBLIC_URL` para registrar a rota
  `/api/webhooks/unipile` na Unipile.
- Assinatura: cada requisição deve enviar o header `unipile-auth` (ou `authorization`) igual a
  `UNIPILE_WEBHOOK_SECRET`; caso contrário `401`.
- Eventos: `message_received` (atualiza lead, avança fluxo, dispara chatbot) e `new_relation`
  (marca lead `ACCEPTED`).
- Registros de webhooks são persistidos em `WebhookRegistration` e listados em `GET /api/config`.

## Redis

- Usado pelo BullMQ (filas) e pelo ioredis (`lib/redis.ts`).
- Configuração: `REDIS_URL` (padrão `redis://localhost:6379`).
- Filas: `linkon-invites`, `linkon-chatbot`, `linkon-search`, `linkon-sweep`, `linkon-contacts`.
- O dump local do Redis (`dump.rdb`) é ignorado pelo `.gitignore`.

## WhatsApp de suporte

O link "falar com suporte" da tela de login usa `VITE_WHATSAPP_SUPPORT` (frontend, com fallback para
`5519990041826`) para montar `https://wa.me/<numero>`. O backend também expõe `WHATSAPP_SUPPORT`.

## Autenticação de workers, cron e consumidores externos

- **Workers** e o **scheduler** rodam como processos internos (BullMQ + node-cron) e não expõem
  endpoints HTTP. Não há rota pública que dispare jobs.
- Qualquer consumidor **externo** que acesse a API deve autenticar com `Authorization: Bearer <jwt>`
  (rotas protegidas) — incluindo integrações que disparem ações em campanhas.
- O único ponto de entrada externo sem JWT é o webhook da Unipile, protegido por
  `UNIPILE_WEBHOOK_SECRET`.
- Por isso, não existe "chave de API" separada para workers: o acesso é por JWT de usuário ou pelo
  segredo do webhook.

## O que NÃO existe neste repo

- Integração de pagamento / assinatura (Stripe, etc.).
- Envio de e-mail / SMTP transacional.
- Notificações push (FCM/APNs) ou outros canais além das notificações internas do painel.
- Integração com outras redes sociais ou provedores além de LinkedIn via Unipile.
- SSO / OAuth de terceiros para login no painel (login é por usuário/senha local).
- API pública externa (a API `/api` é interna, protegida por JWT).
