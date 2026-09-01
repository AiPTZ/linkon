# LinkON — Produto

## Visão geral

O LinkON é uma plataforma web de automação de prospecção no LinkedIn. Ele conecta contas do LinkedIn
através da API da Unipile e executa campanhas de convite, varredura de rede, disparos e coleta de
contatos da rede, com ritmo controlado para parecer humano e reduzir risco de bloqueio da conta.

## Personas

- **Vendedor/BDM**: conecta a própria conta LinkedIn, cria campanhas de convite com mensagem
  personalizada, acompanha leads e respostas, extrai contatos de perfis.
- **Administrador (ADMIN)**: gerencia usuários (aprovar/bloquear/redefinir senha), configura a
  integração Unipile, acompanha a saúde do sistema (Redis, filas), desconecta contas e opera na base
  global de todos os usuários.

## Funcionalidades por área

### Autenticação e usuários

- Auto-cadastro público (`/registro`) — usuário nasce `PENDING` e precisa ser aprovado pelo admin.
- Criação de usuário pelo admin (aba Administração → Usuários) — usuário nasce `ACTIVE`.
- Login com JWT (expira em 7 dias) e rate limit por IP no endpoint de login.
- Papéis `USER` e `ADMIN`; usuário `BLOCKED` ou `PENDING` não consegue autenticar em rotas protegidas.
- Alteração de senha pelo próprio usuário e redefinição de senha pelo admin.

### Contas LinkedIn

- Conexão por **login nativo** (usuário/senha) com tratamento de **checkpoint/2FA** (código resolvido
  via `POST /api/auth/native/checkpoint`).
- Conexão por **auth hospedada** (fluxo `hosted` da Unipile) — fluxo recomendado para usuários comuns.
- Confirmação de conexão hospedada via `POST /api/accounts/confirm-hosted`.
- Status da conta (`CONNECTING`, `OK`, `CHECKPOINT`, `PENDING_LINKEDIN`, `REJECTED`, `DISCONNECTED`) e
  aprovação manual pelo admin para contas nativas em `PENDING_LINKEDIN`.
- Listagem de relações da conta (preview da rede) com limite configurável.

### Campanhas

Três modos, definidos em `mode`:

1. **SEARCH** — importa leads de uma URL de busca salva do LinkedIn e envia convites.
2. **SWEEP** — varre a rede de conexões/relações da conta e envia mensagens (sem convite).
3. **DISPARO** — envia mensagem ou fluxo para os leads marcados como `selected` na campanha.

Parâmetros de ritmo por campanha: limite diário (`dailyLimit`), limite semanal (`weeklyLimit`), atraso
aleatório (`minDelayMin`/`maxDelayMin`) e janela de horário comercial (`workStartHour`/`workEndHour`).
Quando o limite semanal é atingido, a campanha é pausada com status `LIMIT_HIT`.

### Fluxos de mensagens

- Editor visual de fluxo (`/campanhas/:id/fluxo`) com blocos de envio de mensagem, atraso, condição e
  parada (ver `BLOCK_TYPES` no backend).
- O fluxo é validado no salvamento; campanhas com fluxo são processadas pelo scheduler seguindo a
  sequência de blocos por lead.
- O avanço de etapa também é disparado por eventos de webhook (mensagem recebida, relação aceita).

### Chatbot por regras

- Por campanha: regras `contains`/`keywords`/`regex`, resposta padrão, palavras de parada e limite de
  respostas por lead (`maxRepliesPerLead`).
- Ativação via webhook `message_received`; a resposta é enfileirada com atraso aleatório.

### Banco de contatos

- A aba **Contatos** é um banco acumulativo da rede da conta LinkedIn conectada (dedup por
  `accountId+providerId`), populado ao conectar/ativar a conta e ao aceitar convites.
- Sincronização manual (botão "Sincronizar") e varredura de perfis em background (worker
  `linkon-contacts`, job `scrape`) capturando emails, telefones, links e distância de rede.
- Busca, filtros (com e-mail/telefone, raspados), detalhe do contato e exportação `.xlsx`.

### Notificações e logs

- Notificações em painel (por conta/campanha), com marcação de lida.
- Logs de eventos com paginação e filtro por campanha; logs globais no painel do admin.

## Regras de tenancy (multi-usuário)

- Um usuário `USER` enxerga e opera **apenas os próprios** registros (`userId` próprio).
- Um usuário `ADMIN`, por padrão, opera na **base global** (`userId = null`) — contas e campanhas que
  não pertencem a nenhum usuário.
- Com o header `X-Operate-As: <userId>`, o admin opera **como** aquele usuário (escopo restrito).
- O endpoint `GET /api/admin/global` retorna a contagem de campanhas e extrações globais.
- Usuário criado pelo admin nasce `ACTIVE`; usuário auto-cadastrado nasce `PENDING`.

## Contas demo

Ver tabela no [README](../README.md#contas-demo). Resumo:

| Usuário | Senha | Papel | Status |
| --- | --- | --- | --- |
| `arcanjo` | `29172510` | ADMIN | ACTIVE |
| `teste` | `123456` | USER | ACTIVE |
| `maria` | `maria123` | USER | ACTIVE |

## Estado das features

| Feature | Estado |
| --- | --- |
| Autenticação, papéis, tenancy | Implementado |
| Conexão nativa + checkpoint | Implementado |
| Conexão hospedada | Implementado |
| Campanhas SEARCH / SWEEP / DISPARO | Implementado |
| Fluxos visuais de mensagens | Implementado |
| Chatbot por regras | Implementado |
| Banco de contatos com exportação XLSX | Implementado |
| Notificações e logs | Implementado |
| Painel administrativo | Implementado |
| Rate limit no login | Implementado |

Não existe neste repo: integração de pagamento, multi-tenant com billing, app mobile nativo,
dashboard de analytics avançado.
