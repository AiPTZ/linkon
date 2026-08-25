# Design: Multi-usuário com painel de administração (controle total)

Data: 2026-08-25
Status: Aprovado

## Contexto

Hoje o sistema é single-tenant: existe apenas o admin `arcanjo` (modelo
`AdminUser`, seedado a partir de `ADMIN_USERNAME`/`ADMIN_PASSWORD`) e todos os
dados (`Account`, `Campaign`, `Extraction`) são globais, sem dono. O requisito é
transformar a plataforma em multi-usuário, com:

- Admin (arcanjo) com controle total de todos os usuários e operações deles.
- Auto-cadastro de usuários com aprovação manual do admin.
- Botão "pedir acesso" no login apontando para o WhatsApp do admin.
- Apenas o admin configura a parte da Unipile; usuário conecta o próprio
  LinkedIn pela tela dele, com a conta pendente de aprovação do admin.
- Cada usuário conecta no máximo 1 conta LinkedIn.

## Modelo de dados

### Novo modelo `User` (substitui `AdminUser`)

```
model User {
  id           String    @id @default(cuid())
  name         String
  username     String    @unique
  passwordHash String
  whatsapp     String?
  role         UserRole  @default(USER)      // ADMIN | USER
  status       UserStatus @default(PENDING)  // PENDING | ACTIVE | BLOCKED
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  accounts     Account[]
  campaigns    Campaign[]
  extractions  Extraction[]
}

enum UserRole   { ADMIN USER }
enum UserStatus { PENDING ACTIVE BLOCKED }
```

- `AdminUser` é removido; o admin `arcanjo` é seedado em `User` com
  `role=ADMIN` e `status=ACTIVE` a partir de `ADMIN_USERNAME`/`ADMIN_PASSWORD`.
- O seed é idempotente: upsert por `username`.

### Ownership nas entidades existentes

`Account`, `Campaign` e `Extraction` ganham `userId String?` com FK para
`User` (`onDelete: SetNull`):

- Dados de usuário normal: `userId` sempre preenchido.
- Base global legada (dados atuais sem dono): `userId = NULL`, visível apenas
  para o admin.
- `Lead` e `ExtractedLead` continuam atrelados a `Campaign`/`Extraction`
  (herdam o escopo pelo pai), sem novo campo.

### Regra de negócio: 1 conta LinkedIn por usuário

- Validação no backend: antes de criar/atribuir uma conta a um usuário, se ele
  já possui uma conta, rejeita com erro ("O usuário já possui uma conta
  LinkedIn"). Se o usuário já tiver conta pendente, o botão "Conectar" some.
- Não há índice único parcial no SQLite; a validação é feita na aplicação.

## Autenticação e cadastro

### Login (`POST /api/auth/login`)

- Busca primeiro em `User` com `role=ADMIN` (arcanjo) e depois nos demais.
- JWT passa a ter payload `{ sub, username, role, status }`, assinado com
  `AUTH_SECRET`, expiração 7d (mantém).
- Regras por status:
  - `BLOQUEADO` → `401` "Acesso bloqueado. Fale com o administrador."
  - `PENDENTE` → `401` "Aguardando aprovação do administrador."
- Admin e usuários usam a mesma tela de login.

### Auto-cadastro (`POST /api/auth/register`)

- Body: `{ name, username, password, whatsapp? }` (zod).
- Valida: `username` único (409 se existir), senha mínima 6.
- Cria `User` com `role=USER`, `status=PENDING`, senha bcrypt.
- Resposta: `201` com mensagem "conta criada, aguardando aprovação".

### "Pedir acesso"

- Botão/link na tela de login → `https://wa.me/<WHATSAPP_SUPPORT>`.
- `WHATSAPP_SUPPORT` nova env (padrão `5519990041826`).

### Autorização

- `requireAuth`: qualquer usuário autenticado (valida JWT; se `status` não for
  `ACTIVE`, rejeita — proteção extra além do login).
- `requireAdmin`: exige `role === "ADMIN"`. Aplica nas rotas de administração
  (usuários, contas do painel, base global).
- Rotas de dados (accounts, campaigns, extractions) escopam pelo
  `userId` resolvido.

## Escopo de acesso

Helper central no backend: `resolveScope(req)`.

- Token de `USER` → `{ userId }` fixo no dono.
- Token de `ADMIN`:
  - Sem contexto → base global (`userId = NULL`) no painel admin.
  - Com contexto (`?as=<userId>` ou header) → opera os dados daquele usuário
    ("operar como usuário").
- Todas as rotas de dados usam esse escopo para listar/criar/editar/excluir.

### Rotas admin (novas)

- `GET /api/admin/users` — lista usuários com contadores
  (`_count`: accounts, campaigns, extractions).
- `POST /api/admin/users/:id/approve` — aprova (PENDING → ACTIVE).
- `POST /api/admin/users/:id/block` — bloqueia (ACTIVE → BLOCKED); pausa
  campanhas ativas do usuário; dados intactos.
- `POST /api/admin/users/:id/unblock` — desbloqueia (BLOCKED → ACTIVE).
- `GET /api/admin/accounts` — todas as contas de todos os usuários + base
  global, com dono.
- `POST /api/admin/accounts/:id/approve` — aprova conta LinkedIn pendente.
- `POST /api/admin/accounts/:id/reject` — rejeita conta pendente (marca
  `REJECTED`; mantém dados).
- `POST /api/admin/accounts/:id/disconnect` — desconecta conta de qualquer
  usuário.
- `GET /api/admin/global` — campanhas/extrações da base global (somente
  consulta).
- `POST /api/admin/users/:id/reset-password` — admin define nova senha.

### Contas LinkedIn (fluxo do usuário)

- `POST /api/accounts/connect` (usuário): inicia fluxo hosted Unipile (mesmo de
  hoje); ao callback, a conta é criada com status `PENDING_LINKEDIN` (novo
  status local) atrelada ao `userId`.
- `GET /api/accounts` (usuário): retorna apenas as contas do próprio usuário.
- Admin aprova/rejeita via `/api/admin/accounts/...`. Ao aprovar, status vira
  `OK` e a conta passa a ser utilizável.
- O usuário só vê a própria conta (ou nenhuma); se tiver conta pendente, o
  botão "Conectar" fica oculto.

> Observação: para não quebrar o fluxo Unipile hosted existente, o callback de
> conexão continua o mesmo; a mudança é apenas o status inicial e o vínculo
> `userId`. O status local `PENDING_LINKEDIN` é exibido ao admin e ao usuário
> como "Aguardando aprovação". Enquanto `PENDING_LINKEDIN`, a conta não pode ser
> usada em campanhas/extrações.

## Bloqueio de usuário

- `block` seta `status=BLOCKED` e pausa campanhas `RUNNING`/`IMPORTING` do
  usuário (registra `CAMPAIGN_PAUSED`), igual ao mecanismo de pausa existente.
- Login negado; dados preservados integralmente (sem exclusão em cascata).
- Não existe operação de exclusão de dados de usuário.

## Frontend

### Login (`/login`)

- Campos usuário/senha; botão **"Pedir acesso"** → `wa.me/<WHATSAPP_SUPPORT>`
  (nova env no frontend ou valor fixo alinhado com o backend).
- Link "Criar conta" → `/registro`.

### Registro (`/registro`)

- Nome, usuário, senha, WhatsApp.
- Validações: usuário único, senha mínima 6.
- Sucesso → mensagem "conta criada, aguardando aprovação" + link pro login.

### Layout / menu por role

- **Usuário comum**: Disparos, Extração, Conta LinkedIn (só a dele, com
  "Conectar LinkedIn" ou status), Configurações (trocar senha), sair.
- **Admin**: tudo acima + **Administração** no menu. No painel, seletor
  "operar como: [usuário]" com banner "operando como [usuário] — voltar ao
  painel".

### Páginas admin

1. **Usuários**: tabela (nome, usuário, WhatsApp, status, contadores,
   criado em) + ações aprovar/bloquear/desbloquear/redefinir senha.
2. **Contas LinkedIn**: todas as contas com dono e status; aprovar/rejeitar
   pendente; desconectar.
3. **Base global**: campanhas/extrações legadas (somente leitura).

### Tipos e contextos

- `types.ts`: `User`, `UserRole`, `UserStatus`, `AccountStatus` ganha
  `PENDING_LINKEDIN`/`REJECTED`; `Account` ganha `owner`/`user`.
- `lib/auth.tsx`: guarda `{ id, username, name, role, status }`; guarda de rota
  admin checa `role === "ADMIN"`.

## Testes

- Backend (vitest):
  - `admin.service`: register/login por status (PENDING/BLOCKED), aprovar,
    bloquear (pausa campanhas), escopo resolveScope (USER/ADMIN/base global).
  - `accounts`: 1 conta por usuário; aprovação/rejeição.
- Frontend: typecheck e build.

## Env novas

- Backend: `WHATSAPP_SUPPORT` (padrão `5519990041826`).
- (Opcional, alinhado) Frontend expõe o mesmo número para o link do login.
