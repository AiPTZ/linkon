import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Activity,
  Bot,
  Check,
  Crown,
  Globe,
  KeyRound,
  Link2,
  Loader2,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  Trash2,
  UserCog,
  UserPlus,
  Webhook,
  X,
} from "lucide-react";
import { UnipileIntegrationSection } from "../components/UnipileIntegrationSection";
import { api } from "../lib/api";
import type { Account, AdminUser, LogEvent, Paginated, UserStatus } from "../types";
import { StatusBadge } from "../components/StatusBadge";
import { StatCard } from "../components/StatCard";
import { Pagination } from "../components/Pagination";
import { PageLoader } from "../components/Spinner";
import { USER_STATUS_LABEL, formatDateTime, userStatusStyle } from "../lib/format";
import { useToast, toastFromError } from "../components/Toast";
import { useAuth } from "../lib/auth";

interface QueueCounts {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
}

interface Overview {
  redis: boolean;
  queues: {
    invites: QueueCounts;
    chatbot: QueueCounts;
    search: QueueCounts;
    pendingJobs: number;
    failedJobs: number;
  };
  counts: {
    accounts: number;
    campaigns: number;
    leads: number;
    logs: number;
    leadByStatus: Record<string, number>;
  };
  timestamp: string;
}

type Tab = "overview" | "users" | "accounts" | "global" | "logs" | "integration";

const QUEUE_LABELS = {
  invites: "Convites",
  chatbot: "Agente",
  search: "Busca",
} as const;

const isPending = (s: UserStatus) => s === "PENDING";
const isBlocked = (s: UserStatus) => s === "BLOCKED";

export function AdminPage() {
  const { toast } = useToast();
  const { user: currentAdmin, setOperatingAs } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const [overview, setOverview] = useState<Overview | null>(null);

  const [logPage, setLogPage] = useState(1);
  const [logLevel, setLogLevel] = useState("");
  const [logs, setLogs] = useState<Paginated<LogEvent> | null>(null);

  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [globalData, setGlobalData] = useState<{ campaigns: number; contacts: number } | null>(null);

  const [showNewUser, setShowNewUser] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newWhatsapp, setNewWhatsapp] = useState("");
  const [newPro, setNewPro] = useState(false);
  const [creating, setCreating] = useState(false);

  const loadOverview = useCallback(() => {
    api.get<Overview>("/admin/overview").then(setOverview).catch((e) => toastFromError(toast, e));
  }, [toast]);

  const loadLogs = useCallback(() => {
    api
      .get<Paginated<LogEvent>>(`/admin/logs?page=${logPage}&pageSize=50${logLevel ? `&level=${logLevel}` : ""}`)
      .then(setLogs)
      .catch((e) => toastFromError(toast, e));
  }, [logPage, logLevel, toast]);

  const loadAccounts = useCallback(() => {
    api
      .get<{ items: Account[] }>("/admin/accounts")
      .then((r) => setAccounts(r.items))
      .catch((e) => toastFromError(toast, e));
  }, [toast]);

  const loadUsers = useCallback(() => {
    api
      .get<{ items: AdminUser[] }>("/admin/users")
      .then((r) => setUsers(r.items))
      .catch((e) => toastFromError(toast, e));
  }, [toast]);

  const loadGlobal = useCallback(() => {
    api
      .get<{ campaigns: number; contacts: number }>("/admin/global")
      .then(setGlobalData)
      .catch((e) => toastFromError(toast, e));
  }, [toast]);

  useEffect(() => {
    if (tab === "overview") loadOverview();
    if (tab === "logs") loadLogs();
    if (tab === "accounts") loadAccounts();
    if (tab === "users") loadUsers();
    if (tab === "global") loadGlobal();
  }, [tab, loadOverview, loadLogs, loadAccounts, loadUsers, loadGlobal]);

  async function onDisconnect(account: Account) {
    if (!window.confirm(`Desconectar a conta ${account.username ?? account.unipileAccountId}?`)) return;
    setDisconnecting(account.id);
    try {
      await api.post(`/admin/accounts/${account.id}/disconnect`);
      toast("success", "Conta desconectada");
      loadAccounts();
    } catch (err) {
      toastFromError(toast, err);
    } finally {
      setDisconnecting(null);
    }
  }

  async function onUserAction(id: string, action: "approve" | "block" | "unblock") {
    try {
      await api.post(`/admin/users/${id}/${action}`);
      toast("success", "Usuário atualizado");
      loadUsers();
    } catch (err) {
      toastFromError(toast, err);
    }
  }

  async function onTogglePro(user: AdminUser) {
    try {
      await api.post(`/admin/users/${user.id}/pro`, { pro: !user.pro });
      toast("success", user.pro ? "Acesso PRO revogado" : "Versão PRO liberada para o usuário");
      loadUsers();
    } catch (err) {
      toastFromError(toast, err);
    }
  }

  async function onResetPassword(user: AdminUser) {
    const password = window.prompt(`Nova senha para ${user.username}:`);
    if (!password) return;
    if (password.length < 6) {
      toast("error", "A senha deve ter no mínimo 6 caracteres");
      return;
    }
    try {
      await api.post(`/admin/users/${user.id}/reset-password`, { password });
      toast("success", "Senha redefinida");
    } catch (err) {
      toastFromError(toast, err);
    }
  }

  async function onCreateUser(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await api.post("/admin/users", {
        name: newName,
        username: newUsername,
        password: newPassword,
        whatsapp: newWhatsapp || undefined,
        pro: newPro,
      });
      toast("success", "Usuário criado com acesso ativo");
      setNewName("");
      setNewUsername("");
      setNewPassword("");
      setNewWhatsapp("");
      setNewPro(false);
      setShowNewUser(false);
      loadUsers();
    } catch (err) {
      toastFromError(toast, err);
    } finally {
      setCreating(false);
    }
  }

  async function onAccountApprove(id: string) {
    try {
      await api.post(`/admin/accounts/${id}/approve`);
      toast("success", "Conta aprovada");
      loadAccounts();
    } catch (err) {
      toastFromError(toast, err);
    }
  }

  async function onAccountReject(id: string) {
    try {
      await api.post(`/admin/accounts/${id}/reject`);
      toast("success", "Conta rejeitada");
      loadAccounts();
    } catch (err) {
      toastFromError(toast, err);
    }
  }

  const tabs: { key: Tab; label: string; icon: typeof Activity }[] = [
    { key: "overview", label: "Visão geral", icon: Activity },
    { key: "integration", label: "Integração", icon: Webhook },
    { key: "users", label: "Usuários", icon: UserPlus },
    { key: "accounts", label: "Contas LinkedIn", icon: Link2 },
    { key: "global", label: "Base global", icon: Globe },
    { key: "logs", label: "Logs do sistema", icon: ScrollText },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="flex items-center gap-2 font-serif text-3xl font-semibold gold-gradient-text">
          <ShieldCheck className="h-7 w-7 text-gold-500" />
          Administração
        </h1>
        <p className="mt-1 text-sm text-cream/50">
          Visão geral do sistema, usuários, filas, logs globais e contas conectadas
        </p>
      </div>

      <div className="mb-5 flex gap-1 border-b border-ink-400">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? "border-gold-500 text-gold-400"
                : "border-transparent text-cream/50 hover:text-cream"
            }`}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Servidor / Redis"
              value={overview ? (overview.redis ? "Online" : "Offline") : "—"}
              accent
              hint={overview ? `Atualizado ${formatDateTime(overview.timestamp)}` : undefined}
            />
            <StatCard label="Contas conectadas" value={overview?.counts.accounts ?? "—"} />
            <StatCard label="Campanhas" value={overview?.counts.campaigns ?? "—"} />
            <StatCard label="Total de leads" value={overview?.counts.leads ?? "—"} />
          </div>

          {overview && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {Object.entries(overview.counts.leadByStatus).map(([status, count]) => (
                  <div key={status} className="card flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-cream/60">{status}</span>
                    <span className="text-lg font-semibold text-cream">{count}</span>
                  </div>
                ))}
                <div className="card flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-cream/60">Eventos de log</span>
                  <span className="text-lg font-semibold text-cream">{overview.counts.logs}</span>
                </div>
              </div>

              <div className="card overflow-hidden">
                <div className="flex items-center justify-between border-b border-ink-400 px-5 py-4">
                  <div className="flex items-center gap-2">
                    <Bot className="h-5 w-5 text-gold-500" />
                    <h2 className="font-serif text-lg text-cream">Filas BullMQ</h2>
                  </div>
                  <button type="button" className="btn btn-secondary !px-3 !py-1.5 text-xs" onClick={loadOverview}>
                    <RefreshCw className="h-3.5 w-3.5" />
                    Atualizar
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-ink-400">
                        <th className="table-header px-5 py-3">Fila</th>
                        <th className="table-header px-4 py-3">Aguardando</th>
                        <th className="table-header px-4 py-3">Em execução</th>
                        <th className="table-header px-4 py-3">Agendadas</th>
                        <th className="table-header px-4 py-3">Falhas</th>
                        <th className="table-header px-4 py-3">Concluídas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(Object.keys(QUEUE_LABELS) as (keyof typeof QUEUE_LABELS)[]).map((key) => {
                        const q = overview.queues[key];
                        return (
                          <tr key={key} className="border-b border-ink-400/60 last:border-0">
                            <td className="px-5 py-3 font-medium text-cream">{QUEUE_LABELS[key]}</td>
                            <td className="px-4 py-3 text-cream/70">{q.waiting}</td>
                            <td className="px-4 py-3 text-cream/70">{q.active}</td>
                            <td className="px-4 py-3 text-cream/70">{q.delayed}</td>
                            <td className="px-4 py-3">
                              <span className={q.failed > 0 ? "text-red-400 font-medium" : "text-cream/70"}>
                                {q.failed}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-cream/70">{q.completed}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "integration" && <UnipileIntegrationSection />}

      {tab === "users" && (
        <div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-serif text-xl text-cream">Usuários</h2>
            <button
              type="button"
              className="btn btn-secondary !px-3 !py-1.5 text-xs"
              onClick={() => setShowNewUser((v) => !v)}
            >
              {showNewUser ? <X className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
              {showNewUser ? "Cancelar" : "Novo usuário"}
            </button>
          </div>

          {showNewUser && (
            <form onSubmit={onCreateUser} className="card mb-4 space-y-4 p-5">
              <h3 className="font-serif text-lg text-gold-400">Criar conta de usuário</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="newName" className="label">Nome *</label>
                  <input
                    id="newName"
                    className="input"
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="newUsername" className="label">Usuário (login) *</label>
                  <input
                    id="newUsername"
                    className="input"
                    required
                    minLength={3}
                    maxLength={40}
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="newPassword" className="label">Senha (mín. 6) *</label>
                  <input
                    id="newPassword"
                    className="input"
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="newWhatsapp" className="label">WhatsApp (opcional)</label>
                  <input
                    id="newWhatsapp"
                    className="input"
                    maxLength={25}
                    placeholder="Ex: 5511999999999"
                    value={newWhatsapp}
                    onChange={(e) => setNewWhatsapp(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-ink-400 bg-ink-800 px-3 py-2.5">
                  <input
                    id="newPro"
                    type="checkbox"
                    className="h-4 w-4 accent-gold-500"
                    checked={newPro}
                    onChange={(e) => setNewPro(e.target.checked)}
                  />
                  <label htmlFor="newPro" className="text-sm text-cream/80">
                    Liberar Versão PRO (acesso à IA)
                  </label>
                </div>
              </div>
              <div className="flex justify-end">
                <button type="submit" className="btn btn-primary" disabled={creating}>
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                  Criar usuário
                </button>
              </div>
              <p className="text-xs text-cream/40">
                O usuário será criado com acesso ativo (ATIVO) e papel de usuário comum.
              </p>
            </form>
          )}

          <div className="card overflow-hidden">
            {!users ? (
              <PageLoader />
            ) : users.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
                <UserPlus className="h-8 w-8 text-cream/30" />
                <p className="text-sm text-cream/50">Nenhum usuário cadastrado.</p>
              </div>
            ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-400">
                    <th className="table-header px-5 py-3">Usuário</th>
                    <th className="table-header px-4 py-3">Status</th>
                    <th className="table-header px-4 py-3">Contadores</th>
                    <th className="table-header px-4 py-3">Criado em</th>
                    <th className="table-header px-4 py-3">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-ink-400/60 last:border-0">
                      <td className="px-5 py-3">
                        <div className="font-medium text-cream">{u.name}</div>
                        <div className="text-xs text-cream/40">@{u.username}</div>
                        {u.role === "USER" && u.pro && (
                          <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-gold-500/40 bg-gold-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold-400">
                            <Crown className="h-2.5 w-2.5" /> PRO
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${userStatusStyle(u.status)}`}
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]"
                            aria-hidden="true"
                          />
                          {USER_STATUS_LABEL[u.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-cream/70">
                        {u._count?.accounts ?? 0} contas · {u._count?.campaigns ?? 0} campanhas ·{" "}
                        {u._count?.contacts ?? 0} contatos
                      </td>
                      <td className="px-4 py-3 text-cream/70">{formatDateTime(u.createdAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          {isPending(u.status) && (
                            <button
                              type="button"
                              className="btn btn-secondary !px-2.5 !py-1.5 text-xs"
                              onClick={() => onUserAction(u.id, "approve")}
                            >
                              <Check className="h-3.5 w-3.5" /> Aprovar
                            </button>
                          )}
                          {!isBlocked(u.status) && u.id !== currentAdmin?.id && (
                            <button
                              type="button"
                              className="btn btn-danger !px-2.5 !py-1.5 text-xs"
                              onClick={() => onUserAction(u.id, "block")}
                            >
                              <X className="h-3.5 w-3.5" /> Bloquear
                            </button>
                          )}
                          {u.role === "USER" && u.id !== currentAdmin?.id && (
                            <button
                              type="button"
                              className={`btn !px-2.5 !py-1.5 text-xs ${
                                u.pro ? "btn-secondary" : "btn-primary"
                              }`}
                              onClick={() => onTogglePro(u)}
                              title={u.pro ? "Revogar acesso à IA" : "Liberar acesso à IA"}
                            >
                              <Crown className="h-3.5 w-3.5" />
                              {u.pro ? "PRO ativo" : "Liberar PRO"}
                            </button>
                          )}
                          {isBlocked(u.status) && (
                            <button
                              type="button"
                              className="btn btn-secondary !px-2.5 !py-1.5 text-xs"
                              onClick={() => onUserAction(u.id, "unblock")}
                            >
                              <ShieldCheck className="h-3.5 w-3.5" /> Desbloquear
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-secondary !px-2.5 !py-1.5 text-xs"
                            onClick={() => onResetPassword(u)}
                          >
                            <KeyRound className="h-3.5 w-3.5" /> Redefinir senha
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary !px-2.5 !py-1.5 text-xs"
                            onClick={() => {
                              setOperatingAs(u);
                              window.location.assign("/campanhas");
                            }}
                          >
                            <UserCog className="h-3.5 w-3.5" /> Operar como
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          </div>
        </div>
      )}

      {tab === "accounts" && (
        <div className="card">
          {!accounts ? (
            <PageLoader />
          ) : accounts.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <UserPlus className="h-8 w-8 text-cream/30" />
              <p className="text-sm text-cream/50">Nenhuma conta conectada.</p>
            </div>
          ) : (
            <ul className="divide-y divide-ink-400/60">
              {accounts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gold-500/30 bg-gold-500/10">
                      <UserPlus className="h-4 w-4 text-gold-500" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-cream">{a.username ?? a.unipileAccountId}</div>
                      <div className="text-xs text-cream/40">
                        {a.authMethod === "NATIVE" ? "Login nativo" : "Assistente"} · dono:{" "}
                        {a.user?.username ?? "Base global"} · {a._count?.campaigns ?? 0} campanhas ·{" "}
                        {formatDateTime(a.createdAt)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={a.status} kind="account" />
                    {a.status === "PENDING_LINKEDIN" && (
                      <>
                        <button
                          type="button"
                          className="btn btn-secondary !px-2.5 !py-1.5 text-xs"
                          onClick={() => onAccountApprove(a.id)}
                        >
                          <Check className="h-3.5 w-3.5" /> Aprovar
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger !px-2.5 !py-1.5 text-xs"
                          onClick={() => onAccountReject(a.id)}
                        >
                          <X className="h-3.5 w-3.5" /> Rejeitar
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="btn btn-danger !px-2.5 !py-1.5"
                      onClick={() => onDisconnect(a)}
                      disabled={disconnecting === a.id || a.status === "DISCONNECTED"}
                      aria-label="Desconectar conta"
                    >
                      {disconnecting === a.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "global" && (
        <div className="space-y-6">
          {!globalData ? (
            <PageLoader />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <StatCard label="Campanhas globais" value={globalData.campaigns} accent />
                <StatCard label="Contatos globais" value={globalData.contacts} />
              </div>
              <div className="card flex items-start gap-3 px-5 py-4">
                <Globe className="mt-0.5 h-5 w-5 shrink-0 text-gold-500" />
                <div>
                  <p className="font-medium text-cream">Base global (somente leitura)</p>
                  <p className="mt-1 text-sm text-cream/50">
                    A base global reúne os dados do administrador (dono NULL), visíveis apenas no painel de
                    administração. Campanhas e contatos globais são somente leitura e não podem ser alterados por
                    aqui.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "logs" && (
        <div className="card">
          <div className="flex flex-wrap items-center gap-2 border-b border-ink-400 px-4 py-3">
            <label htmlFor="logLevel" className="label !mb-0">Nível</label>
            <select
              id="logLevel"
              className="input !w-auto"
              value={logLevel}
              onChange={(e) => {
                setLogLevel(e.target.value);
                setLogPage(1);
              }}
            >
              <option value="">Todos</option>
              <option value="INFO">Info</option>
              <option value="WARN">Aviso</option>
              <option value="ERROR">Erro</option>
            </select>
          </div>
          {!logs ? (
            <PageLoader />
          ) : logs.items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <ScrollText className="h-8 w-8 text-cream/30" />
              <p className="text-sm text-cream/50">Nenhum evento de log encontrado.</p>
            </div>
          ) : (
            <>
              <ul className="divide-y divide-ink-400/60">
                {logs.items.map((log) => (
                  <li key={log.id} className="flex items-start gap-3 px-5 py-3">
                    <span
                      className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                        log.level === "ERROR"
                          ? "bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.8)]"
                          : log.level === "WARN"
                            ? "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]"
                            : "bg-gold-500 shadow-[0_0_8px_rgba(212,175,55,0.8)]"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-cream/80">{log.message}</p>
                      <p className="mt-0.5 text-xs text-cream/35">
                        {formatDateTime(log.createdAt)} · {log.type}
                        {log.campaignId ? ` · campanha ${log.campaignId.slice(-6)}` : ""}
                      </p>
                    </div>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        log.level === "ERROR"
                          ? "border-red-500/30 text-red-400"
                          : log.level === "WARN"
                            ? "border-amber-500/30 text-amber-400"
                            : "border-ink-400 text-cream/40"
                      }`}
                    >
                      {log.level}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="px-4 pb-4">
                <Pagination page={logPage} pageSize={50} total={logs.total} onChange={setLogPage} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
