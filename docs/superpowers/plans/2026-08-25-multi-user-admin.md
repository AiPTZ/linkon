# Multi-usuário com painel de administração — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o Link ON em plataforma multi-usuário com auto-cadastro pendente de aprovação, admin (arcanjo) com controle total, e restrições de Unipile/contas por usuário.

**Architecture:** Modelo `User` unificado (substitui `AdminUser`) com `role` ADMIN/USER e `status` PENDING/ACTIVE/BLOCKED. `Account`, `Campaign` e `Extraction` ganham `userId` nullable (base global = NULL, visível só ao admin). Toda rota de dados resolve um escopo (`resolveScope`) a partir do JWT + header `X-Operate-As` (admin "operando como"). Conexão LinkedIn: usuário usa o fluxo hosted Unipile; conta nasce `PENDING_LINKEDIN` e só vira `OK` após aprovação do admin.

**Tech Stack:** Express + TS + Prisma (SQLite) + BullMQ/Redis + Vitest (backend); React + Vite + Tailwind (frontend).

## Global Constraints

- Verificação backend: `npm run test` (99 testes hoje) e `npm run typecheck` em `/workspace/backend`.
- Verificação frontend: `npm run typecheck` e `npm run build` em `/workspace/frontend`.
- UI em pt-BR; design preto/cinza/dourado; fonte serifada; sem emojis.
- Proibido `rm` e `git add -A`; commitar sempre arquivos específicos.
- SQLite + Prisma **não suporta `enum`** — `role`, `status` etc. são `String` com valores fixos.
- Admin = `arcanjo` (env `ADMIN_USERNAME`/`ADMIN_PASSWORD`), seedado com `role=ADMIN`, `status=ACTIVE`.
- WhatsApp do admin: `5519990041826` (nova env `WHATSAPP_SUPPORT` no backend; `VITE_WHATSAPP_SUPPORT` no frontend).
- Migração de schema via `npx prisma db push` (projeto não usa migrations) + `npx prisma generate`.
- Conta recém-conectada entra `PENDING_LINKEDIN`; usuário normal só tem 1 conta; bloquear usuário = negar login + pausar campanhas ativas; **nunca excluir dados**.
- Repo anômalo: a maior parte do código é untracked; usar `git add <arquivo específico>` sempre.

---

### Task 1: Schema Prisma + seed do admin

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/src/services/admin.service.ts` (seed)
- Modify: `backend/src/config/env.ts`
- Modify: `backend/.env` e `backend/.env.example` (novo `WHATSAPP_SUPPORT`)
- Modify: `frontend/.env` (novo `VITE_WHATSAPP_SUPPORT`)

**Interfaces:**
- Produces: `prisma.user` (model `User`), `Account.userId`, `Campaign.userId`, `Extraction.userId`, sem `prisma.adminUser`.

- [ ] **Step 1: Atualizar o schema**

Substituir o bloco `AdminUser` e adicionar `User` em `backend/prisma/schema.prisma`:

```prisma
model User {
  id           String     @id @default(cuid())
  name         String
  username     String     @unique
  passwordHash String
  whatsapp     String?
  role         String     @default("USER")
  status       String     @default("PENDING")
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
  accounts     Account[]
  campaigns    Campaign[]
  extractions  Extraction[]
}
```

Remover o modelo `AdminUser` (linhas 16-22). Em `Account`, `Campaign` e `Extraction`, adicionar:

```prisma
model Account {
  // ... campos existentes ...
  userId   String?
  user     User?     @relation(fields: [userId], references: [id], onDelete: SetNull)
  campaigns        Campaign[]
  logs             LogEvent[]
  extractions      Extraction[]
}

model Campaign {
  // ... campos existentes ...
  userId   String?
  user     User?     @relation(fields: [userId], references: [id], onDelete: SetNull)
  leads     Lead[]
  logs      LogEvent[]
}

model Extraction {
  // ... campos existentes ...
  userId   String?
  user     User?     @relation(fields: [userId], references: [id], onDelete: SetNull)
  leads    ExtractedLead[]
}
```

- [ ] **Step 2: Aplicar schema + gerar client**

```bash
cd /workspace/backend && npx prisma db push && npx prisma generate
```
Expected: tabela `User` criada; colunas `userId` adicionadas; tabela `AdminUser` removida. Nenhum dado das demais tabelas é perdido.

- [ ] **Step 3: Seed do admin em `User`**

Em `backend/src/services/admin.service.ts`, substituir o corpo de `ensureAdminSeeded` (linhas 12-20) para usar `prisma.user`:

```ts
export async function ensureAdminSeeded(): Promise<void> {
  const username = env.ADMIN_USERNAME;
  const passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, 12);
  await prisma.user.upsert({
    where: { username },
    update: { passwordHash },
    create: { username, name: "Administrador", passwordHash, role: "ADMIN", status: "ACTIVE" },
  });
}
```

- [ ] **Step 4: Nova env `WHATSAPP_SUPPORT`**

Em `backend/src/config/env.ts`, adicionar ao `envSchema` (após `ADMIN_PASSWORD`):

```ts
WHATSAPP_SUPPORT: z.string().min(8).default("5519990041826"),
```

Adicionar `WHATSAPP_SUPPORT=5519990041826` em `backend/.env` e `backend/.env.example`. Criar `frontend/.env` com `VITE_WHATSAPP_SUPPORT=5519990041826`.

- [ ] **Step 5: Verificar typecheck**

```bash
cd /workspace/backend && npm run typecheck
```
Expected: OK (o restante do código que usa `prisma.adminUser` ainda será corrigido na Task 2 — se houver erro aqui, é aceitável apenas nos pontos de `loginAdmin`/`verifyToken`).

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/src/services/admin.service.ts backend/src/config/env.ts backend/.env backend/.env.example frontend/.env
git commit -m "feat: modelo User multi-usuário e seed do admin"
```

---

### Task 2: AuthService — login por status, register, JWT com role

**Files:**
- Create: `backend/src/services/user.service.ts`
- Delete content / replace: `backend/src/services/admin.service.ts` (re-export ou remover; preferir `git mv` depois de copiar o conteúdo)
- Modify: `backend/src/middleware/auth.ts`
- Modify: `backend/src/routes/auth.routes.ts`
- Modify: `backend/src/index.ts` (import do seed)
- Test: `backend/src/services/user.service.test.ts`

**Interfaces:**
- Produces:
  - `interface AuthPayload { sub: string; username: string; role: string; status: string }`
  - `loginUser(username, password): Promise<{ token, user: PublicUser }>` onde `PublicUser = { id, username, name, role, status }`
  - `registerUser({ name, username, password, whatsapp }): Promise<PublicUser>`
  - `changePassword(userId, currentPassword, newPassword): Promise<void>`
  - `verifyToken(token): AuthPayload`
  - `getUserById(id): Promise<PublicUser | null>`
  - `ensureAdminSeeded()` (movido de admin.service)

- [ ] **Step 1: Escrever o teste falhando**

Criar `backend/src/services/user.service.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    campaign: { updateMany: vi.fn() },
  },
}));

import { prisma } from "../lib/prisma";
import { loginUser, registerUser, changePassword, approveUser, blockUser } from "./user.service";
import { ApiError } from "../utils/errors";

const userFind = prisma.user.findUnique as ReturnType<typeof vi.fn>;
const userCreate = prisma.user.create as ReturnType<typeof vi.fn>;
const userUpdate = prisma.user.update as ReturnType<typeof vi.fn>;
const campaignUpdateMany = prisma.campaign.updateMany as ReturnType<typeof vi.fn>;

const baseUser = { id: "U1", name: "Fulano", username: "fulano", passwordHash: "$2a$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", whatsapp: "5511999999999", role: "USER", status: "ACTIVE", createdAt: new Date(), updatedAt: new Date() };

describe("loginUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejeita usuário PENDING", async () => {
    userFind.mockResolvedValue({ ...baseUser, status: "PENDING" });
    await expect(loginUser("fulano", "qualquer")).rejects.toThrow("Aguardando aprovação");
  });

  it("rejeita usuário BLOCKED", async () => {
    userFind.mockResolvedValue({ ...baseUser, status: "BLOCKED" });
    await expect(loginUser("fulano", "qualquer")).rejects.toThrow("Acesso bloqueado");
  });

  it("retorna token com role/status para usuário ATIVO", async () => {
    userFind.mockResolvedValue(baseUser);
    const res = await loginUser("fulano", "senha123");
    expect(res.user.role).toBe("USER");
    expect(res.user.status).toBe("ACTIVE");
    expect(res.token.length).toBeGreaterThan(20);
  });
});

describe("registerUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cria usuário PENDING", async () => {
    userFind.mockResolvedValue(null);
    userCreate.mockResolvedValue({ ...baseUser, status: "PENDING" });
    const u = await registerUser({ name: "Fulano", username: "fulano", password: "senha123", whatsapp: "5511999999999" });
    expect(u.status).toBe("PENDING");
    expect(userCreate.mock.calls[0][0].data.role).toBe("USER");
  });

  it("rejeita username duplicado", async () => {
    userFind.mockResolvedValue(baseUser);
    await expect(registerUser({ name: "F", username: "fulano", password: "senha123" })).rejects.toThrow(ApiError);
  });
});

describe("blockUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("bloqueia e pausa campanhas ativas", async () => {
    userFind.mockResolvedValue(baseUser);
    userUpdate.mockResolvedValue({ ...baseUser, status: "BLOCKED" });
    await blockUser("U1");
    const arg = campaignUpdateMany.mock.calls[0][0] as { where: { userId: string; status: { in: string[] } }; data: { status: string } };
    expect(arg.where.userId).toBe("U1");
    expect(arg.where.status.in).toEqual(["RUNNING", "IMPORTING"]);
    expect(arg.data.status).toBe("PAUSED");
  });
});
```

- [ ] **Step 2: Rodar e verificar falha**

```bash
cd /workspace/backend && npx vitest run src/services/user.service.test.ts
```
Expected: FAIL — módulo `./user.service` não existe.

- [ ] **Step 3: Implementar `user.service.ts`**

Criar `backend/src/services/user.service.ts`:

```ts
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { ApiError } from "../utils/errors";

export interface AuthPayload {
  sub: string;
  username: string;
  role: string;
  status: string;
}

export interface PublicUser {
  id: string;
  username: string;
  name: string;
  role: string;
  status: string;
}

export async function ensureAdminSeeded(): Promise<void> {
  const username = env.ADMIN_USERNAME;
  const passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, 12);
  await prisma.user.upsert({
    where: { username },
    update: { passwordHash },
    create: { username, name: "Administrador", passwordHash, role: "ADMIN", status: "ACTIVE" },
  });
}

function toPublic(u: { id: string; username: string; name: string; role: string; status: string }): PublicUser {
  return { id: u.id, username: u.username, name: u.name, role: u.role, status: u.status };
}

export async function loginUser(
  username: string,
  password: string,
): Promise<{ token: string; user: PublicUser }> {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) throw new ApiError(401, "Credenciais inválidas");

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new ApiError(401, "Credenciais inválidas");

  if (user.status === "PENDING") throw new ApiError(401, "Aguardando aprovação do administrador.");
  if (user.status === "BLOCKED") throw new ApiError(401, "Acesso bloqueado. Fale com o administrador.");

  const payload: AuthPayload = { sub: user.id, username: user.username, role: user.role, status: user.status };
  const token = jwt.sign(payload, env.AUTH_SECRET, { expiresIn: "7d" });
  return { token, user: toPublic(user) };
}

export async function registerUser(input: {
  name: string;
  username: string;
  password: string;
  whatsapp?: string;
}): Promise<PublicUser> {
  const existing = await prisma.user.findUnique({ where: { username: input.username } });
  if (existing) throw new ApiError(409, "Este usuário já está cadastrado.");
  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await prisma.user.create({
    data: {
      name: input.name,
      username: input.username,
      passwordHash,
      whatsapp: input.whatsapp || null,
      role: "USER",
      status: "PENDING",
    },
  });
  return toPublic(user);
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(404, "Usuário não encontrado");
  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) throw new ApiError(400, "Senha atual incorreta");
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
}

export async function getUserById(id: string): Promise<PublicUser | null> {
  const u = await prisma.user.findUnique({ where: { id } });
  return u ? toPublic(u) : null;
}

export function verifyToken(token: string): AuthPayload {
  return jwt.verify(token, env.AUTH_SECRET) as AuthPayload;
}

export async function listUsers(): Promise<(PublicUser & { whatsapp: string | null; status: string; createdAt: Date; _count: { accounts: number; campaigns: number; extractions: number } })[]> {
  return prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { accounts: true, campaigns: true, extractions: true } } },
  });
}

export async function approveUser(id: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new ApiError(404, "Usuário não encontrado");
  await prisma.user.update({ where: { id }, data: { status: "ACTIVE" } });
}

export async function blockUser(id: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new ApiError(404, "Usuário não encontrado");
  await prisma.user.update({ where: { id }, data: { status: "BLOCKED" } });
  await prisma.campaign.updateMany({
    where: { userId: id, status: { in: ["RUNNING", "IMPORTING"] } },
    data: { status: "PAUSED" },
  });
}

export async function unblockUser(id: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new ApiError(404, "Usuário não encontrado");
  await prisma.user.update({ where: { id }, data: { status: "ACTIVE" } });
}

export async function resetUserPassword(id: string, newPassword: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new ApiError(404, "Usuário não encontrado");
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id }, data: { passwordHash } });
}
```

- [ ] **Step 4: Rodar o teste até passar**

```bash
cd /workspace/backend && npx vitest run src/services/user.service.test.ts
```
Expected: PASS (2 describe blocks). Se `bcrypt.hash` com mock de `prisma` estiver OK, tudo passa.

- [ ] **Step 5: Trocar `admin.service.ts` por `user.service.ts`**

```bash
cd /workspace/backend && git mv src/services/admin.service.ts src/services/user.service.ts 2>/dev/null || mv src/services/admin.service.ts src/services/user.service.ts
```
(Se o `git mv` falhar por o arquivo estar untracked, usar `mv` e depois `git add` do novo caminho.)

Ajustar `backend/src/middleware/auth.ts`:

```ts
import type { NextFunction, Request, Response } from "express";
import { verifyToken, type AuthPayload } from "../services/user.service";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }
  try {
    const payload = verifyToken(token);
    if (payload.status !== "ACTIVE") {
      res.status(401).json({ error: "Acesso bloqueado. Fale com o administrador." });
      return;
    }
    (req as Request & { user: AuthPayload }).user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Sessão expirada ou inválida" });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = (req as Request & { user: AuthPayload }).user;
  if (user?.role !== "ADMIN") {
    res.status(403).json({ error: "Acesso restrito ao administrador" });
    return;
  }
  next();
}
```

- [ ] **Step 6: Atualizar imports em `index.ts` e remover referências antigas**

`backend/src/index.ts` linha 8: trocar `import { ensureAdminSeeded } from "./services/admin.service";` por `import { ensureAdminSeeded } from "./services/user.service";`.

- [ ] **Step 7: Verificar typecheck + suite completa**

```bash
cd /workspace/backend && npm run typecheck && npm run test 2>&1 | tail -8
```
Expected: typecheck OK; testes OK (99 originais + novos de user.service).

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/user.service.ts backend/src/middleware/auth.ts backend/src/index.ts backend/src/services/user.service.test.ts
git commit -m "feat: authService multi-usuário com JWT por role e status"
```

---

### Task 3: Escopo de acesso + rotas admin de usuários

**Files:**
- Create: `backend/src/utils/scope.ts`
- Modify: `backend/src/routes/admin.routes.ts`
- Test: `backend/src/utils/scope.test.ts`

**Interfaces:**
- Consumes: `verifyToken`/`AuthPayload` (Task 2), `listUsers/approveUser/blockUser/unblockUser/resetUserPassword` (Task 2).
- Produces:
  - `currentUser(req): AuthPayload`
  - `resolveScope(req): { userId: string | null }`
  - `assertAccountInScope(account: { userId: string | null } | null, scopeUserId: string | null): void`

- [ ] **Step 1: Escrever teste falhando**

Criar `backend/src/utils/scope.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveScope, assertAccountInScope } from "./scope";
import { ApiError } from "./errors";

function req(role: string, operateAs?: string) {
  const headers: Record<string, string> = {};
  if (operateAs) headers["x-operate-as"] = operateAs;
  return { user: { sub: "U1", username: "x", role, status: "ACTIVE" }, headers } as unknown as Parameters<typeof resolveScope>[0];
}

describe("resolveScope", () => {
  it("usuário comum resolve para o próprio id", () => {
    expect(resolveScope(req("USER"))).toEqual({ userId: "U1" });
  });
  it("admin sem contexto resolve para null (base global)", () => {
    expect(resolveScope(req("ADMIN"))).toEqual({ userId: null });
  });
  it("admin com X-Operate-As resolve para o usuário alvo", () => {
    expect(resolveScope(req("ADMIN", "U2"))).toEqual({ userId: "U2" });
  });
});

describe("assertAccountInScope", () => {
  it("permite conta do usuário no escopo do usuário", () => {
    expect(() => assertAccountInScope({ userId: "U1" }, "U1")).not.toThrow();
  });
  it("bloqueia conta de outro usuário", () => {
    expect(() => assertAccountInScope({ userId: "U2" }, "U1")).toThrow(ApiError);
  });
  it("bloqueia conta global para usuário comum", () => {
    expect(() => assertAccountInScope({ userId: null }, "U1")).toThrow(ApiError);
  });
  it("admin global pode usar contas globais", () => {
    expect(() => assertAccountInScope({ userId: null }, null)).not.toThrow();
  });
});
```

- [ ] **Step 2: Rodar e verificar falha**

```bash
cd /workspace/backend && npx vitest run src/utils/scope.test.ts
```
Expected: FAIL — módulo `./scope` não existe.

- [ ] **Step 3: Implementar `scope.ts`**

Criar `backend/src/utils/scope.ts`:

```ts
import type { Request } from "express";
import type { AuthPayload } from "../services/user.service";
import { ApiError } from "./errors";

export function currentUser(req: Request): AuthPayload {
  return (req as Request & { user: AuthPayload }).user;
}

export function resolveScope(req: Request): { userId: string | null } {
  const user = currentUser(req);
  if (user.role === "ADMIN") {
    const as = req.headers["x-operate-as"];
    return { userId: typeof as === "string" && as ? as : null };
  }
  return { userId: user.sub };
}

export function assertAccountInScope(
  account: { userId: string | null } | null,
  scopeUserId: string | null,
): void {
  if (!account) throw new ApiError(400, "Conta vinculada não encontrada");
  if (account.userId !== scopeUserId) {
    throw new ApiError(403, "Conta fora do seu escopo");
  }
}
```

- [ ] **Step 4: Rodar teste até passar**

```bash
cd /workspace/backend && npx vitest run src/utils/scope.test.ts
```
Expected: PASS.

- [ ] **Step 5: Adicionar rotas admin de usuários**

Em `backend/src/routes/admin.routes.ts`, adicionar no topo imports e as rotas (após o bloco `adminRouter.get("/overview", ...)`):

```ts
import {
  approveUser,
  blockUser,
  listUsers,
  resetUserPassword,
  unblockUser,
} from "../services/user.service";
import { requireAdmin } from "../middleware/auth";

adminRouter.use(requireAdmin);
```

E adicionar as rotas de usuário ao final do arquivo:

```ts
adminRouter.get("/users", async (_req, res) => {
  res.json({ items: await listUsers() });
});

const statusActionSchema = { approve: approveUser, block: blockUser, unblock: unblockUser };

adminRouter.post("/users/:id/approve", async (req, res) => {
  await approveUser(req.params.id);
  res.json({ ok: true });
});

adminRouter.post("/users/:id/block", async (req, res) => {
  await blockUser(req.params.id);
  res.json({ ok: true });
});

adminRouter.post("/users/:id/unblock", async (req, res) => {
  await unblockUser(req.params.id);
  res.json({ ok: true });
});

const resetPasswordSchema = z.object({ password: z.string().min(6) });

adminRouter.post("/users/:id/reset-password", async (req, res) => {
  const { password } = resetPasswordSchema.parse(req.body);
  await resetUserPassword(req.params.id, password);
  res.json({ ok: true });
});
```

Adicionar `import { z } from "zod";` no topo do arquivo. Os handlers usam `ah` — envolver cada um com `ah(...)`. Remover a variável não usada `statusActionSchema` se ficar sobrando.

- [ ] **Step 6: Typecheck + testes**

```bash
cd /workspace/backend && npm run typecheck && npm run test 2>&1 | tail -8
```
Expected: OK.

- [ ] **Step 7: Commit**

```bash
git add backend/src/utils/scope.ts backend/src/utils/scope.test.ts backend/src/routes/admin.routes.ts
git commit -m "feat: escopo de acesso por usuário e rotas admin de usuários"
```

---

### Task 4: Rotas de autenticação (login/register/me/change-password) e conectividade com dono

**Files:**
- Modify: `backend/src/routes/auth.routes.ts`
- Modify: `backend/src/services/auth.service.ts`
- Test: `backend/src/services/auth.service.test.ts` (novos casos para `connectNative`/`confirmHosted`)

**Interfaces:**
- Consumes: `loginUser/registerUser/changePassword/getUserById` (Task 2), `requireAuth/requireAdmin` (Task 2).
- Produces:
  - `POST /auth/register` (público)
  - `POST /auth/login` (público)
  - `GET /auth/me` (autenticado, busca no DB)
  - `POST /auth/change-password` (autenticado)
  - `POST /auth/native` e `/auth/native/checkpoint` passam a exigir `requireAdmin` e aceitam `userId` opcional
  - `createHostedAuthUrl(userId: string | null): Promise<{ url }>` — nome marcado com userId
  - `confirmHosted(userId: string | null, opts: { pending: boolean }): Promise<{ accounts: number }>`
  - `connectNative(username, password, country?, userId?)` e `solveCheckpoint(localAccountId, code)` gravam `userId` na conta

- [ ] **Step 1: Atualizar `auth.routes.ts`**

Substituir imports e endpoints de login/me; adicionar register e change-password; restringir native:

```ts
import { Router, type Request } from "express";
import { z } from "zod";
import {
  connectNative,
  createHostedAuthUrl,
  registerWebhooks,
  solveCheckpoint,
} from "../services/auth.service";
import {
  changePassword,
  getUserById,
  loginUser,
  registerUser,
} from "../services/user.service";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { ah } from "./handler";

export const authRouter = Router();

const loginSchema = z.object({ username: z.string().min(1), password: z.string().min(1) });

authRouter.post("/login", ah(async (req, res) => {
  const body = loginSchema.parse(req.body);
  res.json(await loginUser(body.username, body.password));
}));

const registerSchema = z.object({
  name: z.string().min(1).max(120),
  username: z.string().min(3).max(40),
  password: z.string().min(6).max(100),
  whatsapp: z.string().max(25).optional(),
});

authRouter.post("/register", ah(async (req, res) => {
  const body = registerSchema.parse(req.body);
  const user = await registerUser(body);
  res.status(201).json({ user, message: "conta criada, aguardando aprovação" });
}));

authRouter.use(requireAuth);

authRouter.get("/me", ah(async (req, res) => {
  const u = (req as Request & { user: { sub: string } }).user;
  const user = await getUserById(u.sub);
  if (!user) return res.status(401).json({ error: "Usuário não encontrado" });
  res.json(user);
}));

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

authRouter.post("/change-password", ah(async (req, res) => {
  const u = (req as Request & { user: { sub: string } }).user;
  const body = changePasswordSchema.parse(req.body);
  await changePassword(u.sub, body.currentPassword, body.newPassword);
  res.json({ ok: true });
}));

const nativeSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  country: z.string().min(1).optional(),
  userId: z.string().optional(),
});

const checkpointSchema = z.object({ accountId: z.string().min(1), code: z.string().min(1) });

authRouter.post("/native", requireAdmin, ah(async (req, res) => {
  const body = nativeSchema.parse(req.body);
  const result = await connectNative(body.username, body.password, body.country, body.userId ?? null);
  if (result.checkpoint) {
    return res.status(202).json({ status: "CHECKPOINT", checkpoint: result.checkpoint, accountId: result.localAccountId });
  }
  res.status(201).json({ status: "OK", accountId: result.localAccountId, account: result.account });
}));

authRouter.post("/native/checkpoint", requireAdmin, ah(async (req, res) => {
  const body = checkpointSchema.parse(req.body);
  const result = await solveCheckpoint(body.accountId, body.code);
  if (result.checkpoint) return res.status(202).json({ status: "CHECKPOINT", checkpoint: result.checkpoint });
  res.json({ status: "OK", accountId: result.localAccountId });
}));

authRouter.post("/hosted", ah(async (req, res) => {
  const user = (req as Request & { user: { sub: string; role: string } }).user;
  const scope = user.role === "ADMIN"
    ? (req.headers["x-operate-as"] as string | undefined) ?? null
    : user.sub;
  const { url } = await createHostedAuthUrl(scope);
  res.json({ url });
}));

authRouter.post("/webhooks", requireAdmin, ah(async (_req, res) => {
  res.json(await registerWebhooks());
}));
```

- [ ] **Step 2: Atualizar `auth.service.ts` para dono + confirmHosted**

Em `backend/src/services/auth.service.ts`:

```ts
export async function connectNative(
  username: string,
  password: string,
  country?: string,
  userId?: string | null,
): Promise<NativeAuthResult> {
  const result = await unipile.connectLinkedinNative(username, password, country);

  if (result.checkpoint && result.account_id) {
    const local = await prisma.account.upsert({
      where: { unipileAccountId: result.account_id },
      update: { status: "CHECKPOINT", checkpointType: result.checkpoint.type, username, userId: userId ?? null, credentialsEnc: encrypt(JSON.stringify({ username, password })) },
      create: { unipileAccountId: result.account_id, username, authMethod: "NATIVE", status: "CHECKPOINT", checkpointType: result.checkpoint.type, userId: userId ?? null, credentialsEnc: encrypt(JSON.stringify({ username, password })) },
    });
    return { checkpoint: result.checkpoint.type, localAccountId: local.id };
  }

  const account = result as unknown as UnipileAccount;
  const local = await prisma.account.upsert({
    where: { unipileAccountId: account.id },
    update: { status: "OK", checkpointType: null, username, authMethod: "NATIVE", userId: userId ?? null, credentialsEnc: encrypt(JSON.stringify({ username, password })) },
    create: { unipileAccountId: account.id, username, authMethod: "NATIVE", status: "OK", userId: userId ?? null, credentialsEnc: encrypt(JSON.stringify({ username, password })) },
  });
  return { account, localAccountId: local.id };
}

export async function createHostedAuthUrl(userId: string | null): Promise<{ url: string }> {
  const dsn = await configService.unipileDsn();
  if (!dsn) throw new ApiError(503, "Unipile DSN não configurado");
  const apiUrl = dsn.replace(/\/+$/, "");
  const expiresOn = new Date(Date.now() + 10 * 60_000).toISOString();
  const frontendOrigin = env.FRONTEND_ORIGIN;
  const result = await unipile.createHostedAuthLink({
    apiUrl,
    expiresOn,
    successRedirectUrl: `${frontendOrigin}/conectar?hosted=ok`,
    failureRedirectUrl: `${frontendOrigin}/conectar?hosted=error`,
    name: `linkon-connect-${userId ?? "global"}-${Date.now()}`,
  });
  return { url: result.url };
}

export async function confirmHosted(
  userId: string | null,
  opts: { pending: boolean },
): Promise<{ accounts: number }> {
  const { items = [] } = await unipile.listAccounts();
  const prefix = `linkon-connect-${userId ?? "global"}-`;
  const matched = items.filter((a) => typeof a.name === "string" && a.name.startsWith(prefix));
  let created = 0;
  for (const acc of matched) {
    if (userId) {
      const owned = await prisma.account.count({
        where: { userId, status: { not: "REJECTED" } },
      });
      if (owned > 0) continue;
    }
    const status = opts.pending ? "PENDING_LINKEDIN" : "OK";
    await prisma.account.upsert({
      where: { unipileAccountId: acc.id },
      update: { status, username: acc.name, userId: userId ?? null },
      create: { unipileAccountId: acc.id, username: acc.name, status, authMethod: "HOSTED", userId: userId ?? null },
    });
    created += 1;
  }
  return { accounts: created };
}
```

E em `syncAccounts` (linhas 157-172), o `create` não define `userId` (fica null) — isso é o desejado para preservar dono em upserts de admin. Não alterar.

- [ ] **Step 3: Testes novos em `auth.service.test.ts`**

Acrescentar ao `vi.mock` de prisma os métodos usados por `confirmHosted` e ajustar o mock:

```ts
vi.mock("../lib/prisma", () => ({
  prisma: {
    account: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn(), count: vi.fn() },
    campaign: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("./unipile.service", () => ({
  unipile: { deleteAccount: vi.fn(), listAccounts: vi.fn(), createHostedAuthLink: vi.fn() },
}));
```

Adicionar os testes:

```ts
const accountUpsert = prisma.account.upsert as ReturnType<typeof vi.fn>;
const accountCount = prisma.account.count as ReturnType<typeof vi.fn>;
const listAccounts = unipile.listAccounts as ReturnType<typeof vi.fn>;

describe("confirmHosted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountUpsert.mockResolvedValue({ id: "A1" });
    accountCount.mockResolvedValue(0);
  });

  it("cria conta PENDING_LINKEDIN para usuário", async () => {
    listAccounts.mockResolvedValue({ items: [{ id: "UA1", name: "linkon-connect-U1-1700000000000" }] });
    const res = await confirmHosted("U1", { pending: true });
    expect(res.accounts).toBe(1);
    const create = accountUpsert.mock.calls[0][0] as { create: { status: string; userId: string } };
    expect(create.create.status).toBe("PENDING_LINKEDIN");
    expect(create.create.userId).toBe("U1");
  });

  it("não cria segunda conta para usuário que já possui uma", async () => {
    accountCount.mockResolvedValue(1);
    listAccounts.mockResolvedValue({ items: [{ id: "UA1", name: "linkon-connect-U1-1700000000000" }] });
    const res = await confirmHosted("U1", { pending: true });
    expect(res.accounts).toBe(0);
    expect(accountUpsert).not.toHaveBeenCalled();
  });

  it("ignora contas sem marcador do usuário", async () => {
    listAccounts.mockResolvedValue({ items: [{ id: "UA2", name: "Outro nome" }] });
    const res = await confirmHosted("U1", { pending: true });
    expect(res.accounts).toBe(0);
    expect(accountUpsert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Rodar testes do arquivo**

```bash
cd /workspace/backend && npx vitest run src/services/auth.service.test.ts
```
Expected: PASS.

- [ ] **Step 5: Typecheck + suite completa**

```bash
cd /workspace/backend && npm run typecheck && npm run test 2>&1 | tail -8
```
Expected: OK.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/auth.routes.ts backend/src/services/auth.service.ts backend/src/services/auth.service.test.ts
git commit -m "feat: login/registro multi-usuário e conexão de conta com dono"
```

---

### Task 5: Contas — rotas escopadas + aprovação admin

**Files:**
- Modify: `backend/src/routes/accounts.routes.ts`
- Modify: `backend/src/routes/admin.routes.ts` (aprovar/rejeitar contas)

**Interfaces:**
- Consumes: `resolveScope/assertAccountInScope` (Task 3), `confirmHosted` (Task 4).
- Produces:
  - `POST /accounts/confirm-hosted` — após `?hosted=ok`, cria a conta do usuário atual (`PENDING_LINKEDIN` para USER; `OK` para ADMIN-global).
  - `GET /accounts`, `GET /accounts/:id`, `POST /accounts/:id/disconnect`, `GET /accounts/:id/relations` escopados.
  - `POST /admin/accounts/:id/approve` e `POST /admin/accounts/:id/reject`.

- [ ] **Step 1: Reescrever `accounts.routes.ts`**

```ts
import { Router } from "express";
import { prisma } from "../lib/prisma";
import { syncAccounts, disconnectAccount, confirmHosted } from "../services/auth.service";
import { previewRelations } from "../services/sweep.service";
import { currentUser, resolveScope } from "../utils/scope";
import { ApiError } from "../utils/errors";
import { ah } from "./handler";

export const accountsRouter = Router();

accountsRouter.post(
  "/confirm-hosted",
  ah(async (req, res) => {
    const user = currentUser(req);
    const scope = resolveScope(req);
    const pending = user.role === "USER" || (user.role === "ADMIN" && scope.userId !== null);
    const result = await confirmHosted(scope.userId, { pending });
    res.json(result);
  }),
);

accountsRouter.get(
  "/",
  ah(async (req, res) => {
    try {
      await syncAccounts();
    } catch {
      // Unipile nao configurado: retorna contas locais mesmo assim
    }
    const scope = resolveScope(req);
    const accounts = await prisma.account.findMany({
      where: { userId: scope.userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        unipileAccountId: true,
        provider: true,
        username: true,
        authMethod: true,
        status: true,
        checkpointType: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { campaigns: true } },
      },
    });
    res.json({ items: accounts });
  }),
);

async function getScopedAccount(req: Parameters<typeof ah>[0] extends never ? never : Parameters<Parameters<typeof ah>[0]>[0], id: string) {
  const scope = resolveScope(req);
  const account = await prisma.account.findFirst({ where: { id, userId: scope.userId } });
  if (!account) throw new ApiError(404, "Conta não encontrada");
  return account;
}

accountsRouter.get(
  "/:id",
  ah(async (req, res) => {
    const account = await getScopedAccount(req, req.params.id);
    const full = await prisma.account.findUnique({
      where: { id: account.id },
      include: {
        campaigns: { orderBy: { createdAt: "desc" }, select: { id: true, name: true, status: true } },
        logs: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });
    res.json(full);
  }),
);

accountsRouter.post(
  "/:id/disconnect",
  ah(async (req, res) => {
    const account = await getScopedAccount(req, req.params.id);
    await disconnectAccount(account.id);
    res.json({ ok: true });
  }),
);

accountsRouter.get(
  "/:id/relations",
  ah(async (req, res) => {
    const account = await getScopedAccount(req, req.params.id);
    const cap = Math.min(10000, Math.max(100, Number(req.query.cap) || 5000));
    const preview = await previewRelations(account.unipileAccountId, cap);
    res.json({ ...preview, account: { id: account.id, username: account.username } });
  }),
);
```

Nota: a assinatura de `getScopedAccount` é feia — simplificar declarando o tipo do req com `import type { Request } from "express";` e usar `getScopedAccount(req: Request, id: string)`.

- [ ] **Step 2: Adicionar aprovação/rejeição em `admin.routes.ts`**

Adicionar ao final (após o disconnect existente):

```ts
adminRouter.post(
  "/accounts/:id/approve",
  ah(async (req, res) => {
    const account = await prisma.account.findUnique({ where: { id: req.params.id } });
    if (!account) throw new ApiError(404, "Conta não encontrada");
    if (account.status !== "PENDING_LINKEDIN") throw new ApiError(400, "Conta não está aguardando aprovação");
    await prisma.account.update({ where: { id: account.id }, data: { status: "OK", checkpointType: null } });
    await createLog({ type: "ACCOUNT_CONNECTED", message: `Conta ${account.username ?? account.unipileAccountId} aprovada pelo administrador`, accountId: account.id });
    res.json({ ok: true });
  }),
);

adminRouter.post(
  "/accounts/:id/reject",
  ah(async (req, res) => {
    const account = await prisma.account.findUnique({ where: { id: req.params.id } });
    if (!account) throw new ApiError(404, "Conta não encontrada");
    if (account.status !== "PENDING_LINKEDIN") throw new ApiError(400, "Conta não está aguardando aprovação");
    await prisma.account.update({ where: { id: account.id }, data: { status: "REJECTED" } });
    res.json({ ok: true });
  }),
);
```

- [ ] **Step 3: Typecheck + suite**

```bash
cd /workspace/backend && npm run typecheck && npm run test 2>&1 | tail -8
```
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/accounts.routes.ts backend/src/routes/admin.routes.ts
git commit -m "feat: contas escopadas por usuário e aprovação de conexão pelo admin"
```

---

### Task 6: Escopo em campanhas

**Files:**
- Modify: `backend/src/routes/campaigns.routes.ts`

**Interfaces:**
- Consumes: `resolveScope/assertAccountInScope` (Task 3).

- [ ] **Step 1: Adicionar helper de campanha escopada**

No topo de `campaigns.routes.ts`, adicionar imports:

```ts
import type { Request } from "express";
import { resolveScope, assertAccountInScope } from "../utils/scope";

async function getScopedCampaign(req: Request, id: string) {
  const scope = resolveScope(req);
  const campaign = await prisma.campaign.findFirst({ where: { id, userId: scope.userId } });
  if (!campaign) throw new ApiError(404, "Campanha não encontrada");
  return campaign;
}
```

- [ ] **Step 2: Aplicar escopo nas rotas**

- **POST `/`** (linha 174): após buscar o `account`, adicionar antes do `create`:
  ```ts
  const scope = resolveScope(req);
  assertAccountInScope(account, scope.userId);
  const campaign = await prisma.campaign.create({
    data: { ...(data as object), userId: scope.userId } as never,
  });
  ```
  (o `userId` deve entrar no `create.data`.)

- **GET `/`** (linha 192): adicionar `where: { userId: resolveScope(req).userId }` no `findMany`.

- **GET `/:id`** (linha 245): trocar `withStats(req.params.id)` para usar `getScopedCampaign` primeiro:
  ```ts
  const scoped = await getScopedCampaign(req, req.params.id);
  const campaign = await withStats(scoped.id);
  ```

- **PUT `/:id`** (linha 254): substituir `findUnique` por `getScopedCampaign(req, req.params.id)`; na validação do `accountId`, validar escopo com `assertAccountInScope(account, resolveScope(req).userId)`.

- **POST `/:id/start`, `/:id/pause`, `/:id/resume`, `/:id/sweep`, DELETE `/:id`**, **GET `/:id/leads/selection`**, **POST `/:id/leads/select`**, **GET `/:id/leads`**, **POST `/:id/scrape-contacts`**, **GET `/:id/scrape-status`**, **GET `/:id/export-xlsx`**, **GET `/:id/logs`**: substituir todos os `prisma.campaign.findUnique({ where: { id: req.params.id } })` por `getScopedCampaign(req, req.params.id)`.

- [ ] **Step 3: Typecheck**

```bash
cd /workspace/backend && npm run typecheck
```
Expected: OK.

- [ ] **Step 4: Teste de fumaça da suíte**

```bash
cd /workspace/backend && npm run test 2>&1 | tail -8
```
Expected: 99+ testes passando.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/campaigns.routes.ts
git commit -m "feat: campanhas escopadas por usuário (criar, listar, operar, excluir)"
```

---

### Task 7: Escopo em extrações

**Files:**
- Modify: `backend/src/services/extraction.service.ts`
- Modify: `backend/src/routes/extractions.routes.ts`

**Interfaces:**
- Consumes: `resolveScope/assertAccountInScope` (Task 3).

- [ ] **Step 1: Alterar `createExtraction` para receber `userId`**

Em `backend/src/services/extraction.service.ts`:

```ts
export interface CreateExtractionInput {
  name: string;
  searchUrl: string;
  accountId: string;
  maxResults: number;
  userId: string | null;
}
```

No corpo de `createExtraction`, após validar a conta, adicionar `userId` no `create`:

```ts
const extraction = await prisma.extraction.create({
  data: {
    name: input.name,
    searchUrl: input.searchUrl,
    accountId: account.id,
    maxResults: input.maxResults,
    userId: input.userId,
    status: "PROCESSING",
  },
});
```

Adicionar `userId` no tipo de retorno já incluído pela relação `user` (o `findMany`/`findUnique` em `listExtractions`/`getExtraction` deve incluir `user: { select: { id: true, username: true } }` para o frontend).

- [ ] **Step 2: Escopar `listExtractions`, `getExtraction`, `deleteExtraction`, `exportExtractionXlsx`**

```ts
export async function listExtractions(userId: string | null) {
  return prisma.extraction.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { account: { select: { id: true, username: true } } },
  });
}

export async function getExtraction(id: string, userId: string | null) {
  return prisma.extraction.findFirst({
    where: { id, userId },
    include: { account: { select: { id: true, username: true } } },
  });
}
```

Em `exportExtractionXlsx` e `deleteExtraction`, receber `userId` e usar `findFirst({ where: { id, userId } })` (lançando 404 se não achar).

- [ ] **Step 3: Ajustar `extractions.routes.ts`**

Ler o arquivo atual e aplicar:

- POST `/` : resolver escopo; `assertAccountInScope(account, scope.userId)`; passar `userId: scope.userId` no input.
- GET `/` : `listExtractions(resolveScope(req).userId)`.
- GET `/:id` : `getExtraction(req.params.id, scope.userId)`.
- GET `/:id/leads`, `GET /:id/export-xlsx`, `DELETE /:id` : validar existência via `getExtraction(req.params.id, scope.userId)` antes de prosseguir.

- [ ] **Step 4: Typecheck + suite**

```bash
cd /workspace/backend && npm run typecheck && npm run test 2>&1 | tail -8
```
Expected: OK.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/extraction.service.ts backend/src/routes/extractions.routes.ts
git commit -m "feat: extrações escopadas por usuário"
```

---

### Task 8: Frontend — tipos, contexto de auth e header de operação

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/lib/format.ts`
- Modify: `frontend/src/lib/auth.tsx`

**Interfaces:**
- Produces:
  - `types.ts`: `UserRole = "ADMIN" | "USER"`, `UserStatus = "PENDING" | "ACTIVE" | "BLOCKED"`, `interface AuthUser { id; username; name; role: UserRole; status: UserStatus }`, `AccountStatus` ganha `"PENDING_LINKEDIN" | "REJECTED"`, `Account.user?: { id: string; username: string | null } | null`.
  - `api.ts`: `getOperatingAs/setOperatingAs/clearOperatingAs` (localStorage `linkon_operating_as`); `request()` e `download()` enviam header `X-Operate-As` quando definido.
  - `auth.tsx`: expõe `user: AuthUser | null`, `register()`, `operatingAs: AuthUser | null`, `setOperatingAs(user)`, `clearOperatingAs()`.
  - `format.ts`: rótulos/estilos para `PENDING_LINKEDIN`/`REJECTED` e `USER_STATUS_LABEL`/`userStatusStyle`.

- [ ] **Step 1: Atualizar `types.ts`**

Adicionar:

```ts
export type UserRole = "ADMIN" | "USER";
export type UserStatus = "PENDING" | "ACTIVE" | "BLOCKED";

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  status: UserStatus;
}

export interface AdminUser extends AuthUser {
  whatsapp: string | null;
  status: UserStatus;
  createdAt: string;
  _count?: { accounts: number; campaigns: number; extractions: number };
}
```

Em `AccountStatus`, adicionar `| "PENDING_LINKEDIN" | "REJECTED"`. Em `Account`, adicionar `user?: { id: string; username: string | null } | null;`.

- [ ] **Step 2: Atualizar `lib/api.ts`**

Adicionar a chave e helpers e o header:

```ts
const OPERATING_KEY = "linkon_operating_as";

export function getOperatingAs(): string | null {
  return localStorage.getItem(OPERATING_KEY);
}
export function setOperatingAs(id: string): void {
  localStorage.setItem(OPERATING_KEY, id);
}
export function clearOperatingAs(): void {
  localStorage.removeItem(OPERATING_KEY);
}
```

Em `request()`, após montar `headers`, adicionar:

```ts
const operatingAs = getOperatingAs();
if (operatingAs) headers["X-Operate-As"] = operatingAs;
```

Idem no `download()` (montar `headers` com o token e o header de operação).

- [ ] **Step 3: Atualizar `lib/format.ts`**

```ts
export const ACCOUNT_STATUS_LABEL = {
  // ... existentes ...
  PENDING_LINKEDIN: "Aguardando aprovação",
  REJECTED: "Rejeitada",
} as const;
```

Em `accountStatusStyle`, adicionar:

```ts
case "PENDING_LINKEDIN":
  return "bg-amber-500/15 text-amber-400 border-amber-500/30";
case "REJECTED":
  return "bg-red-500/15 text-red-400 border-red-500/30";
```

Adicionar:

```ts
export const USER_STATUS_LABEL: Record<UserStatus, string> = {
  PENDING: "Pendente",
  ACTIVE: "Ativo",
  BLOCKED: "Bloqueado",
};

export function userStatusStyle(status: UserStatus): string {
  switch (status) {
    case "ACTIVE":
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "BLOCKED":
      return "bg-red-500/15 text-red-400 border-red-500/30";
    default:
      return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  }
}
```

Importar `UserStatus` no topo de `format.ts`.

- [ ] **Step 4: Atualizar `lib/auth.tsx`**

```tsx
import { api, clearOperatingAs, clearToken, getToken, setOperatingAs, setToken } from "../lib/api";
import type { AuthUser } from "../types";

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  operatingAs: AuthUser | null;
  login: (username: string, password: string) => Promise<AuthUser>;
  register: (input: { name: string; username: string; password: string; whatsapp?: string }) => Promise<void>;
  setOperatingAs: (u: AuthUser) => void;
  clearOperatingAs: () => void;
  logout: () => void;
}
```

No provider:

```tsx
const [operatingAs, setOperatingAsState] = useState<AuthUser | null>(null);

// /auth/me continua; /auth/register:
const register = useCallback(async (input) => {
  await api.post("/auth/register", input);
}, []);

const setOperatingAs = useCallback((u: AuthUser) => {
  setOperatingAsState(u);
  setOperatingAs(u.id);
}, []);

const clearOperatingAs = useCallback(() => {
  setOperatingAsState(null);
  clearOperatingAs();
}, []);

const logout = useCallback(() => {
  clearToken();
  clearOperatingAs();
  setUser(null);
  setOperatingAsState(null);
}, []);
```

Retornar no value do provider: `{ user, loading, operatingAs, login, register, setOperatingAs, clearOperatingAs, logout }`.

- [ ] **Step 5: Typecheck + build**

```bash
cd /workspace/frontend && npm run typecheck && npm run build
```
Expected: OK.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types.ts frontend/src/lib/api.ts frontend/src/lib/format.ts frontend/src/lib/auth.tsx
git commit -m "feat(frontend): tipos de usuário, header de operação e contexto de auth"
```

---

### Task 9: Frontend — login, registro, pedir acesso e guardas

**Files:**
- Create: `frontend/src/pages/RegisterPage.tsx`
- Modify: `frontend/src/pages/LoginPage.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `useAuth` com `register`, `user.role` (Task 8).
- Produces: rota pública `/registro`; `RequireAdmin` para `/administracao`.

- [ ] **Step 1: Criar `RegisterPage.tsx`**

```tsx
import { useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { Loader2, Lock, MessageCircle, User, UserPlus } from "lucide-react";
import { useAuth } from "../lib/auth";
import { toastFromError, useToast } from "../components/Toast";
import { Logo } from "../components/Logo";

export function RegisterPage() {
  const { user, register } = useAuth();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState(false);

  if (user) return <Navigate to="/campanhas" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await register({ name: name.trim(), username: username.trim(), password, whatsapp: whatsapp.trim() || undefined });
      setCreated(true);
    } catch (err) {
      toastFromError(toast, err);
    } finally {
      setLoading(false);
    }
  }

  if (created) {
    return (
      <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-ink px-4">
        <div className="relative z-10 w-full max-w-md">
          <div className="gold-frame card p-8 text-center backdrop-blur-sm">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-gold-500/40 bg-gold-500/10 shadow-gold">
              <UserPlus className="h-6 w-6 text-gold-400" />
            </div>
            <h1 className="font-serif text-2xl font-semibold text-cream">Conta criada</h1>
            <p className="mt-2 text-sm text-cream/60">
              Sua conta foi criada e está <span className="text-gold-400">aguardando aprovação</span>{" "}
              do administrador. Quando aprovado, você receberá acesso para entrar no painel.
            </p>
            <Link to="/login" className="btn btn-primary mt-6 w-full">
              Ir para o login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-ink px-4">
      <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="relative z-10 w-full max-w-md">
        <div className="flex justify-center">
          <Logo size="lg" />
        </div>
        <div className="gold-frame card mt-8 p-8 backdrop-blur-sm">
          <h1 className="font-serif text-2xl font-semibold text-cream">Criar conta</h1>
          <p className="mb-6 mt-1 text-sm text-cream/50">
            Cadastre-se e aguarde a aprovação do administrador para começar.
          </p>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label htmlFor="reg-name" className="label">Nome</label>
              <input id="reg-name" className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome completo" />
            </div>
            <div>
              <label htmlFor="reg-username" className="label">Usuário</label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gold-500/70" />
                <input id="reg-username" className="input !pl-10" required minLength={3} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Mínimo 3 caracteres" />
              </div>
            </div>
            <div>
              <label htmlFor="reg-password" className="label">Senha</label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gold-500/70" />
                <input id="reg-password" className="input !pl-10" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" />
              </div>
            </div>
            <div>
              <label htmlFor="reg-whatsapp" className="label">WhatsApp (opcional)</label>
              <div className="relative">
                <MessageCircle className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gold-500/70" />
                <input id="reg-whatsapp" className="input !pl-10" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="Ex: 5511999999999" />
              </div>
            </div>
            <button type="submit" className="btn btn-primary w-full !py-3" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Criar conta
            </button>
          </form>
          <p className="mt-5 text-center text-sm text-cream/50">
            Já tem conta?{" "}
            <Link to="/login" className="text-gold-400 hover:underline">Entrar</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Atualizar `LoginPage.tsx`**

- Trocar o título "Painel do administrador" por "Entrar na sua conta" e o subtítulo por "Acesso ao painel do Link ON".
- No fim do formulário, adicionar dois links:

```tsx
<div className="mt-5 space-y-3 border-t border-ink-400 pt-5">
  <a
    href={`https://wa.me/${import.meta.env.VITE_WHATSAPP_SUPPORT ?? "5519990041826"}?text=${encodeURIComponent("Olá! Gostaria de solicitar acesso ao Link ON.")}`}
    target="_blank"
    rel="noreferrer"
    className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-sm font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20"
  >
    <MessageCircle className="h-4 w-4" />
    Pedir acesso
  </a>
  <p className="text-center text-sm text-cream/50">
    Ainda não tem conta?{" "}
    <Link to="/registro" className="text-gold-400 hover:underline">Criar conta</Link>
  </p>
</div>
```

Imports: adicionar `MessageCircle` e `Link` de `react-router-dom`.

- [ ] **Step 3: Registrar rota e guarda admin no `App.tsx`**

```tsx
import { RegisterPage } from "./pages/RegisterPage";

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== "ADMIN") return <Navigate to="/campanhas" replace />;
  return <>{children}</>;
}
```

Adicionar rota pública:

```tsx
<Route path="/registro" element={<RegisterPage />} />
```

Trocar a rota `/administracao`:

```tsx
<Route path="/administracao" element={<RequireAdmin><AdminPage /></RequireAdmin>} />
```

- [ ] **Step 4: Typecheck + build**

```bash
cd /workspace/frontend && npm run typecheck && npm run build
```
Expected: OK.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/RegisterPage.tsx frontend/src/pages/LoginPage.tsx frontend/src/App.tsx
git commit -m "feat(frontend): registro de usuário, pedir acesso via WhatsApp e guarda admin"
```

---

### Task 10: Frontend — layout por role e banner "operando como"

**Files:**
- Modify: `frontend/src/components/Layout.tsx`

**Interfaces:**
- Consumes: `useAuth()` com `user.role`, `operatingAs`, `clearOperatingAs` (Task 8).

- [ ] **Step 1: Navegação condicional e rótulo de role**

No `SidebarContent`, após `const { user, logout } = useAuth();`:

```tsx
const isAdmin = user?.role === "ADMIN";
const NAV = [
  { to: "/", label: "Início", icon: Home, end: true },
  { to: "/campanhas", label: "Campanhas", icon: Link2 },
  { to: "/disparos", label: "Disparos", icon: Radar },
  { to: "/extracao", label: "Extração", icon: ScanSearch },
  { to: "/conectar", label: "Conta LinkedIn", icon: UserPlus },
  ...(isAdmin ? [{ to: "/administracao", label: "Administração", icon: ShieldCheck }] : []),
  { to: "/configuracoes", label: "Configurações", icon: Settings },
  { to: "/tutorial", label: "Tutorial", icon: HelpCircle },
];
```

Mover a constante `NAV` para dentro do componente (remover a constante global do arquivo). No rodapé, trocar a label fixa "Administrador":

```tsx
<div className="text-xs text-cream/40">{isAdmin ? "Administrador" : "Usuário"}</div>
```

- [ ] **Step 2: Banner "operando como usuário"**

No componente `Layout` (que já tem `const [open, setOpen] = useState(false)`), adicionar:

```tsx
const { operatingAs, clearOperatingAs } = useAuth();
```

E, dentro do `<main>`, antes do `<Outlet />`:

```tsx
{operatingAs && (
  <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gold-500/30 bg-gold-500/10 px-4 py-2.5 text-sm">
    <span className="text-cream">
      Operando como <span className="font-semibold text-gold-400">{operatingAs.name || operatingAs.username}</span>
    </span>
    <button
      type="button"
      className="btn btn-secondary !px-3 !py-1.5 text-xs"
      onClick={() => {
        clearOperatingAs();
        window.location.assign("/administracao");
      }}
    >
      Voltar ao painel
    </button>
  </div>
)}
```

- [ ] **Step 3: Typecheck + build**

```bash
cd /workspace/frontend && npm run typecheck && npm run build
```
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Layout.tsx
git commit -m "feat(frontend): navegação por role e banner de operação como usuário"
```

---

### Task 11: Frontend — painel admin (usuários, contas, base global, operar como)

**Files:**
- Modify: `frontend/src/pages/AdminPage.tsx`

**Interfaces:**
- Consumes: `api` com header `X-Operate-As`, `useAuth().setOperatingAs`, tipos `AdminUser`/`UserStatus` (Task 8), `formatDateTime`.
- Produces: abas `overview | users | accounts | global | logs`; seletor "operar como".

- [ ] **Step 1: Novas abas e tipos**

Adicionar `type Tab = "overview" | "users" | "accounts" | "global" | "logs";`. No componente, adicionar estado e loaders:

```tsx
const [users, setUsers] = useState<AdminUser[] | null>(null);
const [globalData, setGlobalData] = useState<{ campaigns: number; extractions: number } | null>(null);

const loadUsers = useCallback(() => {
  api.get<{ items: AdminUser[] }>("/admin/users").then((r) => setUsers(r.items)).catch((e) => toastFromError(toast, e));
}, [toast]);

const loadGlobal = useCallback(() => {
  api.get<{ campaigns: number; extractions: number }>("/admin/global").then(setGlobalData).catch((e) => toastFromError(toast, e));
}, [toast]);
```

No `useEffect` de tab, chamar `loadUsers()` se `tab === "users"` e `loadGlobal()` se `tab === "global"`.

Adicionar às tabs:

```tsx
{ key: "users", label: "Usuários", icon: UserPlus },
{ key: "accounts", label: "Contas LinkedIn", icon: Link2 },
{ key: "global", label: "Base global", icon: Globe },
```

Imports adicionais: `Globe`, `KeyRound`, `Link2`, `ShieldCheck` (já existe), `Check`, `X`, `UserCog`.

- [ ] **Step 2: Ações de usuário + operar como**

Ações: aprovar, bloquear, desbloquear, redefinir senha, operar como.

```tsx
async function onUserAction(id: string, action: "approve" | "block" | "unblock") {
  try {
    await api.post(`/admin/users/${id}/${action}`);
    toast("success", "Usuário atualizado");
    loadUsers();
  } catch (err) {
    toastFromError(toast, err);
  }
}

async function onResetPassword(user: AdminUser) {
  const password = window.prompt(`Nova senha para ${user.username}:`);
  if (!password) return;
  if (password.length < 6) { toast("error", "A senha deve ter no mínimo 6 caracteres"); return; }
  try {
    await api.post(`/admin/users/${id}/reset-password`, { password });
    toast("success", "Senha redefinida");
  } catch (err) {
    toastFromError(toast, err);
  }
}
```

Renderizar aba users (tabela com status, contadores, botões). O botão "Operar como" chama:

```tsx
onClick={() => { setOperatingAs(u); window.location.assign("/campanhas"); }}
```

- [ ] **Step 3: Aba de contas com aprovar/rejeitar**

Na lista de contas existente, se `a.status === "PENDING_LINKEDIN"`, mostrar botões:

```tsx
<button onClick={() => onAccountApprove(a.id)} className="btn btn-secondary !px-2.5 !py-1.5 text-xs">
  <Check className="h-3.5 w-3.5" /> Aprovar
</button>
<button onClick={() => onAccountReject(a.id)} className="btn btn-danger !px-2.5 !py-1.5 text-xs">
  <X className="h-3.5 w-3.5" /> Rejeitar
</button>
```

```tsx
async function onAccountApprove(id: string) {
  try { await api.post(`/admin/accounts/${id}/approve`); toast("success", "Conta aprovada"); loadAccounts(); }
  catch (err) { toastFromError(toast, err); }
}
async function onAccountReject(id: string) {
  try { await api.post(`/admin/accounts/${id}/reject`); toast("success", "Conta rejeitada"); loadAccounts(); }
  catch (err) { toastFromError(toast, err); }
}
```

Na listagem de contas, exibir o dono: `a.user?.username ?? "Base global"` na linha de detalhe.

- [ ] **Step 4: Aba "Base global"**

Renderizar dois StatCard/linhas com `globalData?.campaigns` e `globalData?.extractions` e um aviso de somente leitura. Backend da rota será criado na Task 12.

- [ ] **Step 5: Typecheck + build**

```bash
cd /workspace/frontend && npm run typecheck && npm run build
```
Expected: OK (rota `/admin/global` ainda 404 — aceitável até a Task 12).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/AdminPage.tsx
git commit -m "feat(frontend): painel admin com usuários, contas, base global e operar como"
```

---

### Task 12: Backend — rota admin de base global + envio do dono nas contas admin

**Files:**
- Modify: `backend/src/routes/admin.routes.ts`
- Modify: `backend/src/routes/accounts.routes.ts` (não necessário)

**Interfaces:**
- Produces: `GET /admin/global → { campaigns, extractions }` (contagens da base `userId = null`); `/admin/accounts` inclui `user` no select.

- [ ] **Step 1: Adicionar `GET /admin/global`**

Em `backend/src/routes/admin.routes.ts`:

```ts
adminRouter.get(
  "/global",
  ah(async (_req, res) => {
    const [campaigns, extractions] = await Promise.all([
      prisma.campaign.count({ where: { userId: null } }),
      prisma.extraction.count({ where: { userId: null } }),
    ]);
    res.json({ campaigns, extractions });
  }),
);
```

- [ ] **Step 2: Incluir dono na listagem admin de contas**

Em `GET /admin/accounts` (linhas 84-104), adicionar ao `select`:

```ts
user: { select: { id: true, username: true } },
```

- [ ] **Step 3: Typecheck + suite**

```bash
cd /workspace/backend && npm run typecheck && npm run test 2>&1 | tail -8
```
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/admin.routes.ts
git commit -m "feat: rota admin de base global e dono nas contas"
```

---

### Task 13: Frontend — Contas LinkedIn e Configurações por role

**Files:**
- Modify: `frontend/src/pages/ConnectPage.tsx`
- Modify: `frontend/src/pages/SettingsPage.tsx`

**Interfaces:**
- Consumes: `useAuth().user.role`, endpoint `POST /accounts/confirm-hosted` (Task 5).

- [ ] **Step 1: ConnectPage por role**

No topo:

```tsx
const { user } = useAuth();
const isAdmin = user?.role === "ADMIN";
```

- Para usuário comum: esconder os cards "Login nativo" e "Webhooks da Unipile"; mostrar apenas o card "Assistente do LinkedIn". Esconder o botão "Sincronizar" e o "Registrar webhooks".
- Ao voltar de `?hosted=ok` (leitura via `useSearchParams`), chamar `api.post("/accounts/confirm-hosted")` e recarregar:
  ```tsx
  const [params] = useSearchParams();
  useEffect(() => {
    if (params.get("hosted") === "ok") {
      api.post<{ accounts: number }>("/accounts/confirm-hosted")
        .then((r) => toast("success", r.accounts > 0 ? "Conta conectada e enviada para aprovação" : "Aguardando conexão..."))
        .catch((e) => toastFromError(toast, e))
        .finally(loadAccounts);
    }
  }, [params]);
  ```
- Se o usuário já tem conta (accounts.length > 0) e não é admin, esconder os botões de conexão (mostrar só a lista) — cumpre "1 conta por usuário".
- O card "Assistente do LinkedIn" chama `api.post("/auth/hosted")` (inalterado).

- [ ] **Step 2: SettingsPage por role**

- `const { user } = useAuth(); const isAdmin = user?.role === "ADMIN";`
- Se `!isAdmin`: não chamar `/config`; esconder os cards de servidor/Redis/Unipile, o formulário "Credenciais da Unipile" e a seção "Webhooks registrados". Mostrar apenas o bloco de **alterar senha**.
- Adicionar bloco de troca de senha (visível para todos):

```tsx
<form
  className="card mt-6 space-y-4 p-5"
  onSubmit={async (e) => {
    e.preventDefault();
    try {
      await api.post("/auth/change-password", { currentPassword, newPassword });
      toast("success", "Senha alterada");
      setCurrentPassword(""); setNewPassword("");
    } catch (err) {
      toastFromError(toast, err);
    }
  }}
>
  <h2 className="font-serif text-lg text-gold-400">Alterar senha</h2>
  <input className="input" type="password" placeholder="Senha atual" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
  <input className="input" type="password" placeholder="Nova senha (mín. 6)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6} />
  <button type="submit" className="btn btn-primary">Alterar senha</button>
</form>
```

- [ ] **Step 3: Typecheck + build**

```bash
cd /workspace/frontend && npm run typecheck && npm run build
```
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/ConnectPage.tsx frontend/src/pages/SettingsPage.tsx
git commit -m "feat(frontend): tela de contas e configurações adaptadas por role"
```

---

### Task 14: Migração de dados, reinício e validação ponta a ponta

**Files:**
- Nenhum (operações de runtime).

- [ ] **Step 1: Aplicar schema e reiniciar serviços**

```bash
cd /workspace/backend && npx prisma db push && npx prisma generate
```

Reiniciar backend (`background_terminal_kill` do terminal atual + novo `npx tsx src/index.ts`), e reiniciar o extraction worker. Manter Redis e demais workers.

- [ ] **Step 2: Verificar admin + usuário pendente via API**

```bash
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login -H 'Content-Type: application/json' -d '{"username":"arcanjo","password":"29172510"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/admin/users
curl -s -X POST http://localhost:3001/api/auth/register -H 'Content-Type: application/json' -d '{"name":"Teste User","username":"teste","password":"123456","whatsapp":"5511999999999"}'
curl -s -X POST http://localhost:3001/api/admin/users/<id-do-teste>/approve -H "Authorization: Bearer $TOKEN"
```
Expected: registro cria PENDING; approve vira ACTIVE; login do `teste` funciona após aprovação.

- [ ] **Step 3: Conferir escopo**

Com o token do `teste`: `GET /api/campaigns` retorna `[]` (não vê campanhas globais). Com o token do admin + header `X-Operate-As: <id-teste>`: lista vazia; sem header: retorna as campanhas globais legadas.

- [ ] **Step 4: Validar aprovação de conta LinkedIn**

Com o token de um usuário comum ativo: `POST /api/accounts/confirm-hosted` (com Unipile sem contas novas) → `{ accounts: 0 }`. Fluxo real exige conectar pela tela; validar na UI.

- [ ] **Step 5: Verificação final**

```bash
cd /workspace/backend && npm run typecheck && npm run test 2>&1 | tail -6
cd /workspace/frontend && npm run typecheck && npm run build
```

- [ ] **Step 6: Preview**

Chamar `request_preview` na porta 5173 e confirmar login/registro/administração no preview.

- [ ] **Step 7: Commit**

```bash
git add backend/prisma/schema.prisma backend/src backend/package.json frontend/src frontend/package.json frontend/.env
git commit -m "feat: sistema multi-usuário completo com painel de administração"
```
(Se o `git status` mostrar muitos arquivos, usar `git add` explícito de cada arquivo alterado nesta feature.)

---

## Self-Review

**Cobertura do spec:** (1) modelo `User` + ownership — Task 1; (2) login/registro/status/pedir acesso — Tasks 2, 4, 9; (3) painel admin (usuários, contas, base global, operar como) — Tasks 3, 5, 11, 12; (4) layout por role — Tasks 8, 10, 13; regra 1 conta/usuário e aprovação — Tasks 4, 5, 13; bloqueio pausa campanhas — Task 2; sem exclusão de dados — modelo `onDelete: SetNull` na Task 1.

**Placeholders:** nenhum — todos os passos têm código ou comando real.

**Consistência de tipos:** `AuthPayload`/`resolveScope`/`assertAccountInScope`/`confirmHosted(userId, { pending })`/`listExtractions(userId)`/`getExtraction(id, userId)`/`AdminUser`/`AuthUser` são definidos nas Tasks que os produzem e consumidos com os mesmos nomes/assinaturas nas Tasks posteriores.
