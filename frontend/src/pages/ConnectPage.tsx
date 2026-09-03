import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Unplug,
  UserPlus,
  Webhook,
} from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Account } from "../types";
import { StatusBadge } from "../components/StatusBadge";
import { PageLoader } from "../components/Spinner";
import { useToast, toastFromError } from "../components/Toast";

interface HostedResponse {
  url: string;
}

interface NativeResponse {
  status: "OK" | "CHECKPOINT";
  accountId?: string;
  checkpoint?: string;
}

export function ConnectPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [params] = useSearchParams();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [unipileConfigured, setUnipileConfigured] = useState<boolean | null>(null);

  const [nativeOpen, setNativeOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [country, setCountry] = useState("");
  const [nativeLoading, setNativeLoading] = useState(false);

  const [checkpointAccountId, setCheckpointAccountId] = useState<string | null>(null);
  const [checkpointType, setCheckpointType] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [checkpointLoading, setCheckpointLoading] = useState(false);

  const [hostedLoading, setHostedLoading] = useState(false);
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [webhookResult, setWebhookResult] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

  const loadAccounts = useCallback(() => {
    api
      .get<{ items: Account[] }>("/accounts")
      .then((r) => setAccounts(r.items))
      .catch((e) => toastFromError(toast, e));
  }, [toast]);

  useEffect(() => {
    api
      .get<{ unipileConfigured: boolean }>("/health")
      .then((h) => setUnipileConfigured(h.unipileConfigured))
      .catch(() => setUnipileConfigured(false));
    loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    if (params.get("hosted") === "ok") {
      api
        .post<{ accounts: number }>("/accounts/confirm-hosted")
        .then((r) => toast("success", r.accounts > 0 ? "Conta conectada e enviada para aprovação" : "Aguardando conexão..."))
        .catch((e) => toastFromError(toast, e))
        .finally(loadAccounts);
    }
  }, [params, loadAccounts, toast]);

  async function onNativeSubmit(e: FormEvent) {
    e.preventDefault();
    setNativeLoading(true);
    try {
      const res = await api.post<NativeResponse>("/auth/native", { username, password, country: country || undefined });
      if (res.status === "CHECKPOINT") {
        setCheckpointAccountId(res.accountId ?? null);
        setCheckpointType(res.checkpoint ?? null);
        setPassword("");
      } else {
        toast("success", "Conta conectada com sucesso");
        setUsername("");
        setPassword("");
        setNativeOpen(false);
        loadAccounts();
      }
    } catch (err) {
      toastFromError(toast, err);
    } finally {
      setNativeLoading(false);
    }
  }

  async function onCheckpointSubmit(e: FormEvent) {
    e.preventDefault();
    if (!checkpointAccountId) return;
    setCheckpointLoading(true);
    try {
      const res = await api.post<NativeResponse>("/auth/native/checkpoint", {
        accountId: checkpointAccountId,
        code,
      });
      if (res.status === "CHECKPOINT") {
        setCheckpointType(res.checkpoint ?? null);
        setCode("");
        toast("warning", `Verificação adicional solicitada: ${res.checkpoint}`);
      } else {
        toast("success", "Verificação concluída. Conta conectada!");
        setCheckpointAccountId(null);
        setCode("");
        setNativeOpen(false);
        loadAccounts();
      }
    } catch (err) {
      toastFromError(toast, err);
    } finally {
      setCheckpointLoading(false);
    }
  }

  async function onHosted() {
    setHostedLoading(true);
    try {
      const res = await api.post<HostedResponse>("/auth/hosted");
      window.open(res.url, "_blank", "noopener,noreferrer");
      toast("success", "Abrindo assistente de conexão do LinkedIn em nova aba...");
    } catch (err) {
      toastFromError(toast, err);
    } finally {
      setHostedLoading(false);
    }
  }

  async function onDisconnect(acc: Account) {
    const name = acc.username ?? acc.unipileAccountId;
    if (!window.confirm(`Desconectar a conta "${name}" do LinkedIn? As campanhas existentes serão mantidas.`)) {
      return;
    }
    setDisconnectingId(acc.id);
    try {
      await api.post(`/accounts/${acc.id}/disconnect`);
      toast("success", `Conta "${name}" desconectada`);
      loadAccounts();
    } catch (err) {
      toastFromError(toast, err);
    } finally {
      setDisconnectingId(null);
    }
  }

  async function onRegisterWebhooks() {
    setWebhookLoading(true);
    try {
      const res = await api.post<{ messagingId?: string; usersId?: string }>("/auth/webhooks");
      const parts = [];
      if (res.messagingId) parts.push("mensagens");
      if (res.usersId) parts.push("relações");
      setWebhookResult(parts.length > 0 ? `Webhooks registrados: ${parts.join(" e ")}` : "Webhooks já registrados");
      toast("success", "Webhooks configurados com sucesso");
    } catch (err) {
      toastFromError(toast, err);
    } finally {
      setWebhookLoading(false);
    }
  }

  if (accounts === null || unipileConfigured === null) return <PageLoader />;

  return (
    <div className="max-w-3xl">
      <h1 className="font-serif text-3xl font-semibold gold-gradient-text">Contas LinkedIn</h1>
      <p className="mt-1 text-sm text-cream/50">
        Conecte suas contas do LinkedIn para usar nas campanhas
      </p>

      {!unipileConfigured && (
        <div className="mt-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          A API da Unipile ainda não foi configurada.{" "}
          {isAdmin ? (
            <Link to="/administracao" className="underline hover:text-amber-200">
              Configure a integração no painel de Administração
            </Link>
          ) : (
            <span>aguarde o administrador configurar a integração.</span>
          )}{" "}
          antes de conectar contas.
        </div>
      )}

      {(!isAdmin && accounts.length > 0) ? null : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {isAdmin && (
            <button
              type="button"
              className="card group p-5 text-left transition-all hover:border-gold-500/40"
              onClick={() => {
                if (!unipileConfigured) return;
                setNativeOpen((v) => !v);
                setCheckpointAccountId(null);
              }}
              disabled={!unipileConfigured}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold-500/10 border border-gold-500/30">
                  <KeyRound className="h-5 w-5 text-gold-500" />
                </div>
                <div>
                  <h2 className="font-medium text-cream">Login nativo (email e senha)</h2>
                  <p className="text-xs text-cream/50">Conexão direta com a conta LinkedIn</p>
                </div>
              </div>
            </button>
          )}

          <button
            type="button"
            className="card group p-5 text-left transition-all hover:border-gold-500/40 disabled:opacity-40"
            onClick={onHosted}
            disabled={!unipileConfigured || hostedLoading}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold-500/10 border border-gold-500/30">
                {hostedLoading ? <Loader2 className="h-5 w-5 animate-spin text-gold-500" /> : <ShieldCheck className="h-5 w-5 text-gold-500" />}
              </div>
              <div>
                <h2 className="font-medium text-cream">Assistente do LinkedIn</h2>
                <p className="text-xs text-cream/50">
                  Conexão guiada em nova aba (recomendado) <ExternalLink className="inline h-3 w-3" />
                </p>
              </div>
            </div>
          </button>
        </div>
      )}

      {nativeOpen && unipileConfigured && (
        <form onSubmit={onNativeSubmit} className="card mt-4 space-y-4 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-cream">Credenciais da conta</h2>
            <button
              type="button"
              className="text-xs text-cream/40 hover:text-cream"
              onClick={() => setNativeOpen(false)}
            >
              Fechar
            </button>
          </div>
          <div>
            <label htmlFor="username" className="label">E-mail do LinkedIn *</label>
            <input
              id="username"
              className="input"
              required
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="password" className="label">Senha *</label>
            <input
              id="password"
              className="input"
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="country" className="label">País (opcional)</label>
            <input
              id="country"
              className="input"
              placeholder="Ex: BR"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary w-full" disabled={nativeLoading}>
            {nativeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Conectar
          </button>
          <p className="text-xs text-cream/40">
            Suas credenciais são criptografadas e usadas apenas para autenticar na Unipile.
          </p>
        </form>
      )}

      {checkpointAccountId && (
        <form onSubmit={onCheckpointSubmit} className="card mt-4 space-y-4 border-amber-500/40 p-5">
          <div>
            <h2 className="font-medium text-cream">Verificação necessária</h2>
            <p className="mt-1 text-sm text-cream/60">
              {checkpointType === "OTP"
                ? "Digite o código enviado por SMS/e-mail pelo LinkedIn."
                : `O LinkedIn solicitou verificação (${checkpointType ?? "desconhecida"}). Digite o código recebido.`}
            </p>
          </div>
          <div>
            <label htmlFor="code" className="label">Código de verificação *</label>
            <input
              id="code"
              className="input"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Código de 6 dígitos"
              autoComplete="one-time-code"
            />
          </div>
          <button type="submit" className="btn btn-primary w-full" disabled={checkpointLoading}>
            {checkpointLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Verificar
          </button>
        </form>
      )}

      {isAdmin && (
        <section className="card mt-6 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Webhook className="h-4 w-4 text-gold-500" />
              <h2 className="font-medium text-cream">Webhooks da Unipile</h2>
            </div>
            <button type="button" className="btn btn-secondary" disabled={webhookLoading || !unipileConfigured} onClick={onRegisterWebhooks}>
              {webhookLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Registrar webhooks
            </button>
          </div>
          <p className="mt-2 text-sm text-cream/50">
            Necessário para detectar aceite de convites e mensagens em tempo real. Exige a URL pública
            do webhook configurada no{" "}
            <Link to="/administracao" className="underline text-gold-400 hover:text-gold-300">
              painel de Administração
            </Link>
            .
          </p>
          {webhookResult && <p className="mt-2 text-sm text-emerald-400">{webhookResult}</p>}
        </section>
      )}

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-serif text-xl text-cream">Contas conectadas</h2>
          {isAdmin && (
            <button type="button" className="btn btn-secondary !px-3 !py-1.5 text-xs" onClick={loadAccounts}>
              <RefreshCw className="h-3.5 w-3.5" />
              Sincronizar
            </button>
          )}
        </div>

        {accounts.length === 0 ? (
          <div className="card flex flex-col items-center gap-3 px-6 py-12 text-center">
            <UserPlus className="h-8 w-8 text-cream/30" />
            <p className="text-sm text-cream/50">Nenhuma conta conectada ainda.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {accounts.map((a) => (
              <li key={a.id} className="card flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold-500/10 border border-gold-500/30">
                    <UserPlus className="h-4 w-4 text-gold-500" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-medium text-cream">{a.username ?? a.unipileAccountId}</div>
                    <div className="text-xs text-cream/40">
                      {a.authMethod === "NATIVE" ? "Login nativo" : "Assistente"} · {a.campaigns?.length ?? a._count?.campaigns ?? 0} campanhas
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {a.status === "OK" && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                  <StatusBadge status={a.status} kind="account" />
                  {a.status !== "DISCONNECTED" && (
                    <button
                      type="button"
                      className="btn btn-secondary !px-2.5 !py-1.5 text-xs"
                      disabled={disconnectingId !== null}
                      onClick={() => onDisconnect(a)}
                      title="Desconectar do LinkedIn"
                    >
                      {disconnectingId === a.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Unplug className="h-3.5 w-3.5" />
                      )}
                      Desconectar
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
