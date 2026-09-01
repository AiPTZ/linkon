# LinkON

Plataforma de automação de prospecção no LinkedIn via [Unipile](https://developer.unipile.com).

O LinkON envia convites personalizados com comportamento humano (atrasos aleatórios, limites diários e
semanais, janela de horário comercial), responde automaticamente a mensagens com um chatbot por regras
ou fluxos visuais, varre redes de contatos (sweep), faz disparos em massa para uma seleção de leads e
extrai dados de perfis com exportação para planilha.

## Recursos

- Autenticação por usuário (JWT) com papéis **USER** e **ADMIN** e escopo de dados por usuário.
- Conexão de contas LinkedIn via **login nativo** (com suporte a checkpoints/2FA) ou **auth hospedada**.
- Campanhas em 3 modos: **SEARCH** (busca salva do LinkedIn), **SWEEP** (varredura da rede) e **DISPARO** (envio para leads selecionados).
- Fluxos de mensagens visuais (editor de fluxo com blocos) e **chatbot por regras** com resposta automática.
- Extração de dados de perfis (emails, telefones, links) com exportação `.xlsx`.
- Painel de administração: saúde do sistema, filas, contas, usuários (aprovar/bloquear/redefinir senha).
- Agente de IA por conta (limites, delay, transferência) com bot ligável/desligável por campanha.
- Rate limits por IP real, CORS restrito, headers de segurança e webhooks assinados com comparação
  timing-safe.

## Stack

| Camada | Tecnologia |
| --- | --- |
| Frontend | React 18 + Vite + TailwindCSS |
| Backend | Node.js + Express + TypeScript |
| Filas | BullMQ + Redis |
| Banco | SQLite via Prisma (`DATABASE_URL` trocável para Postgres) |
| Integração | Unipile API (native auth, hosted auth, webhooks) |

## Pré-requisitos

- Node.js 20+
- Redis (`redis-server`)
- Conta na [Unipile](https://developer.unipile.com)
- Conta LinkedIn (Sales Navigator recomendado para buscas salvas)

## Como rodar

```bash
# Instalar dependências (monorepo com workspaces npm)
npm install

# Criar o .env do backend a partir do exemplo (preencha os valores reais)
cp backend/.env.example backend/.env

# Criar o .env do frontend (opcional, para o WhatsApp de suporte)
cp frontend/.env.example frontend/.env

# Criar o esquema do banco
npm run db:push

# Iniciar Redis
redis-server --daemonize yes

# Subir API + workers + frontend
./start.sh
```

- Frontend: http://localhost:5173
- API: http://localhost:3001
- Health: http://localhost:3001/api/health

O `start.sh` sobe a API, os workers de convites, chatbot, busca e varredura, e o frontend. O worker de
contatos é iniciado separadamente:

```bash
npm run dev:contacts-worker -w @linkon/backend
```

### Configuração inicial

1. O usuário administrador é criado automaticamente no primeiro boot a partir de `ADMIN_USERNAME` e
   `ADMIN_PASSWORD` no `backend/.env` (senha armazenada como hash bcrypt).
2. Abra **Configurações** no painel e informe o **DSN** e o **Access Token** da sua instância Unipile
   (também podem vir de `UNIPILE_DSN` e `UNIPILE_ACCESS_TOKEN` no `.env`).
3. Em **Contas LinkedIn**, conecte uma conta pelo *assistente* (recomendado) ou por *login nativo*.
4. Defina a **URL pública do webhook** (`WEBHOOK_PUBLIC_URL`) e registre os webhooks em Configurações.
5. Em **Campanhas**, cole a URL de uma busca salva do LinkedIn, configure limites e inicie.

## Contas demo

A base de dados de preview inclui estas contas:

| Usuário | Senha | Papel | Status |
| --- | --- | --- | --- |
| `arcanjo` | `29172510` | ADMIN | ACTIVE |
| `teste` | `123456` | USER | ACTIVE |
| `maria` | `maria123` | USER | ACTIVE |

Em uma instalação nova, apenas o administrador é criado (a partir do `.env`). Os demais usuários são
criados via auto-cadastro (`/registro`, nasce `PENDING` e precisa de aprovação do admin) ou pelo admin
na aba **Administração → Usuários** (nasce `ACTIVE`).

## Autenticação e isolamento

- Toda rota sob `/api` (exceto `/health`, `/webhooks` e `/auth` públicas) exige `Authorization: Bearer <jwt>`.
- O JWT expira em 7 dias e carrega `{ sub, username, role, status }`. Usuário com status diferente de
  `ACTIVE` recebe `401` em todas as rotas autenticadas.
- Cada usuário enxerga apenas os próprios dados (contas, campanhas, extrações). O admin pode operar na
  base global enviando o header `X-Operate-As: <userId>`, ou acessar as rotas de `/admin` para tudo.
- **Senhas nunca voltam pela API**: nenhuma rota devolve `passwordHash` ou credencial de conta.

## Segurança

- Nenhum segredo real deve ser commitado. O `.gitignore` ignora `.env*` (exceto `.env.example`), o banco
  SQLite local, o `dump.rdb` do Redis, `*.zip`, build artifacts e o diretório de planos locais.
- Os `.env.example` contêm apenas placeholders. Gere valores fortes para `AUTH_SECRET`,
  `CREDENTIALS_ENCRYPTION_KEY` e `UNIPILE_WEBHOOK_SECRET` (mínimos validados: 16, 16 e 8 caracteres).
- **Rate limits por IP real** (atrás de proxy/Cloudflare, via `TRUST_PROXY` + `CF-Connecting-IP`):
  login (10/min), registro (5/15min), API autenticada (600/min) e webhooks (600/min) — configuráveis
  por `RATE_LIMIT_*` no `.env`; respondem `429` com `Retry-After`.
- **CORS** restrito a `CORS_ORIGINS` em `NODE_ENV=production` (em dev reflete a origem).
- **Headers de segurança** (`X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`,
  `Permissions-Policy`, HSTS atrás de HTTPS).
- Webhooks da Unipile são validados por segredo compartilhado (`UNIPILE_WEBHOOK_SECRET` nos headers
  `unipile-auth` ou `authorization`) com comparação **timing-safe**.
- Credenciais de contas são criptografadas em repouso (AES-256-GCM com tag GCM de 16 bytes explícita).
- Dependências mantidas atualizadas por `overrides` no root (`brace-expansion@5.0.9`, `uuid@14.0.2`),
  e `react-router-dom@7.x` no frontend — tratamento completo do relatório GitGuard em
  [docs/SECURITY.md](./docs/SECURITY.md).

> Detalhes de deploy, Cloudflare e operação: [docs/HANDOFF.md](./docs/HANDOFF.md).

## Aviso

O uso excessivo de automação pode violar os Termos de Serviço do LinkedIn. Use com moderação,
respeitando os limites da sua conta e as normas da plataforma.

## Documentação

Índice completo em [docs/README.md](./docs/README.md):

- [PRODUCT.md](./docs/PRODUCT.md) — o produto e seus papéis.
- [ARCHITECTURE.md](./docs/ARCHITECTURE.md) — arquitetura e fluxos de dados.
- [API.md](./docs/API.md) — referência da API REST.
- [INTEGRATION.md](./docs/INTEGRATION.md) — integrações externas.
- [IMPLEMENTATION.md](./docs/IMPLEMENTATION.md) — estado da implementação e testes.
