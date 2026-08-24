# Disparo em Massa (Broadcast) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um gerenciador de disparo de mensagens em massa: criar disparo → varrer rede → selecionar contatos → disparar → acompanhar progresso em tempo real (lista, detalhe, métricas de resposta, notificações).

**Architecture:** Campanhas ganham um terceiro modo (`DISPARO`). A varredura (importação de relações via Unipile) vira um endpoint que preenche `Lead`s de uma campanha `DISPARO`; o usuário seleciona via `Lead.selected`; worker/scheduler enviam mensagens só para `selected=true`. Um novo modelo `Notification` alimenta um sino no layout.

**Tech Stack:** Express + TypeScript + Prisma/SQLite + BullMQ/Redis (backend); React + Vite + Tailwind (frontend). Testes: Vitest.

## Global Constraints

- Mensagens/UI sempre em pt-BR (com exceção de palavras técnicas). Sem emojis em código/UI.
- Backend testa via `npm run test` (Vitest) e `npm run typecheck` em `/workspace/backend`. Frontend via `npm run typecheck` e `npm run build` em `/workspace/frontend`.
- Após qualquer mudança no Prisma schema, rodar `npm run db:generate` e `npm run db:push` em `/workspace/backend`.
- Comandos `npm`/`tsx`/`vite` sempre rodam no subdiretório (`/workspace/backend` ou `/workspace/frontend`), nunca na raiz.
- Não usar `rm`/delete; commits frequentes e pequenos; não commitar sem instrução do executor do plano.
- Semântica legada preservada: campanhas `SEARCH` (convites) e `SWEEP` antigas continuam funcionando.
- `Campaign.mode` é `String` no Prisma; o enum é validado no zod (`z.enum`). Adicionar `DISPARO` ao zod e aos tipos do frontend.
- Padrão de código: seguir `sweep.service.ts`/`search.service.ts` (serviços finos, `createLog` para eventos, `ApiError` para erros HTTP, `UnipileError` para erros Unipile, `notify()` nunca quebra o fluxo).

---

### Task 1: Schema Prisma — `Lead.selected` e modelo `Notification`

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Test/verify: rodar `npm run db:generate` e `npm run db:push` em `backend`

**Interfaces:**
- Produces: `prisma.notification.create/findMany/count/update/updateMany`, `prisma.lead.count/findMany/updateMany` com o campo `selected: boolean`, e campo `Lead.selected` no tipo gerado.

- [ ] **Step 1: Adicionar o campo `selected` ao modelo `Lead`**

Em `backend/prisma/schema.prisma`, no modelo `Lead`, após `status String @default("PENDING")`:

```prisma
  selected         Boolean   @default(false)
```

- [ ] **Step 2: Adicionar o modelo `Notification` no fim do arquivo**

```prisma
model Notification {
  id         String    @id @default(cuid())
  accountId  String?
  campaignId String?
  type       String
  level      String    @default("INFO")
  message    String
  payload    String?
  read       Boolean   @default(false)
  createdAt  DateTime  @default(now())

  @@index([createdAt])
  @@index([read])
}
```

- [ ] **Step 3: Aplicar o schema e gerar o client**

Run (no `/workspace/backend`):
```bash
npm run db:generate
npm run db:push
```
Expected: `db push` reporta alterações (coluna `selected` em `Lead`, tabela `Notification`); `generate` completa sem erro.

- [ ] **Step 4: Confirmar typecheck**

Run:
```bash
npm run typecheck
```
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma
git commit -m "feat: adiciona Lead.selected e modelo Notification ao schema"
```

---

### Task 2: Serviço e rotas de notificação

**Files:**
- Create: `backend/src/services/notification.service.ts`
- Create: `backend/src/services/notification.service.test.ts`
- Create: `backend/src/routes/notifications.routes.ts`
- Modify: `backend/src/routes/index.ts`
- Test: `backend/src/services/notification.service.test.ts`

**Interfaces:**
- Consumes: `prisma.notification`, `logger`.
- Produces: `notify(input: NotificationInput): Promise<void>` onde `NotificationInput = { accountId?: string; campaignId?: string; type: string; level?: "INFO"|"WARN"|"ERROR"; message: string; payload?: unknown }`; rotas `GET /api/notifications`, `POST /api/notifications/read-all`, `POST /api/notifications/:id/read`.

- [ ] **Step 1: Escrever o teste que falha**

Create `backend/src/services/notification.service.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/prisma", () => ({
  prisma: { notification: { create: vi.fn() } },
}));

vi.mock("../utils/logger", () => ({
  logger: { error: vi.fn() },
}));

import { prisma } from "../lib/prisma";
import { notify } from "./notification.service";

const create = prisma.notification.create as ReturnType<typeof vi.fn>;

describe("notify", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cria uma notificação com defaults", async () => {
    create.mockResolvedValue({ id: "N1" });
    await notify({ type: "BROADCAST_STARTED", message: "Disparo iniciado." });
    expect(create).toHaveBeenCalledWith({
      data: {
        accountId: undefined,
        campaignId: undefined,
        type: "BROADCAST_STARTED",
        level: "INFO",
        message: "Disparo iniciado.",
        payload: undefined,
      },
    });
  });

  it("serializa o payload e preserva o nível", async () => {
    create.mockResolvedValue({ id: "N2" });
    await notify({
      accountId: "A1",
      campaignId: "C1",
      type: "BROADCAST_LIMIT_HIT",
      level: "WARN",
      message: "Limite atingido.",
      payload: { imported: 5 },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        accountId: "A1",
        campaignId: "C1",
        type: "BROADCAST_LIMIT_HIT",
        level: "WARN",
        message: "Limite atingido.",
        payload: '{"imported":5}',
      },
    });
  });

  it("não lança quando o create falha", async () => {
    create.mockRejectedValue(new Error("db down"));
    await expect(notify({ type: "X", message: "m" })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar o teste para ver falhar**

Run:
```bash
npx vitest run src/services/notification.service.test.ts
```
Expected: FAIL com "Cannot find module './notification.service'".

- [ ] **Step 3: Implementar o serviço**

Create `backend/src/services/notification.service.ts`:

```ts
import { prisma } from "../lib/prisma";
import { logger } from "../utils/logger";

export interface NotificationInput {
  accountId?: string;
  campaignId?: string;
  type: string;
  level?: "INFO" | "WARN" | "ERROR";
  message: string;
  payload?: unknown;
}

export async function notify(input: NotificationInput): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        accountId: input.accountId,
        campaignId: input.campaignId,
        type: input.type,
        level: input.level ?? "INFO",
        message: input.message,
        payload: input.payload !== undefined ? JSON.stringify(input.payload) : undefined,
      },
    });
  } catch (err) {
    logger.error("Failed to create notification", err);
  }
}
```

- [ ] **Step 4: Rodar o teste para passar**

Run:
```bash
npx vitest run src/services/notification.service.test.ts
```
Expected: PASS (3 testes).

- [ ] **Step 5: Criar as rotas**

Create `backend/src/routes/notifications.routes.ts`:

```ts
import { Router } from "express";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/errors";
import { ah } from "./handler";

export const notificationsRouter = Router();

notificationsRouter.get(
  "/",
  ah(async (req, res) => {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const items = await prisma.notification.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    const unread = await prisma.notification.count({ where: { read: false } });
    res.json({ items, unread });
  }),
);

notificationsRouter.post(
  "/read-all",
  ah(async (_req, res) => {
    await prisma.notification.updateMany({ where: { read: false }, data: { read: true } });
    res.json({ ok: true });
  }),
);

notificationsRouter.post(
  "/:id/read",
  ah(async (req, res) => {
    const n = await prisma.notification.findUnique({ where: { id: req.params.id } });
    if (!n) throw new ApiError(404, "Notificação não encontrada");
    await prisma.notification.update({ where: { id: req.params.id }, data: { read: true } });
    res.json({ ok: true });
  }),
);
```

- [ ] **Step 6: Registrar o router**

Em `backend/src/routes/index.ts`, adicionar o import e o `use` após `requireAuth`:

```ts
import { notificationsRouter } from "./notifications.routes";
```

e logo após `apiRouter.use("/logs", logsRouter);`:

```ts
apiRouter.use("/notifications", notificationsRouter);
```

- [ ] **Step 7: Rodar testes e typecheck**

Run:
```bash
npm run test
npm run typecheck
```
Expected: todas as suítes verdes (43 antigas + 3 novas), sem erros de tipo.

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/notification.service.ts backend/src/services/notification.service.test.ts backend/src/routes/notifications.routes.ts backend/src/routes/index.ts
git commit -m "feat: serviço e rotas de notificação"
```

---

### Task 3: `flow.service` — helper `isConnectedMode` e semântica DISPARO

**Files:**
- Modify: `backend/src/services/flow.service.ts`
- Test: `backend/src/services/flow.service.test.ts`

**Interfaces:**
- Consumes: nada de tarefas anteriores (além do padrão já existente).
- Produces: `isConnectedMode(mode: string): boolean` exportado.

- [ ] **Step 1: Adicionar os testes que falham (semântica DISPARO)**

No fim de `backend/src/services/flow.service.test.ts` (após o teste `"sweep: on_accept passes through immediately for PENDING leads"`), adicionar:

```ts
  it("disparo: invite block sends a direct message (no invitation)", async () => {
    const flow = makeFlow({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "i1", type: "invite", position: { x: 0, y: 100 }, data: { message: "Olá do disparo" } },
        { id: "t1", type: "stop", position: { x: 0, y: 200 }, data: {} },
      ],
      edges: [
        { id: "e1", source: "s1", target: "i1" },
        { id: "e2", source: "i1", target: "t1" },
      ],
    });
    const campaign = baseCampaign(flow);
    campaign.mode = "DISPARO";

    await processFlowStep(campaign, account, baseLead(), parseFlow(flow));

    expect(unipile.sendInvitation).not.toHaveBeenCalled();
    expect(unipile.sendDirectMessage).toHaveBeenCalledWith("UA1", "u:abc", "Olá do disparo");
  });

  it("disparo: message block sends to a PENDING lead", async () => {
    const flow = makeFlow({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "m1", type: "message", position: { x: 0, y: 100 }, data: { message: "Oi" } },
        { id: "t1", type: "stop", position: { x: 0, y: 200 }, data: {} },
      ],
      edges: [
        { id: "e1", source: "s1", target: "m1" },
        { id: "e2", source: "m1", target: "t1" },
      ],
    });
    const campaign = baseCampaign(flow);
    campaign.mode = "DISPARO";

    await processFlowStep(campaign, account, baseLead(), parseFlow(flow));

    expect(unipile.sendDirectMessage).toHaveBeenCalledWith("UA1", "u:abc", "Oi");
  });

  it("disparo: on_accept passes through immediately for PENDING leads", async () => {
    const flow = makeFlow({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "oa", type: "on_accept", position: { x: 0, y: 100 }, data: {} },
        { id: "t1", type: "stop", position: { x: 0, y: 200 }, data: {} },
      ],
      edges: [
        { id: "e1", source: "s1", target: "oa" },
        { id: "e2", source: "oa", target: "t1" },
      ],
    });
    const campaign = baseCampaign(flow);
    campaign.mode = "DISPARO";

    await processFlowStep(campaign, account, baseLead({ currentBlockId: "oa" }), parseFlow(flow));

    const updates = leadUpdate.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);
    expect(updates.some((d) => d.status === "COMPLETED")).toBe(true);
  });
```

- [ ] **Step 2: Rodar os testes para ver falhar**

Run:
```bash
npx vitest run src/services/flow.service.test.ts
```
Expected: os 3 novos testes falham (invite dispara `sendInvitation` / não envia DM, message não envia, on_accept não completa).

- [ ] **Step 3: Implementar o helper e trocar as checagens**

Em `backend/src/services/flow.service.ts`, após `BLOCK_META` (linha ~30), adicionar:

```ts
export function isConnectedMode(mode: string): boolean {
  return mode === "SWEEP" || mode === "DISPARO";
}
```

Substituir as checagens de `campaign.mode === "SWEEP"`:

1. Em `handleInviteBlock`:
```ts
  if (campaign.mode === "SWEEP") {
    return handleSweepInviteBlock(campaign, account, lead, flow, node);
  }
```
vira:
```ts
  if (isConnectedMode(campaign.mode)) {
    return handleSweepInviteBlock(campaign, account, lead, flow, node);
  }
```

2. Em `handleMessageBlock`, a constante `canSend`:
```ts
  const canSend =
    campaign.mode === "SWEEP"
      ? lead.status === "PENDING" || lead.status === "ACCEPTED" || lead.status === "RESPONDED"
      : lead.status === "ACCEPTED" || lead.status === "RESPONDED";
```
vira:
```ts
  const canSend = isConnectedMode(campaign.mode)
    ? lead.status === "PENDING" || lead.status === "ACCEPTED" || lead.status === "RESPONDED"
    : lead.status === "ACCEPTED" || lead.status === "RESPONDED";
```

3. Em `handleConditionBlock`, a chamada de `evaluateCondition`:
```ts
  const result = evaluateCondition(node, lead, campaign.mode === "SWEEP");
```
vira:
```ts
  const result = evaluateCondition(node, lead, isConnectedMode(campaign.mode));
```

4. Em `processFlowStep`, o bloco `on_accept`:
```ts
        if (campaign.mode === "SWEEP" || lead.status === "ACCEPTED" || lead.status === "RESPONDED") {
```
vira:
```ts
        if (isConnectedMode(campaign.mode) || lead.status === "ACCEPTED" || lead.status === "RESPONDED") {
```

- [ ] **Step 4: Adicionar notify no limite atingido do fluxo**

Em `flow.service.ts`, adicionar import:
```ts
import { notify } from "./notification.service";
```
e no ramo `isLimitError()` de `handleDmError`, logo antes do `createLog` do `RATE_LIMITED`:
```ts
    await notify({
      accountId: campaign.accountId,
      campaignId: campaign.id,
      type: "BROADCAST_LIMIT_HIT",
      level: "WARN",
      message: `Limite do LinkedIn atingido ao enviar mensagem (${err.errorType}). Disparo pausado.`,
      payload: { error: err.message },
    });
```

- [ ] **Step 5: Atualizar o mock de teste**

Em `backend/src/services/flow.service.test.ts`, adicionar após o `vi.mock("./log.service", ...)`:
```ts
vi.mock("./notification.service", () => ({
  notify: vi.fn(),
}));
```

- [ ] **Step 6: Rodar os testes**

Run:
```bash
npx vitest run src/services/flow.service.test.ts
npm run test
npm run typecheck
```
Expected: todos os testes verdes (incluindo os 3 novos e os de sweep existentes), sem erros de tipo.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/flow.service.ts backend/src/services/flow.service.test.ts
git commit -m "feat: fluxo reconhece modo DISPARO como já-conectado"
```

---

### Task 4: `broadcast.service` — varredura, seleção e contagem

**Files:**
- Create: `backend/src/services/broadcast.service.ts`
- Create: `backend/src/services/broadcast.service.test.ts`

**Interfaces:**
- Consumes: `prisma`, `importLeadsFromSweep` (de `./sweep.service`), `notify` (de `./notification.service`), `ApiError`.
- Produces:
  - `importBroadcastLeads(campaignId: string): Promise<{ imported: number; total: number }>`
  - `type SelectAction = "replace" | "all" | "none" | "toggle"`
  - `setLeadSelection(campaignId: string, action: SelectAction, providerIds?: string[]): Promise<number>`
  - `getSelectionCount(campaignId: string): Promise<{ selected: number; total: number }>`

- [ ] **Step 1: Escrever os testes que falham**

Create `backend/src/services/broadcast.service.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/prisma", () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    account: { findUnique: vi.fn() },
    lead: { updateMany: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  },
}));

vi.mock("./sweep.service", () => ({
  importLeadsFromSweep: vi.fn(),
}));

vi.mock("./notification.service", () => ({
  notify: vi.fn(),
}));

import { prisma } from "../lib/prisma";
import { importLeadsFromSweep } from "./sweep.service";
import { notify } from "./notification.service";
import {
  importBroadcastLeads,
  setLeadSelection,
  getSelectionCount,
} from "./broadcast.service";
import { ApiError } from "../utils/errors";
import type { Campaign, Account } from "@prisma/client";

const campaignFind = prisma.campaign.findUnique as ReturnType<typeof vi.fn>;
const accountFind = prisma.account.findUnique as ReturnType<typeof vi.fn>;
const updateMany = prisma.lead.updateMany as ReturnType<typeof vi.fn>;
const findMany = prisma.lead.findMany as ReturnType<typeof vi.fn>;
const leadCount = prisma.lead.count as ReturnType<typeof vi.fn>;
const importSweep = importLeadsFromSweep as ReturnType<typeof vi.fn>;
const notifyFn = notify as ReturnType<typeof vi.fn>;

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: "C1",
    name: "Disparo teste",
    mode: "DISPARO",
    searchUrl: "DISPARO",
    status: "DRAFT",
    accountId: "A1",
    inviteMessage: "Olá {nome}!",
    dailyLimit: 40,
    weeklyLimit: 150,
    minDelayMin: 5,
    maxDelayMin: 15,
    workStartHour: 9,
    workEndHour: 18,
    chatbotEnabled: false,
    chatbotRules: "[]",
    chatbotDefaultReply: "",
    chatbotReplyDelayMin: 1,
    chatbotReplyDelayMax: 3,
    chatbotStopKeywords: "[]",
    maxRepliesPerLead: 3,
    flow: "",
    invitesSentToday: 0,
    dateOfInviteCount: null,
    invitesSentWeek: 0,
    weekStartDate: null,
    maxLeads: 1000,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Campaign;
}

const account: Account = {
  id: "A1",
  unipileAccountId: "UA1",
  provider: "LINKEDIN",
  username: "arcanjo",
  authMethod: "NATIVE",
  status: "OK",
  checkpointType: null,
  credentialsEnc: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as Account;

describe("importBroadcastLeads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountFind.mockResolvedValue(account);
    importSweep.mockResolvedValue({ imported: 110, total: 110 });
  });

  it("importa as relações e notifica", async () => {
    campaignFind.mockResolvedValue(campaign());
    const res = await importBroadcastLeads("C1");
    expect(importSweep).toHaveBeenCalledWith(expect.objectContaining({ id: "C1" }));
    expect(res).toEqual({ imported: 110, total: 110 });
    expect(notifyFn).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: "C1", type: "BROADCAST_IMPORT" }),
    );
  });

  it("recusa quando o disparo já foi iniciado", async () => {
    campaignFind.mockResolvedValue(campaign({ status: "RUNNING" }));
    await expect(importBroadcastLeads("C1")).rejects.toThrow(ApiError);
    expect(importSweep).not.toHaveBeenCalled();
  });

  it("recusa conta desconectada", async () => {
    campaignFind.mockResolvedValue(campaign());
    accountFind.mockResolvedValue({ ...account, status: "DISCONNECTED" });
    await expect(importBroadcastLeads("C1")).rejects.toThrow("desconectada");
  });
});

describe("setLeadSelection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    campaignFind.mockResolvedValue(campaign());
    leadCount.mockResolvedValue(7);
  });

  it("seleciona todos", async () => {
    const selected = await setLeadSelection("C1", "all");
    expect(updateMany).toHaveBeenCalledWith({
      where: { campaignId: "C1" },
      data: { selected: true },
    });
    expect(selected).toBe(7);
  });

  it("desmarca todos", async () => {
    await setLeadSelection("C1", "none");
    expect(updateMany).toHaveBeenCalledWith({
      where: { campaignId: "C1" },
      data: { selected: false },
    });
  });

  it("alterna um conjunto (toggle)", async () => {
    findMany.mockResolvedValue([{ providerId: "P1", selected: false }]);
    await setLeadSelection("C1", "toggle", ["P1"]);
    expect(updateMany).toHaveBeenCalledWith({
      where: { campaignId: "C1", providerId: { in: ["P1"] } },
      data: { selected: true },
    });
  });

  it("substitui a seleção (replace)", async () => {
    await setLeadSelection("C1", "replace", ["P1", "P2"]);
    expect(updateMany).toHaveBeenCalledWith({
      where: { campaignId: "C1" },
      data: { selected: false },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { campaignId: "C1", providerId: { in: ["P1", "P2"] } },
      data: { selected: true },
    });
  });

  it("recusa disparo já iniciado", async () => {
    campaignFind.mockResolvedValue(campaign({ status: "RUNNING" }));
    await expect(setLeadSelection("C1", "all")).rejects.toThrow(ApiError);
  });
});

describe("getSelectionCount", () => {
  it("retorna selecionados e total", async () => {
    leadCount.mockResolvedValueOnce(10).mockResolvedValueOnce(110);
    const res = await getSelectionCount("C1");
    expect(res).toEqual({ selected: 10, total: 110 });
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run:
```bash
npx vitest run src/services/broadcast.service.test.ts
```
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar o serviço**

Create `backend/src/services/broadcast.service.ts`:

```ts
import { prisma } from "../lib/prisma";
import { importLeadsFromSweep } from "./sweep.service";
import { notify } from "./notification.service";
import { ApiError } from "../utils/errors";

const STARTED_STATUSES = ["RUNNING", "IMPORTING", "COMPLETED"];

export async function importBroadcastLeads(
  campaignId: string,
): Promise<{ imported: number; total: number }> {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new ApiError(404, "Campanha não encontrada");
  if (campaign.mode !== "DISPARO") {
    throw new ApiError(400, "Operação disponível apenas para disparos em massa.");
  }
  if (STARTED_STATUSES.includes(campaign.status)) {
    throw new ApiError(400, "O disparo já foi iniciado. Pause para alterar a seleção.");
  }

  const account = await prisma.account.findUnique({ where: { id: campaign.accountId } });
  if (!account) throw new ApiError(400, "Conta vinculada não encontrada");
  if (account.status === "DISCONNECTED") {
    throw new ApiError(400, "Conta LinkedIn desconectada. Reconecte antes de varrer a rede.");
  }

  const { imported, total } = await importLeadsFromSweep(campaign);
  await notify({
    accountId: campaign.accountId,
    campaignId: campaign.id,
    type: "BROADCAST_IMPORT",
    level: "INFO",
    message: `Varredura concluída: ${imported} conexões importadas para o disparo "${campaign.name}".`,
    payload: { imported, total },
  });
  return { imported, total };
}

export type SelectAction = "replace" | "all" | "none" | "toggle";

export async function setLeadSelection(
  campaignId: string,
  action: SelectAction,
  providerIds: string[] = [],
): Promise<number> {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new ApiError(404, "Campanha não encontrada");
  if (campaign.mode !== "DISPARO") {
    throw new ApiError(400, "Operação disponível apenas para disparos em massa.");
  }
  if (STARTED_STATUSES.includes(campaign.status)) {
    throw new ApiError(400, "O disparo já foi iniciado. Pause para alterar a seleção.");
  }

  switch (action) {
    case "all":
      await prisma.lead.updateMany({ where: { campaignId }, data: { selected: true } });
      break;
    case "none":
      await prisma.lead.updateMany({ where: { campaignId }, data: { selected: false } });
      break;
    case "toggle": {
      if (providerIds.length === 0) break;
      const leads = await prisma.lead.findMany({
        where: { campaignId, providerId: { in: providerIds } },
        select: { providerId: true, selected: true },
      });
      const toOn = leads.filter((l) => !l.selected).map((l) => l.providerId);
      const toOff = leads.filter((l) => l.selected).map((l) => l.providerId);
      if (toOn.length > 0) {
        await prisma.lead.updateMany({
          where: { campaignId, providerId: { in: toOn } },
          data: { selected: true },
        });
      }
      if (toOff.length > 0) {
        await prisma.lead.updateMany({
          where: { campaignId, providerId: { in: toOff } },
          data: { selected: false },
        });
      }
      break;
    }
    case "replace": {
      await prisma.lead.updateMany({ where: { campaignId }, data: { selected: false } });
      if (providerIds.length > 0) {
        await prisma.lead.updateMany({
          where: { campaignId, providerId: { in: providerIds } },
          data: { selected: true },
        });
      }
      break;
    }
    default:
      throw new ApiError(400, "Ação de seleção inválida");
  }

  return prisma.lead.count({ where: { campaignId, selected: true } });
}

export async function getSelectionCount(
  campaignId: string,
): Promise<{ selected: number; total: number }> {
  const [selected, total] = await Promise.all([
    prisma.lead.count({ where: { campaignId, selected: true } }),
    prisma.lead.count({ where: { campaignId } }),
  ]);
  return { selected, total };
}
```

- [ ] **Step 4: Rodar os testes para passar**

Run:
```bash
npx vitest run src/services/broadcast.service.test.ts
npm run typecheck
```
Expected: todos passam, sem erros de tipo.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/broadcast.service.ts backend/src/services/broadcast.service.test.ts
git commit -m "feat: broadcast.service com varredura, seleção de leads e contagem"
```

---

### Task 5: Rotas de campanhas — modo DISPARO, sweep, seleção e filtros de leads

**Files:**
- Modify: `backend/src/routes/campaigns.routes.ts`

**Interfaces:**
- Consumes: `importBroadcastLeads`, `setLeadSelection` (Task 4); `Prisma` do `@prisma/client`.
- Produces: `POST /api/campaigns` aceita `mode: "DISPARO"`; `POST /api/campaigns/:id/sweep`; `POST /api/campaigns/:id/leads/select`; `GET /api/campaigns/:id/leads/selection`; `GET /api/campaigns/:id/leads` com `selected` e `q`; `stats.selected` em `GET /` e `GET /:id`.

- [ ] **Step 1: Adicionar `DISPARO` ao schema de criação**

Em `backend/src/routes/campaigns.routes.ts`, trocar:
```ts
  mode: z.enum(["SEARCH", "SWEEP"]).default("SEARCH"),
```
por:
```ts
  mode: z.enum(["SEARCH", "SWEEP", "DISPARO"]).default("SEARCH"),
```

- [ ] **Step 2: Ajustar a validação no `POST /`**

Em `POST /`, substituir o bloco:
```ts
    if (body.mode === "SWEEP") {
      const hasFlowNodes = (body.flow?.nodes?.length ?? 0) > 0;
      const hasMessage = Boolean((body.inviteMessage ?? "").trim());
      if (!hasFlowNodes && !hasMessage) {
        throw new ApiError(400, "Defina a mensagem de varredura ou crie um fluxo de mensagens.");
      }
      body.searchUrl = "SWEEP";
    } else if (!body.searchUrl) {
      throw new ApiError(400, "URL da busca é obrigatória");
    }
```
por:
```ts
    if (body.mode === "SWEEP" || body.mode === "DISPARO") {
      const hasFlowNodes = (body.flow?.nodes?.length ?? 0) > 0;
      const hasMessage = Boolean((body.inviteMessage ?? "").trim());
      if (!hasFlowNodes && !hasMessage) {
        throw new ApiError(
          400,
          body.mode === "DISPARO"
            ? "Defina a mensagem do disparo ou crie um fluxo de mensagens."
            : "Defina a mensagem de varredura ou crie um fluxo de mensagens.",
        );
      }
      body.searchUrl = body.mode === "DISPARO" ? "DISPARO" : "SWEEP";
    } else if (!body.searchUrl) {
      throw new ApiError(400, "URL da busca é obrigatória");
    }
```

- [ ] **Step 3: Adicionar import de `Prisma` e dos serviços**

No topo do arquivo, adicionar:
```ts
import { Prisma } from "@prisma/client";
import { importBroadcastLeads, setLeadSelection } from "../services/broadcast.service";
```

- [ ] **Step 4: Incluir `selected` no `withStats`**

Substituir o corpo de `withStats` (trecho do `groupBy`) por:
```ts
  const [groups, selectedCount] = await Promise.all([
    prisma.lead.groupBy({
      by: ["status"],
      where: { campaignId },
      _count: { _all: true },
    }),
    prisma.lead.count({ where: { campaignId, selected: true } }),
  ]);
  const stats: Record<string, number> = { total: 0 };
  for (const g of groups) {
    stats[g.status] = g._count._all;
    stats.total += g._count._all;
  }
  stats.selected = selectedCount;
```

- [ ] **Step 5: Incluir `selected` na listagem `GET /`**

Substituir o trecho do `groupBy` da listagem por:
```ts
    const groups = await prisma.lead.groupBy({
      by: ["campaignId", "status"],
      _count: { _all: true },
    });
    const selectedGroups = await prisma.lead.groupBy({
      by: ["campaignId"],
      where: { selected: true },
      _count: { _all: true },
    });
    const statsByCampaign: Record<string, Record<string, number>> = {};
    for (const g of groups) {
      statsByCampaign[g.campaignId] ??= {};
      statsByCampaign[g.campaignId][g.status] = g._count._all;
    }
    const selectedByCampaign: Record<string, number> = {};
    for (const g of selectedGroups) selectedByCampaign[g.campaignId] = g._count._all;

    res.json({
      items: campaigns.map((c) => ({
        ...c,
        stats: {
          ...(statsByCampaign[c.id] ?? {}),
          total: c._count.leads,
          selected: selectedByCampaign[c.id] ?? 0,
        },
      })),
    });
```

- [ ] **Step 6: Adicionar as rotas de sweep, seleção e contagem**

Logo após a rota `POST /:id/resume`, adicionar:

```ts
campaignsRouter.post(
  "/:id/sweep",
  ah(async (req, res) => {
    const result = await importBroadcastLeads(req.params.id);
    res.json(result);
  }),
);

campaignsRouter.get(
  "/:id/leads/selection",
  ah(async (req, res) => {
    const campaign = await prisma.campaign.findUnique({ where: { id: req.params.id } });
    if (!campaign) throw new ApiError(404, "Campanha não encontrada");
    const [selected, total] = await Promise.all([
      prisma.lead.count({ where: { campaignId: req.params.id, selected: true } }),
      prisma.lead.count({ where: { campaignId: req.params.id } }),
    ]);
    res.json({ selected, total });
  }),
);

const selectSchema = z.object({
  action: z.enum(["replace", "all", "none", "toggle"]),
  providerIds: z.array(z.string()).default([]),
});

campaignsRouter.post(
  "/:id/leads/select",
  ah(async (req, res) => {
    const { action, providerIds } = selectSchema.parse(req.body);
    const selected = await setLeadSelection(req.params.id, action, providerIds);
    res.json({ selected });
  }),
);
```

- [ ] **Step 7: Adicionar filtros `selected` e `q` em `GET /:id/leads`**

Substituir o trecho que monta `where`:
```ts
    const where = { campaignId: req.params.id, ...(status ? { status } : {}) };
```
por:
```ts
    const where: Prisma.LeadWhereInput = { campaignId: req.params.id };
    if (status) where.status = status;
    const sel = req.query.selected;
    if (sel === "true" || sel === "false") where.selected = sel === "true";
    if (typeof req.query.q === "string" && req.query.q.trim()) {
      where.OR = [{ name: { contains: req.query.q.trim() } }];
    }
```

- [ ] **Step 8: Rodar testes e typecheck**

Run:
```bash
npm run test
npm run typecheck
```
Expected: suítes verdes, sem erros de tipo.

- [ ] **Step 9: Commit**

```bash
git add backend/src/routes/campaigns.routes.ts
git commit -m "feat: rotas de disparo (sweep, seleção, contagem) e filtros de leads"
```

---

### Task 6: `campaign.service` — start/resume de DISPARO

**Files:**
- Modify: `backend/src/services/campaign.service.ts`
- Create: `backend/src/services/campaign.service.test.ts`

**Interfaces:**
- Consumes: `notify` (Task 2).
- Produces: `startCampaign`/`resumeCampaign` com ramo `DISPARO` (sem enfileirar busca; `start` valida ≥1 lead selecionado).

- [ ] **Step 1: Escrever os testes que falham**

Create `backend/src/services/campaign.service.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/prisma", () => ({
  prisma: {
    campaign: { findUnique: vi.fn(), update: vi.fn() },
    account: { findUnique: vi.fn() },
    lead: { count: vi.fn() },
  },
}));

vi.mock("./queue.service", () => ({ searchQueue: { add: vi.fn() } }));
vi.mock("./log.service", () => ({ createLog: vi.fn() }));
vi.mock("./notification.service", () => ({ notify: vi.fn() }));

import { prisma } from "../lib/prisma";
import { searchQueue } from "./queue.service";
import { notify } from "./notification.service";
import { startCampaign, resumeCampaign } from "./campaign.service";
import { ApiError } from "../utils/errors";
import type { Campaign, Account } from "@prisma/client";

const campaignFind = prisma.campaign.findUnique as ReturnType<typeof vi.fn>;
const campaignUpdate = prisma.campaign.update as ReturnType<typeof vi.fn>;
const accountFind = prisma.account.findUnique as ReturnType<typeof vi.fn>;
const leadCount = prisma.lead.count as ReturnType<typeof vi.fn>;
const searchAdd = searchQueue.add as ReturnType<typeof vi.fn>;
const notifyFn = notify as ReturnType<typeof vi.fn>;

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: "C1",
    name: "Campanha",
    mode: "SEARCH",
    searchUrl: "https://linkedin.com/search",
    status: "DRAFT",
    accountId: "A1",
    inviteMessage: "",
    dailyLimit: 40,
    weeklyLimit: 150,
    minDelayMin: 5,
    maxDelayMin: 15,
    workStartHour: 9,
    workEndHour: 18,
    chatbotEnabled: false,
    chatbotRules: "[]",
    chatbotDefaultReply: "",
    chatbotReplyDelayMin: 1,
    chatbotReplyDelayMax: 3,
    chatbotStopKeywords: "[]",
    maxRepliesPerLead: 3,
    flow: "",
    invitesSentToday: 0,
    dateOfInviteCount: null,
    invitesSentWeek: 0,
    weekStartDate: null,
    maxLeads: 1000,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Campaign;
}

const account: Account = {
  id: "A1",
  unipileAccountId: "UA1",
  provider: "LINKEDIN",
  username: "arcanjo",
  authMethod: "NATIVE",
  status: "OK",
  checkpointType: null,
  credentialsEnc: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as Account;

describe("startCampaign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountFind.mockResolvedValue(account);
  });

  it("inicia DISPARO direto quando há ao menos um contato selecionado", async () => {
    campaignFind.mockResolvedValue(campaign({ mode: "DISPARO", searchUrl: "DISPARO" }));
    leadCount.mockResolvedValue(5);
    await startCampaign("C1");
    expect(campaignUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "C1" }, data: { status: "RUNNING" } }),
    );
    expect(searchAdd).not.toHaveBeenCalled();
    expect(notifyFn).toHaveBeenCalledWith(expect.objectContaining({ type: "BROADCAST_STARTED" }));
  });

  it("recusa DISPARO sem contatos selecionados", async () => {
    campaignFind.mockResolvedValue(campaign({ mode: "DISPARO", searchUrl: "DISPARO" }));
    leadCount.mockResolvedValue(0);
    await expect(startCampaign("C1")).rejects.toThrow(ApiError);
    expect(campaignUpdate).not.toHaveBeenCalled();
  });

  it("mantém o fluxo de importação para SEARCH", async () => {
    campaignFind.mockResolvedValue(campaign());
    await startCampaign("C1");
    expect(campaignUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "IMPORTING" } }),
    );
    expect(searchAdd).toHaveBeenCalledWith("search", { campaignId: "C1" });
  });
});

describe("resumeCampaign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retoma DISPARO direto, sem reimportar", async () => {
    campaignFind.mockResolvedValue(campaign({ mode: "DISPARO", searchUrl: "DISPARO" }));
    await resumeCampaign("C1");
    expect(campaignUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "RUNNING" } }),
    );
    expect(searchAdd).not.toHaveBeenCalled();
  });

  it("reimporta SEARCH ao retomar", async () => {
    campaignFind.mockResolvedValue(campaign());
    await resumeCampaign("C1");
    expect(campaignUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "IMPORTING" } }),
    );
    expect(searchAdd).toHaveBeenCalledWith("search", { campaignId: "C1" });
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run:
```bash
npx vitest run src/services/campaign.service.test.ts
```
Expected: FAIL (comportamento atual não inicia direto).

- [ ] **Step 3: Implementar o ramo DISPARO**

Em `backend/src/services/campaign.service.ts`, adicionar import:
```ts
import { notify } from "./notification.service";
```

Em `startCampaign`, logo após a checagem de conta desconectada, inserir:
```ts
  if (campaign.mode === "DISPARO") {
    const selected = await prisma.lead.count({ where: { campaignId: id, selected: true } });
    if (selected === 0) {
      throw new ApiError(400, "Selecione ao menos um contato antes de iniciar o disparo.");
    }
    await prisma.campaign.update({ where: { id }, data: { status: "RUNNING" } });
    await createLog({
      type: "CAMPAIGN_STARTED",
      message: `Disparo "${campaign.name}" iniciado (${selected} contatos)`,
      campaignId: id,
    });
    await notify({
      accountId: campaign.accountId,
      campaignId: id,
      type: "BROADCAST_STARTED",
      level: "INFO",
      message: `Disparo "${campaign.name}" iniciado para ${selected} contatos.`,
      payload: { selected },
    });
    return;
  }
```

Em `resumeCampaign`, logo após a checagem de existência, inserir:
```ts
  if (campaign.mode === "DISPARO") {
    await prisma.campaign.update({ where: { id }, data: { status: "RUNNING" } });
    await createLog({
      type: "CAMPAIGN_STARTED",
      message: `Disparo "${campaign.name}" retomado`,
      campaignId: id,
    });
    return;
  }
```

- [ ] **Step 4: Rodar testes e typecheck**

Run:
```bash
npx vitest run src/services/campaign.service.test.ts
npm run test
npm run typecheck
```
Expected: todos passam.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/campaign.service.ts backend/src/services/campaign.service.test.ts
git commit -m "feat: start/resume de disparo sem reimportar e validação de seleção"
```

---

### Task 7: Scheduler e workers — DISPARO envia só para selecionados

**Files:**
- Modify: `backend/src/scheduler.ts`
- Modify: `backend/src/workers/sweep.worker.ts`
- Modify: `backend/src/workers/search.worker.ts`
- Modify: `backend/src/services/sweep.service.ts`
- Modify: `backend/src/services/sweep.service.test.ts`
- Create: `backend/src/scheduler.test.ts`

**Interfaces:**
- Consumes: `notify` (Task 2), `importLeadsFromSweep` (existente), `selected` (Task 1).
- Produces: export `processBroadcastCampaign(campaign: Campaign): Promise<void>` em `scheduler.ts`.

- [ ] **Step 1: Escrever os testes do scheduler que falham**

Create `backend/src/scheduler.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/prisma", () => ({
  prisma: {
    campaign: { findMany: vi.fn(), update: vi.fn() },
    lead: { findFirst: vi.fn(), count: vi.fn(), update: vi.fn() },
    account: { findUnique: vi.fn() },
  },
}));

vi.mock("./services/invite.service", () => ({
  refreshCounters: vi.fn(),
  withinLimits: vi.fn(),
}));

vi.mock("./services/queue.service", () => ({
  invitesQueue: { add: vi.fn() },
  sweepQueue: { add: vi.fn() },
}));

vi.mock("./services/flow.service", () => ({
  hasFlow: vi.fn(() => false),
  parseFlow: vi.fn(),
  processFlowStep: vi.fn(),
}));

vi.mock("./services/log.service", () => ({ createLog: vi.fn() }));
vi.mock("./services/notification.service", () => ({ notify: vi.fn() }));

vi.mock("./utils/time", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./utils/time")>();
  return { ...actual, isWorkHour: () => true, randomDelayMs: () => 300_000 };
});

import { prisma } from "../lib/prisma";
import { refreshCounters, withinLimits } from "./services/invite.service";
import { sweepQueue } from "./services/queue.service";
import { notify } from "./services/notification.service";
import { processBroadcastCampaign } from "./scheduler";
import type { Campaign, Account, Lead } from "@prisma/client";

const leadFindFirst = prisma.lead.findFirst as ReturnType<typeof vi.fn>;
const leadCount = prisma.lead.count as ReturnType<typeof vi.fn>;
const campaignUpdate = prisma.campaign.update as ReturnType<typeof vi.fn>;
const accountFind = prisma.account.findUnique as ReturnType<typeof vi.fn>;
const refresh = refreshCounters as ReturnType<typeof vi.fn>;
const within = withinLimits as ReturnType<typeof vi.fn>;
const sweepAdd = sweepQueue.add as ReturnType<typeof vi.fn>;
const notifyFn = notify as ReturnType<typeof vi.fn>;

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: "C1",
    name: "Disparo",
    mode: "DISPARO",
    searchUrl: "DISPARO",
    status: "RUNNING",
    accountId: "A1",
    inviteMessage: "Olá {nome}!",
    dailyLimit: 40,
    weeklyLimit: 150,
    minDelayMin: 5,
    maxDelayMin: 15,
    workStartHour: 9,
    workEndHour: 18,
    chatbotEnabled: false,
    chatbotRules: "[]",
    chatbotDefaultReply: "",
    chatbotReplyDelayMin: 1,
    chatbotReplyDelayMax: 3,
    chatbotStopKeywords: "[]",
    maxRepliesPerLead: 3,
    flow: "",
    invitesSentToday: 0,
    dateOfInviteCount: null,
    invitesSentWeek: 0,
    weekStartDate: null,
    maxLeads: 1000,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Campaign;
}

const account: Account = {
  id: "A1",
  unipileAccountId: "UA1",
  provider: "LINKEDIN",
  username: "arcanjo",
  authMethod: "NATIVE",
  status: "OK",
  checkpointType: null,
  credentialsEnc: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as Account;

describe("processBroadcastCampaign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refresh.mockImplementation((c: Campaign) => Promise.resolve(c));
    within.mockReturnValue(true);
    accountFind.mockResolvedValue(account);
  });

  it("agenda apenas leads selecionados para DISPARO", async () => {
    leadFindFirst.mockResolvedValue({ id: "L1", campaignId: "C1" } as Lead);
    await processBroadcastCampaign(campaign());
    expect(leadFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ selected: true }) }),
    );
    expect(sweepAdd).toHaveBeenCalledWith("sweep", { leadId: "L1", campaignId: "C1" }, expect.anything());
  });

  it("não filtra por selected em SWEEP legado", async () => {
    leadFindFirst.mockResolvedValue({ id: "L1", campaignId: "C1" } as Lead);
    await processBroadcastCampaign(campaign({ mode: "SWEEP", searchUrl: "SWEEP" }));
    expect(leadFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.not.objectContaining({ selected: true }) }),
    );
  });

  it("completa DISPARO quando não restam selecionados", async () => {
    leadFindFirst.mockResolvedValue(null);
    leadCount.mockResolvedValue(0);
    await processBroadcastCampaign(campaign());
    expect(campaignUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "COMPLETED" } }),
    );
    expect(notifyFn).toHaveBeenCalledWith(expect.objectContaining({ type: "BROADCAST_COMPLETED" }));
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run:
```bash
npx vitest run src/scheduler.test.ts
```
Expected: FAIL (símbolo não exportado).

- [ ] **Step 3: Implementar no scheduler**

Em `backend/src/scheduler.ts`:

1. Adicionar import:
```ts
import { notify } from "./services/notification.service";
```

2. Em `processCampaigns`, substituir o corpo do `for` por:
```ts
  for (const campaign of campaigns) {
    try {
      const connected = campaign.mode === "SWEEP" || campaign.mode === "DISPARO";
      if (connected) {
        if (hasFlow(campaign.flow)) {
          await processFlowCampaign(campaign);
        } else {
          await processBroadcastCampaign(campaign);
        }
        continue;
      }
      if (hasFlow(campaign.flow)) {
        await processFlowCampaign(campaign);
      } else {
        await processInviteCampaign(campaign);
      }
    } catch (err) {
      logger.error(`scheduler error for campaign ${campaign.id}`, err);
    }
  }
```

3. Renomear `processSweepCampaign` para `processBroadcastCampaign` e torná-la `export`:
```ts
export async function processBroadcastCampaign(campaign: Campaign): Promise<void> {
```
4. Nessa função, adicionar logo após `const now = new Date();`:
```ts
  const selectedFilter = campaign.mode === "DISPARO" ? { selected: true } : {};
```
5. No bloco de limite semanal, substituir o `createLog` por (mantendo o update):
```ts
    await createLog({
      type: "RATE_LIMITED",
      level: "WARN",
      message: `Limite semanal de ${fresh.weeklyLimit} mensagens atingido. Disparo pausado.`,
      campaignId: fresh.id,
    });
    await notify({
      accountId: fresh.accountId,
      campaignId: fresh.id,
      type: "BROADCAST_LIMIT_HIT",
      level: "WARN",
      message: `Disparo "${fresh.name}" pausado: limite semanal de ${fresh.weeklyLimit} mensagens atingido.`,
    });
```
6. Na query `due`, adicionar `...selectedFilter`:
```ts
  const due = await prisma.lead.findFirst({
    where: {
      campaignId: fresh.id,
      status: "PENDING",
      currentBlockId: null,
      ...selectedFilter,
      OR: [{ nextInviteAt: null }, { nextInviteAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
  });
```
7. No bloco `!due`, na query `remaining`, adicionar `...selectedFilter` e, ao completar, notificar:
```ts
  if (!due) {
    const remaining = await prisma.lead.count({
      where: { campaignId: fresh.id, status: "PENDING", currentBlockId: null, ...selectedFilter },
    });
    if (remaining === 0) {
      await prisma.campaign.update({ where: { id: fresh.id }, data: { status: "COMPLETED" } });
      await createLog({
        type: "CAMPAIGN_COMPLETED",
        message: `Disparo "${fresh.name}" concluído`,
        campaignId: fresh.id,
      });
      await notify({
        accountId: fresh.accountId,
        campaignId: fresh.id,
        type: "BROADCAST_COMPLETED",
        level: "INFO",
        message: `Disparo "${fresh.name}" concluído com sucesso.`,
      });
      logger.info(`Campaign ${fresh.id} completed (broadcast)`);
    }
    return;
  }
```
8. Em `processFlowCampaign`, adicionar logo após `const now = new Date();`:
```ts
  const selectedFilter = fresh.mode === "DISPARO" ? { selected: true } : {};
```
9. Na query `due` de `processFlowCampaign`, adicionar `...selectedFilter,` após a linha do `status: {...}`; e na query `active`, adicionar `...selectedFilter,` após o `status: {...}`.
10. No limite semanal de `processFlowCampaign`, após o `createLog`, adicionar notify:
```ts
    await notify({
      accountId: fresh.accountId,
      campaignId: fresh.id,
      type: "BROADCAST_LIMIT_HIT",
      level: "WARN",
      message: `Campanha "${fresh.name}" pausada: limite semanal de ${fresh.weeklyLimit} ações atingido.`,
    });
```
11. No bloco `active === 0` de `processFlowCampaign`, após o `createLog`/`logger.info`, adicionar notify:
```ts
      await notify({
        accountId: fresh.accountId,
        campaignId: fresh.id,
        type: "BROADCAST_COMPLETED",
        level: "INFO",
        message: `Disparo "${fresh.name}" concluído com sucesso.`,
      });
```

- [ ] **Step 4: Atualizar o sweep worker**

Em `backend/src/workers/sweep.worker.ts`:

1. Substituir a checagem de modo:
```ts
    if (campaign.mode !== "SWEEP") {
      logger.info(`Skipping sweep for lead ${leadId}: campaign is not a sweep campaign`);
      return;
    }
```
por:
```ts
    if (campaign.mode !== "SWEEP" && campaign.mode !== "DISPARO") {
      logger.info(`Skipping sweep for lead ${leadId}: campaign is not a sweep/broadcast campaign`);
      return;
    }
```
2. Após a checagem do lead (`if (!lead || lead.status !== "PENDING" || lead.currentBlockId !== null) return;`), adicionar:
```ts
    if (campaign.mode === "DISPARO" && !lead.selected) {
      logger.info(`Skipping sweep for lead ${leadId}: lead not selected for broadcast`);
      return;
    }
```

- [ ] **Step 5: Atualizar o search worker**

Em `backend/src/workers/search.worker.ts`, trocar as duas ocorrências de `campaign.mode === "SWEEP"` por `campaign.mode === "SWEEP" || campaign.mode === "DISPARO"` (na chamada de import e na mensagem do log).

- [ ] **Step 6: Notificar limite no `sendSweepMessage`**

Em `backend/src/services/sweep.service.ts`:
1. Adicionar import:
```ts
import { notify } from "./notification.service";
```
2. No ramo `isLimitError()` de `sendSweepMessage`, antes do `createLog`:
```ts
      await notify({
        accountId: campaign.accountId,
        campaignId: campaign.id,
        type: "BROADCAST_LIMIT_HIT",
        level: "WARN",
        message: `Limite do LinkedIn atingido (${err.errorType}). Disparo pausado.`,
        payload: { error: err.message },
      });
```

- [ ] **Step 7: Atualizar o mock do teste de sweep**

Em `backend/src/services/sweep.service.test.ts`, adicionar após `vi.mock("./log.service", ...)`:
```ts
vi.mock("./notification.service", () => ({
  notify: vi.fn(),
}));
```

- [ ] **Step 8: Rodar testes e typecheck**

Run:
```bash
npm run test
npm run typecheck
```
Expected: todas as suítes verdes (inclui scheduler com 3 testes novos e regressões de sweep).

- [ ] **Step 9: Commit**

```bash
git add backend/src/scheduler.ts backend/src/workers/sweep.worker.ts backend/src/workers/search.worker.ts backend/src/services/sweep.service.ts backend/src/services/sweep.service.test.ts backend/src/scheduler.test.ts
git commit -m "feat: scheduler e workers enviam disparo só para leads selecionados"
```

---

### Task 8: Tipos do frontend e formato

**Files:**
- Modify: `frontend/src/types.ts`

**Interfaces:**
- Produces: `Campaign.mode` inclui `"DISPARO"`; `Lead.selected: boolean`; `Notification`; `NotificationsResponse`.

- [ ] **Step 1: Atualizar `types.ts`**

Em `frontend/src/types.ts`:

1. No `Campaign`, trocar:
```ts
  mode: "SEARCH" | "SWEEP";
```
por:
```ts
  mode: "SEARCH" | "SWEEP" | "DISPARO";
```
2. No `CampaignPayload`, trocar:
```ts
  mode?: "SEARCH" | "SWEEP";
```
por:
```ts
  mode?: "SEARCH" | "SWEEP" | "DISPARO";
```
3. No `Lead`, adicionar `selected: boolean;` após `status: LeadStatus;`.
4. Adicionar ao fim do arquivo:
```ts
export interface Notification {
  id: string;
  accountId: string | null;
  campaignId: string | null;
  type: string;
  level: "INFO" | "WARN" | "ERROR";
  message: string;
  payload: string | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationsResponse {
  items: Notification[];
  unread: number;
}
```

- [ ] **Step 2: Rodar typecheck**

Run:
```bash
npm run typecheck
```
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types.ts
git commit -m "feat: tipos de disparo, seleção e notificação no frontend"
```

---

### Task 9: `CampaignDetailPage` — detalhe de DISPARO

**Files:**
- Modify: `frontend/src/pages/CampaignDetailPage.tsx`

**Interfaces:**
- Consumes: `Campaign.stats.selected` (Task 5), `Lead.selected` (Task 8).
- Produces: página de detalhe ciente do modo `DISPARO` (voltar para `/disparos`, cards de métricas de resposta, coluna "Enviado em", indicador no rodapé).

- [ ] **Step 1: Back link e indicador de modo**

Em `CampaignDetailPage.tsx`, após o `const stats = useMemo(...)`, adicionar:
```tsx
  const isBroadcast = campaign?.mode === "DISPARO";
  const sentCount = (stats.completed ?? 0) + (stats.responded ?? 0);
  const replyRate = sentCount > 0 ? Math.round(((stats.responded ?? 0) / sentCount) * 100) : 0;
```

Trocar o link de voltar:
```tsx
      <Link to="/campanhas" className="mb-4 inline-flex items-center gap-1.5 text-sm text-cream/50 hover:text-gold-400">
```
por:
```tsx
      <Link to={isBroadcast ? "/disparos" : "/campanhas"} className="mb-4 inline-flex items-center gap-1.5 text-sm text-cream/50 hover:text-gold-400">
```

- [ ] **Step 2: Cards de estatísticas condicionais ao modo**

Substituir o bloco dos 6 `StatCard`s:
```tsx
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Leads" value={stats.total} accent />
        <StatCard label="Pendentes" value={stats.pending} />
        <StatCard label="Convidados" value={stats.invited} hint={`Hoje ${campaign.invitesSentToday}/${campaign.dailyLimit}`} />
        <StatCard label="Aceitos" value={stats.accepted} hint={`Semana ${campaign.invitesSentWeek}/${campaign.weeklyLimit}`} />
        <StatCard label="Respondidos" value={stats.responded} />
        <StatCard label="Concluídos" value={stats.completed} />
      </div>
```
por:
```tsx
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {isBroadcast ? (
          <>
            <StatCard label="Contatos" value={stats.total} accent />
            <StatCard label="Selecionados" value={campaign.stats?.selected ?? 0} />
            <StatCard label="Enviados" value={stats.completed} />
            <StatCard label="Respondidos" value={stats.responded} />
            <StatCard label="Falhas" value={stats.error} />
            <StatCard label="Resposta" value={replyRate > 0 ? `${replyRate}%` : "—"} accent />
          </>
        ) : (
          <>
            <StatCard label="Leads" value={stats.total} accent />
            <StatCard label="Pendentes" value={stats.pending} />
            <StatCard label="Convidados" value={stats.invited} hint={`Hoje ${campaign.invitesSentToday}/${campaign.dailyLimit}`} />
            <StatCard label="Aceitos" value={stats.accepted} hint={`Semana ${campaign.invitesSentWeek}/${campaign.weeklyLimit}`} />
            <StatCard label="Respondidos" value={stats.responded} />
            <StatCard label="Concluídos" value={stats.completed} />
          </>
        )}
      </div>
```

- [ ] **Step 3: Indicador no rodapé da ficha**

No bloco `{campaign.mode === "SWEEP" ? (...) : (...)}` (que mostra "Varredura da rede" ou "Abrir busca"), envolver por uma cadeia de três condições:
```tsx
        {campaign.mode === "DISPARO" ? (
          <span className="inline-flex items-center gap-1.5 text-cream/70">
            <Workflow className="h-4 w-4 text-gold-500" />
            Disparo em massa (envia para os contatos selecionados)
          </span>
        ) : campaign.mode === "SWEEP" ? (
          <span className="inline-flex items-center gap-1.5 text-cream/70">
            <Workflow className="h-4 w-4 text-gold-500" />
            Varredura da rede (envia mensagem para as conexões)
          </span>
        ) : (
          <a
            href={campaign.searchUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-cream/50 hover:text-gold-400"
          >
            Abrir busca <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
```

- [ ] **Step 4: Coluna "Enviado em" para DISPARO**

No cabeçalho da tabela de leads, trocar:
```tsx
                      <th className="table-header px-4 py-3">Convidado</th>
```
por:
```tsx
                      <th className="table-header px-4 py-3">{isBroadcast ? "Enviado em" : "Convidado"}</th>
```
e na célula correspondente, trocar:
```tsx
                        <td className="px-4 py-3 text-cream/50">{formatDateTime(lead.invitedAt)}</td>
```
por:
```tsx
                        <td className="px-4 py-3 text-cream/50">
                          {formatDateTime(isBroadcast ? lead.lastMessageAt : lead.invitedAt)}
                        </td>
```

- [ ] **Step 5: Rodar typecheck e build**

Run:
```bash
npm run typecheck
npm run build
```
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/CampaignDetailPage.tsx
git commit -m "feat: detalhe de disparo com métricas de resposta e coluna de envio"
```

---

### Task 10: `DisparosPage` — lista com progresso em tempo real

**Files:**
- Create: `frontend/src/pages/DisparosPage.tsx`
- Modify: `frontend/src/App.tsx` (rota)

**Interfaces:**
- Consumes: `GET /api/campaigns` (com `stats` e `stats.selected`), `Campaign.mode` (Task 8).
- Produces: rota `/disparos`; links para `/disparos/nova` e `/disparos/:id`.

- [ ] **Step 1: Criar a página**

Create `frontend/src/pages/DisparosPage.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCheck, Plus, Radar, Send, Users, XCircle } from "lucide-react";
import { api } from "../lib/api";
import type { Campaign } from "../types";
import { StatusBadge } from "../components/StatusBadge";
import { PageLoader } from "../components/Spinner";
import { formatDateTime, shortName } from "../lib/format";
import { useToast, toastFromError } from "../components/Toast";

const REFRESH_MS = 5_000;

export function DisparosPage() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const load = () => {
      api
        .get<{ items: Campaign[] }>("/campaigns")
        .then((r) => setCampaigns(r.items.filter((c) => c.mode === "DISPARO")))
        .catch((err) => toastFromError(toast, err));
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [toast]);

  if (!campaigns) return <PageLoader />;

  const replyRate = (c: Campaign): number | null => {
    const sent = (c.stats?.COMPLETED ?? 0) + (c.stats?.RESPONDED ?? 0);
    if (sent === 0) return null;
    return Math.round(((c.stats?.RESPONDED ?? 0) / sent) * 100);
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-semibold gold-gradient-text">Disparos</h1>
          <p className="mt-1 text-sm text-cream/50">
            Envie mensagens em massa para os contatos selecionados e acompanhe em tempo real
          </p>
        </div>
        <Link to="/disparos/nova" className="btn btn-primary">
          <Plus className="h-4 w-4" />
          Novo disparo
        </Link>
      </div>

      {campaigns.length === 0 ? (
        <div className="card flex flex-col items-center gap-4 px-6 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-gold-500/30 bg-gold-500/10">
            <Radar className="h-7 w-7 text-gold-500" />
          </div>
          <div>
            <h2 className="font-serif text-xl text-cream">Nenhum disparo ainda</h2>
            <p className="mt-1 max-w-sm text-sm text-cream/50">
              Crie um disparo, varra a rede da sua conta, selecione os contatos e envie uma
              mensagem pré-definida em massa.
            </p>
          </div>
          <Link to="/disparos/nova" className="btn btn-primary">
            <Plus className="h-4 w-4" />
            Criar primeiro disparo
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {campaigns.map((c) => {
            const rate = replyRate(c);
            return (
              <Link
                key={c.id}
                to={`/disparos/${c.id}`}
                className="card group p-5 transition-all duration-200 hover:border-gold-500/40 hover:shadow-gold"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-serif text-lg font-medium leading-snug text-cream group-hover:text-gold-400">
                    {c.name}
                  </h2>
                  <StatusBadge status={c.status} kind="campaign" />
                </div>
                <div className="mt-1 text-xs text-cream/40">
                  Conta: {shortName(c.account.username, "—")}
                </div>

                <div className="mt-5 grid grid-cols-3 gap-2 border-t border-ink-400 pt-4">
                  <div className="flex flex-col items-center gap-1 text-center">
                    <Send className="h-4 w-4 text-gold-500/70" />
                    <span className="text-lg font-semibold text-cream">
                      {c.stats?.COMPLETED ?? 0}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-cream/40">
                      Enviados
                    </span>
                  </div>
                  <div className="flex flex-col items-center gap-1 text-center">
                    <CheckCheck className="h-4 w-4 text-gold-500/70" />
                    <span className="text-lg font-semibold text-cream">
                      {c.stats?.RESPONDED ?? 0}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-cream/40">
                      Respondidos
                    </span>
                  </div>
                  <div className="flex flex-col items-center gap-1 text-center">
                    <XCircle className="h-4 w-4 text-gold-500/70" />
                    <span className="text-lg font-semibold text-cream">
                      {c.stats?.ERROR ?? 0}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-cream/40">
                      Falhas
                    </span>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between text-[11px] text-cream/40">
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />
                    {c.stats?.selected ?? 0}/{c.stats?.total ?? 0} contatos
                  </span>
                  {rate !== null && (
                    <span className="font-medium text-gold-400">{rate}% de resposta</span>
                  )}
                </div>

                <div className="mt-3 text-[11px] text-cream/30">
                  Criado em {formatDateTime(c.createdAt)}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Registrar a rota**

Em `frontend/src/App.tsx`, importar e registrar a rota:
```tsx
import { DisparosPage } from "./pages/DisparosPage";
```
e adicionar:
```tsx
            <Route path="/disparos" element={<DisparosPage />} />
```

- [ ] **Step 3: Rodar typecheck e build**

Run:
```bash
npm run typecheck
npm run build
```
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/DisparosPage.tsx frontend/src/App.tsx
git commit -m "feat: lista de disparos com progresso em tempo real"
```

---

### Task 11: `DisparoNewPage` — criação do disparo

**Files:**
- Create: `frontend/src/pages/DisparoNewPage.tsx`
- Modify: `frontend/src/App.tsx` (rota)

**Interfaces:**
- Consumes: `POST /api/campaigns` (mode `DISPARO`), `FlowEditor`, `emptyFlow`.
- Produces: rota `/disparos/nova`; navega para `/disparos/:id/selecionar`.

- [ ] **Step 1: Criar a página**

Create `frontend/src/pages/DisparoNewPage.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ChevronDown,
  Loader2,
  MessageSquare,
  Radar,
  Rocket,
  ShieldAlert,
  Workflow,
} from "lucide-react";
import { api } from "../lib/api";
import type { Account, CampaignPayload, Flow } from "../types";
import { FlowEditor } from "../components/FlowEditor";
import { emptyFlow } from "../lib/flow";
import { PageLoader } from "../components/Spinner";
import { useToast, toastFromError } from "../components/Toast";

const DEFAULT_MESSAGE =
  "Olá {nome}! Vi que já somos conectados aqui no LinkedIn e queria compartilhar uma oportunidade que pode ser interessante para você.";

export function DisparoNewPage() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [accountId, setAccountId] = useState("");

  const [name, setName] = useState("");
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [strategy, setStrategy] = useState({
    dailyLimit: 40,
    weeklyLimit: 150,
    minDelayMin: 5,
    maxDelayMin: 15,
    workStartHour: 9,
    workEndHour: 18,
    maxLeads: 2000,
  });
  const [useFlow, setUseFlow] = useState(false);
  const [flow, setFlow] = useState<Flow>(emptyFlow());
  const [flowOpen, setFlowOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const connected = useMemo(
    () => (accounts ?? []).filter((a) => a.status === "OK"),
    [accounts],
  );

  useEffect(() => {
    api
      .get<{ items: Account[] }>("/accounts")
      .then((r) => {
        setAccounts(r.items);
        const ok = r.items.filter((a) => a.status === "OK");
        if (ok.length > 0) setAccountId((cur) => cur || ok[0].id);
      })
      .catch(() => setAccounts([]));
  }, []);

  const setStrategyField = <K extends keyof typeof strategy>(key: K, value: number) =>
    setStrategy((s) => ({ ...s, [key]: value }));

  async function onCreate() {
    if (!accountId) {
      toast("error", "Selecione uma conta LinkedIn");
      return;
    }
    if (!message.trim() && !useFlow) {
      toast("error", "Escreva a mensagem que será enviada");
      return;
    }
    setSubmitting(true);
    try {
      const payload: CampaignPayload = {
        name:
          name.trim() ||
          `Disparo · ${new Date().toLocaleDateString("pt-BR")} · ${new Date().toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          })}`,
        mode: "DISPARO",
        accountId,
        inviteMessage: message,
        dailyLimit: strategy.dailyLimit,
        weeklyLimit: strategy.weeklyLimit,
        minDelayMin: strategy.minDelayMin,
        maxDelayMin: strategy.maxDelayMin,
        workStartHour: strategy.workStartHour,
        workEndHour: strategy.workEndHour,
        maxLeads: strategy.maxLeads,
        flow: useFlow ? flow : undefined,
      };
      const created = await api.post<{ id: string }>("/campaigns", payload);
      toast("success", "Disparo criado. Agora selecione os contatos.");
      navigate(`/disparos/${created.id}/selecionar`);
    } catch (err) {
      toastFromError(toast, err);
    } finally {
      setSubmitting(false);
    }
  }

  if (accounts === null) return <PageLoader />;

  return (
    <div className="max-w-3xl">
      <Link
        to="/disparos"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-cream/50 hover:text-gold-400"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar para disparos
      </Link>

      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-gold-500/30 bg-gold-500/10">
          <Radar className="h-5 w-5 text-gold-500" />
        </div>
        <div>
          <h1 className="font-serif text-3xl font-semibold gold-gradient-text">Novo disparo</h1>
          <p className="mt-0.5 text-sm text-cream/50">
            Configure a mensagem e, no próximo passo, escolha para quem enviar
          </p>
        </div>
      </div>

      <div className="space-y-6">
        <section className="card space-y-4 p-5">
          <h2 className="font-serif text-lg text-gold-400">1. Conta</h2>
          <div>
            <label htmlFor="accountId" className="label">
              Conta LinkedIn *
            </label>
            <select
              id="accountId"
              className="input"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              {connected.length === 0 && <option value="">Nenhuma conta conectada</option>}
              {connected.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.username ?? a.unipileAccountId}
                </option>
              ))}
            </select>
            {connected.length === 0 && (
              <p className="mt-1.5 text-xs text-amber-400">
                Conecte sua conta LinkedIn primeiro.{" "}
                <Link to="/conectar" className="underline hover:text-gold-400">
                  Ir para contas
                </Link>
                .
              </p>
            )}
          </div>
        </section>

        <section className="card space-y-4 p-5">
          <h2 className="font-serif text-lg text-gold-400">2. Mensagem</h2>
          <div>
            <label htmlFor="message" className="label">
              Mensagem para os contatos *
            </label>
            <textarea
              id="message"
              className="input min-h-32 resize-y"
              maxLength={1000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Olá {nome}, ..."
            />
            <p className="mt-1 text-right text-xs text-cream/40">{message.length}/1000</p>
          </div>
          <p className="text-xs text-cream/40">
            Dica: use <code className="rounded bg-ink-700 px-1 py-0.5 text-gold-400">{"{nome}"}</code> e{" "}
            <code className="rounded bg-ink-700 px-1 py-0.5 text-gold-400">{"{cargo}"}</code> para
            personalizar com o nome e o cargo de cada contato.
          </p>
        </section>

        <section className="card">
          <button
            type="button"
            className="flex w-full items-center justify-between p-5 text-left"
            onClick={() => setFlowOpen((v) => !v)}
            aria-expanded={flowOpen}
          >
            <span className="flex flex-col gap-0.5">
              <span className="flex items-center gap-2 font-serif text-lg text-gold-400">
                <Workflow className="h-5 w-5" />
                Fluxo personalizado (opcional)
              </span>
              <span className="text-xs text-cream/40">
                {useFlow ? "Fluxo ativo: comanda os envios" : "Sem fluxo: envia a mensagem única acima"}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-gold-500"
                checked={useFlow}
                onChange={(e) => {
                  setUseFlow(e.target.checked);
                  setFlowOpen(e.target.checked);
                }}
                aria-label="Usar fluxo personalizado"
              />
              <ChevronDown
                className={`h-4 w-4 text-cream/40 transition-transform ${flowOpen ? "rotate-180" : ""}`}
              />
            </span>
          </button>

          {flowOpen && (
            <div className="space-y-3 border-t border-ink-400 p-5">
              <p className="text-xs text-cream/40">
                No disparo, os contatos já são conexões: o bloco{" "}
                <span className="text-gold-400">Convite</span> envia uma mensagem direta e o{" "}
                <span className="text-gold-400">Quando aceitar</span> passa direto. Um fluxo simples
                seria: Início → Mensagem → Parar.
              </p>
              <FlowEditor
                initialFlow={flow}
                onSave={(f) => {
                  setFlow(f);
                  setUseFlow(f.nodes.length > 0);
                  toast("success", "Fluxo aplicado ao disparo");
                }}
              />
            </div>
          )}
        </section>

        <section className="card space-y-4 p-5">
          <h2 className="font-serif text-lg text-gold-400">3. Estratégia de envio</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="dailyLimit" className="label">
                Limite diário
              </label>
              <input
                id="dailyLimit"
                className="input"
                type="number"
                min={1}
                max={100}
                value={strategy.dailyLimit}
                onChange={(e) => setStrategyField("dailyLimit", Number(e.target.value))}
              />
            </div>
            <div>
              <label htmlFor="weeklyLimit" className="label">
                Limite semanal
              </label>
              <input
                id="weeklyLimit"
                className="input"
                type="number"
                min={1}
                max={200}
                value={strategy.weeklyLimit}
                onChange={(e) => setStrategyField("weeklyLimit", Number(e.target.value))}
              />
            </div>
            <div>
              <label htmlFor="minDelayMin" className="label">
                Atraso mínimo (min)
              </label>
              <input
                id="minDelayMin"
                className="input"
                type="number"
                min={1}
                max={180}
                value={strategy.minDelayMin}
                onChange={(e) => setStrategyField("minDelayMin", Number(e.target.value))}
              />
            </div>
            <div>
              <label htmlFor="maxDelayMin" className="label">
                Atraso máximo (min)
              </label>
              <input
                id="maxDelayMin"
                className="input"
                type="number"
                min={1}
                max={180}
                value={strategy.maxDelayMin}
                onChange={(e) => setStrategyField("maxDelayMin", Number(e.target.value))}
              />
            </div>
            <div>
              <label htmlFor="workStartHour" className="label">
                Início do horário (h)
              </label>
              <input
                id="workStartHour"
                className="input"
                type="number"
                min={0}
                max={23}
                value={strategy.workStartHour}
                onChange={(e) => setStrategyField("workStartHour", Number(e.target.value))}
              />
            </div>
            <div>
              <label htmlFor="workEndHour" className="label">
                Fim do horário (h)
              </label>
              <input
                id="workEndHour"
                className="input"
                type="number"
                min={0}
                max={23}
                value={strategy.workEndHour}
                onChange={(e) => setStrategyField("workEndHour", Number(e.target.value))}
              />
            </div>
            <div>
              <label htmlFor="maxLeads" className="label">
                Máximo de contatos a importar
              </label>
              <input
                id="maxLeads"
                className="input"
                type="number"
                min={10}
                max={10000}
                value={strategy.maxLeads}
                onChange={(e) => setStrategyField("maxLeads", Number(e.target.value))}
              />
            </div>
          </div>
          <p className="flex items-start gap-1.5 text-xs text-cream/40">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Enviar mensagens em massa é agressivo para o LinkedIn. Respeite limites baixos (ex.:
            20–40 por dia) e intervalos de 5 a 15 minutos para proteger a conta de bloqueios.
          </p>
        </section>

        <section className="card space-y-4 p-5">
          <h2 className="font-serif text-lg text-gold-400">Confirmar</h2>
          <div>
            <label htmlFor="name" className="label">
              Nome do disparo (opcional)
            </label>
            <input
              id="name"
              className="input"
              maxLength={200}
              placeholder={`Disparo · ${new Date().toLocaleDateString("pt-BR")}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn btn-primary w-full"
            disabled={submitting || connected.length === 0}
            onClick={onCreate}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            {submitting ? "Criando..." : "Criar e selecionar contatos"}
          </button>
          <p className="flex items-start gap-1.5 text-xs text-cream/40">
            <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Você ainda não envia nada agora: no próximo passo varre a rede e escolhe para quem
            enviar.
          </p>
        </section>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Registrar a rota**

Em `frontend/src/App.tsx`, importar e registrar:
```tsx
import { DisparoNewPage } from "./pages/DisparoNewPage";
```
```tsx
            <Route path="/disparos/nova" element={<DisparoNewPage />} />
```

- [ ] **Step 3: Rodar typecheck e build**

Run:
```bash
npm run typecheck
npm run build
```
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/DisparoNewPage.tsx frontend/src/App.tsx
git commit -m "feat: página de criação de disparo"
```

---

### Task 12: `DisparoSelectPage` — varredura e seleção de contatos

**Files:**
- Create: `frontend/src/pages/DisparoSelectPage.tsx`
- Modify: `frontend/src/App.tsx` (rota)

**Interfaces:**
- Consumes: `POST /api/campaigns/:id/sweep`, `POST /api/campaigns/:id/leads/select`, `GET /api/campaigns/:id/leads/selection`, `GET /api/campaigns/:id/leads`, `POST /api/campaigns/:id/start`, `Lead.selected` (Task 8).
- Produces: rota `/disparos/:id/selecionar`.

- [ ] **Step 1: Criar a página**

Create `frontend/src/pages/DisparoSelectPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckSquare,
  Inbox,
  Loader2,
  Radar,
  Search,
  Send,
  Square,
} from "lucide-react";
import { api } from "../lib/api";
import type { Campaign, Lead, Paginated } from "../types";
import { StatusBadge } from "../components/StatusBadge";
import { Pagination } from "../components/Pagination";
import { PageLoader } from "../components/Spinner";
import { shortName } from "../lib/format";
import { useToast, toastFromError } from "../components/Toast";

export function DisparoSelectPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [selection, setSelection] = useState<{ selected: number; total: number }>({
    selected: 0,
    total: 0,
  });
  const [leads, setLeads] = useState<Paginated<Lead> | null>(null);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const loadCampaign = useCallback(() => {
    api
      .get<Campaign>(`/campaigns/${id}`)
      .then(setCampaign)
      .catch((e) => toastFromError(toast, e));
  }, [id, toast]);

  const loadSelection = useCallback(() => {
    api
      .get<{ selected: number; total: number }>(`/campaigns/${id}/leads/selection`)
      .then(setSelection)
      .catch(() => {});
  }, [id]);

  const loadLeads = useCallback(() => {
    const qs = new URLSearchParams({ page: String(page), pageSize: "50" });
    if (appliedQuery.trim()) qs.set("q", appliedQuery.trim());
    api
      .get<Paginated<Lead>>(`/campaigns/${id}/leads?${qs.toString()}`)
      .then(setLeads)
      .catch((e) => toastFromError(toast, e));
  }, [id, page, appliedQuery, toast]);

  useEffect(() => {
    loadCampaign();
    loadSelection();
  }, [loadCampaign, loadSelection]);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  const canEdit = campaign ? ["DRAFT", "PAUSED", "ERROR"].includes(campaign.status) : false;
  const started = campaign ? ["RUNNING", "IMPORTING", "COMPLETED"].includes(campaign.status) : false;

  const reload = () => {
    loadSelection();
    loadLeads();
    loadCampaign();
  };

  async function onSweep() {
    setBusy("sweep");
    try {
      const r = await api.post<{ imported: number }>(`/campaigns/${id}/sweep`);
      toast("success", `${r.imported} conexões importadas da rede`);
      reload();
    } catch (err) {
      toastFromError(toast, err);
    } finally {
      setBusy(null);
    }
  }

  async function onSelect(action: "all" | "none" | "toggle", providerIds: string[] = []) {
    setBusy("select");
    try {
      const r = await api.post<{ selected: number }>(`/campaigns/${id}/leads/select`, {
        action,
        providerIds,
      });
      setSelection((s) => ({ ...s, selected: r.selected }));
      loadLeads();
    } catch (err) {
      toastFromError(toast, err);
    } finally {
      setBusy(null);
    }
  }

  async function onStart() {
    setBusy("start");
    try {
      await api.post(`/campaigns/${id}/start`);
      toast("success", "Disparo iniciado. Acompanhe o progresso no detalhe.");
      navigate(`/disparos/${id}`);
    } catch (err) {
      toastFromError(toast, err);
    } finally {
      setBusy(null);
    }
  }

  if (!campaign) return <PageLoader />;

  return (
    <div>
      <Link
        to="/disparos"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-cream/50 hover:text-gold-400"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar para disparos
      </Link>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-serif text-3xl font-semibold gold-gradient-text">
              {campaign.name}
            </h1>
            <StatusBadge status={campaign.status} kind="campaign" />
          </div>
          <p className="mt-1 text-sm text-cream/50">
            Selecione os contatos da rede que receberão o disparo
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!canEdit || busy !== null}
            onClick={onSweep}
          >
            {busy === "sweep" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
            Varrer rede
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canEdit || selection.selected === 0 || busy !== null}
            onClick={onStart}
          >
            {busy === "start" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Disparar ({selection.selected})
          </button>
        </div>
      </div>

      {started && (
        <div className="card mb-6 border-amber-500/25 px-5 py-4 text-sm text-amber-400">
          Disparo já iniciado. A seleção está bloqueada; pause o disparo para alterar.
        </div>
      )}

      <div className="card mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4 text-sm">
        <span className="inline-flex items-center gap-2 text-cream/70">
          <Radar className="h-4 w-4 text-gold-500" />
          {selection.total.toLocaleString("pt-BR")} contatos na campanha
        </span>
        <span className="inline-flex items-center gap-2 text-cream/70">
          <CheckSquare className="h-4 w-4 text-gold-500" />
          {selection.selected.toLocaleString("pt-BR")} selecionados
        </span>
        <button
          type="button"
          className="btn btn-secondary !px-2.5 !py-1.5"
          disabled={!canEdit || busy !== null}
          onClick={() => onSelect("all")}
        >
          <CheckSquare className="h-3.5 w-3.5" />
          Selecionar todos
        </button>
        <button
          type="button"
          className="btn btn-secondary !px-2.5 !py-1.5"
          disabled={!canEdit || busy !== null}
          onClick={() => onSelect("none")}
        >
          <Square className="h-3.5 w-3.5" />
          Nenhum
        </button>
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-400 px-4 py-3">
          <form
            className="flex flex-1 items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setAppliedQuery(searchInput.trim());
              setPage(1);
            }}
          >
            <Search className="h-4 w-4 text-cream/40" />
            <input
              className="input flex-1"
              placeholder="Buscar por nome..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <button type="submit" className="btn btn-secondary">
              Buscar
            </button>
            {appliedQuery && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setAppliedQuery("");
                  setSearchInput("");
                  setPage(1);
                }}
              >
                Limpar
              </button>
            )}
          </form>
        </div>

        {!leads ? (
          <PageLoader />
        ) : leads.items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <Inbox className="h-8 w-8 text-cream/30" />
            <p className="text-sm text-cream/50">
              {selection.total > 0
                ? "Nenhum contato encontrado para a busca."
                : "Nenhum contato ainda. Clique em \"Varrer rede\" para importar as conexões da conta."}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-400">
                    <th className="table-header w-10 px-4 py-3">Sel.</th>
                    <th className="table-header px-4 py-3">Nome</th>
                    <th className="table-header px-4 py-3">Cargo</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.items.map((lead) => (
                    <tr
                      key={lead.id}
                      className="border-b border-ink-400/60 last:border-0 hover:bg-ink-600/40"
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-gold-500"
                          checked={lead.selected}
                          disabled={!canEdit || busy !== null}
                          onChange={() => onSelect("toggle", [lead.providerId])}
                          aria-label={`Selecionar ${shortName(lead.name, lead.providerId)}`}
                        />
                      </td>
                      <td className="px-4 py-3 font-medium text-cream">
                        {shortName(lead.name, lead.providerId)}
                      </td>
                      <td className="max-w-64 truncate px-4 py-3 text-cream/60">
                        {lead.headline ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 pb-4">
              <Pagination page={page} pageSize={50} total={leads.total} onChange={setPage} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Registrar a rota**

Em `frontend/src/App.tsx`, importar e registrar:
```tsx
import { DisparoSelectPage } from "./pages/DisparoSelectPage";
```
```tsx
            <Route path="/disparos/:id/selecionar" element={<DisparoSelectPage />} />
```

- [ ] **Step 3: Rodar typecheck e build**

Run:
```bash
npm run typecheck
npm run build
```
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/DisparoSelectPage.tsx frontend/src/App.tsx
git commit -m "feat: seleção de contatos do disparo com varredura da rede"
```

---

### Task 13: Navegação e sino de notificações no layout

**Files:**
- Modify: `frontend/src/components/Layout.tsx`
- Create: `frontend/src/components/NotificationBell.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `GET /api/notifications`, `POST /api/notifications/read-all` (Task 2), `Notification`/`NotificationsResponse` (Task 8).
- Produces: componente `NotificationBell({ compact?: boolean })`.

- [ ] **Step 1: Criar o sino de notificações**

Create `frontend/src/components/NotificationBell.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Bell, CheckCheck, Info, XCircle } from "lucide-react";
import { api } from "../lib/api";
import type { NotificationsResponse } from "../types";
import { formatDateTime } from "../lib/format";

export function NotificationBell({ compact = false }: { compact?: boolean }) {
  const [items, setItems] = useState<NotificationsResponse["items"]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const load = () => {
      api
        .get<NotificationsResponse>("/notifications?limit=20")
        .then((r) => {
          setItems(r.items);
          setUnread(r.unread);
        })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      api.post("/notifications/read-all").catch(() => {});
      setUnread(0);
    }
  }

  return (
    <div className="relative">
      {compact ? (
        <button
          type="button"
          className="btn btn-secondary relative !p-2"
          onClick={toggle}
          aria-label="Notificações"
          title="Notificações"
        >
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
              {unread}
            </span>
          )}
        </button>
      ) : (
        <button type="button" className="btn btn-secondary w-full" onClick={toggle}>
          <span className="flex w-full items-center justify-between">
            <span className="inline-flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Notificações
            </span>
            {unread > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white">
                {unread}
              </span>
            )}
          </span>
        </button>
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-ink-400 bg-ink-800 shadow-2xl">
            <div className="flex items-center justify-between border-b border-ink-400 px-4 py-3">
              <span className="font-serif text-sm font-semibold text-gold-400">Notificações</span>
              <button
                type="button"
                className="text-xs text-cream/40 hover:text-gold-400"
                onClick={() => {
                  api.post("/notifications/read-all").catch(() => {});
                  setUnread(0);
                }}
              >
                Marcar todas como lidas
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {items.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-cream/40">Nenhuma notificação</p>
              ) : (
                <ul className="divide-y divide-ink-400/60">
                  {items.map((n) => (
                    <li key={n.id} className="flex items-start gap-2.5 px-4 py-3">
                      {n.level === "ERROR" ? (
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                      ) : n.level === "WARN" ? (
                        <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                      ) : (
                        <CheckCheck className="mt-0.5 h-4 w-4 shrink-0 text-gold-500/70" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-cream/80">{n.message}</p>
                        <p className="mt-0.5 text-xs text-cream/35">{formatDateTime(n.createdAt)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Trocar o item de navegação e integrar o sino no sidebar**

Em `frontend/src/components/Layout.tsx`:

1. No `NAV`, trocar:
```ts
  { to: "/rede", label: "Varrer rede", icon: Radar },
```
por:
```ts
  { to: "/disparos", label: "Disparos", icon: Radar },
```
2. Adicionar import:
```tsx
import { NotificationBell } from "./NotificationBell";
```
3. No bloco de ações do sidebar (`<div className="space-y-3 px-3 pb-5">`), adicionar `<NotificationBell />` como primeiro filho:
```tsx
      <div className="space-y-3 px-3 pb-5">
        <NotificationBell />
        <NavLink to="/campanhas/nova" onClick={onNavigate} className="btn btn-primary w-full">
```
4. Na barra superior mobile, adicionar `<NotificationBell compact />` antes do botão de menu:
```tsx
        <div className="flex items-center gap-2">
          <MobileThemeToggle />
          <NotificationBell compact />
          <button
```
5. Remover o import de `SweepPage`/rota em `App.tsx` e adicionar a rota `/disparos/:id` reutilizando `CampaignDetailPage`. Em `App.tsx`:
   - Remover `import { SweepPage } from "./pages/SweepPage";`
   - Remover `<Route path="/rede" element={<SweepPage />} />`
   - Adicionar após `<Route path="/disparos/:id/selecionar" .../>`:
```tsx
            <Route path="/disparos/:id" element={<CampaignDetailPage />} />
```

- [ ] **Step 3: Rodar typecheck e build**

Run:
```bash
npm run typecheck
npm run build
```
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Layout.tsx frontend/src/components/NotificationBell.tsx frontend/src/App.tsx
git commit -m "feat: navegação de disparos e sino de notificações no layout"
```

---

### Task 14: Verificação final e validação ao vivo

**Files:**
- Nenhum novo; verificação end-to-end.

- [ ] **Step 1: Backend — testes e typecheck**

Run:
```bash
npm run test
npm run typecheck
```
Expected: todas as suítes verdes, typecheck limpo.

- [ ] **Step 2: Frontend — typecheck e build**

Run:
```bash
npm run typecheck
npm run build
```
Expected: sem erros.

- [ ] **Step 3: Reiniciar processos e validar ao vivo**

- Reiniciar backend, sweep worker e frontend nos terminais de background (a API expõe `GET /api/health`).
- Confirmar `GET /api/health` → `{ ok: true, ... }`.
- Abrir o preview (`/disparos`) e validar o fluxo:
  1. "Novo disparo" → criar (sem iniciar).
  2. Na página de seleção, "Varrer rede" importa as conexões reais.
  3. Selecionar alguns contatos e clicar "Disparar".
  4. Ver o card de progresso atualizar a cada 5s na lista `/disparos`.
  5. Abrir o detalhe e ver métricas de resposta + coluna "Enviado em".
  6. Abrir o sino e ver as notificações criadas.
- Se a conta real estiver em risco (limites), disparar para 1-2 contatos de teste e pausar logo em seguida.

- [ ] **Step 4: Commit final (se houver ajustes de verificação)**

```bash
git add -A
git commit -m "chore: ajustes finais do disparo em massa"
```
(Apenas se houver mudanças pendentes.)

---

## Self-Review

**Cobertura do spec:**
- Modelo `Notification` e `Lead.selected` → Task 1.
- Rotas de notificação → Task 2.
- Semântica de fluxo DISPARO (invite→DM, message PENDING, on_accept direto) → Task 3.
- `POST /campaigns` (mode DISPARO), `POST /:id/sweep`, `POST /:id/leads/select`, filtros `selected`/`q` → Tasks 4-5.
- `start` de DISPARO valida ≥1 selecionado e não re-importa → Task 6.
- Scheduler/worker enviam só para `selected=true`, completa quando não sobra → Task 7.
- Notificações em início, importação, limite, conclusão, falha → Tasks 2, 3, 6, 7.
- Frontend: lista `/disparos` com poll 5s → Task 10; criação → Task 11; seleção → Task 12; detalhe com métricas → Task 9; sino → Task 13; nav troca "Varrer rede" → Task 13.
- Erros e limites (400 sem seleção, conta desconectada, LIMIT_HIT) → Tasks 4, 6, 7.
- Compatibilidade SEARCH/SWEEP → Tasks 3, 5, 6, 7 (modo legado preservado; SWEEP sem filtro `selected`).

**Placeholders:** nenhum "TBD/TODO"; todo passo tem código e comando exatos.

**Consistência de tipos:** `SelectAction = "replace"|"all"|"none"|"toggle"` usado idêntico no zod da rota e no serviço; `NotificationInput` e `NotificationsResponse` coerentes; `importBroadcastLeads`, `setLeadSelection`, `getSelectionCount`, `processBroadcastCampaign`, `isConnectedMode` nomeados consistentemente entre as tarefas que os consomem.
