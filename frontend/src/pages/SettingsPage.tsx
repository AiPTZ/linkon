import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Activity, CheckCircle2, KeyRound, Link2, Save, Server, XCircle } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { ConfigInfo, HealthInfo } from "../types";
import { PageLoader } from "../components/Spinner";
import { useToast, toastFromError } from "../components/Toast";

export function SettingsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [config, setConfig] = useState<ConfigInfo | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [dsn, setDsn] = useState("");
  const [token, setToken] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const load = useCallback(() => {
    api
      .get<ConfigInfo>("/config")
      .then((c) => {
        setConfig(c);
        if (c.webhookPublicUrl) setWebhookUrl(c.webhookPublicUrl);
      })
      .catch((e) => toastFromError(toast, e));
    api.get<HealthInfo>("/health").then(setHealth).catch((e) => toastFromError(toast, e));
  }, [toast]);

  useEffect(() => {
    if (isAdmin) load();
  }, [load, isAdmin]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put("/config", {
        unipileDsn: dsn,
        unipileAccessToken: token,
        webhookPublicUrl: webhookUrl,
      });
      toast("success", "Configurações salvas");
      setToken("");
      load();
    } catch (err) {
      toastFromError(toast, err);
    } finally {
      setSaving(false);
    }
  }

  if (isAdmin && (!config || !health)) return <PageLoader />;

  const dsnOk = config?.unipileDsnConfigured ?? false;
  const tokenOk = config?.unipileAccessTokenConfigured ?? false;

  return (
    <div className="max-w-3xl">
      <h1 className="font-serif text-3xl font-semibold gold-gradient-text">Configurações</h1>
      <p className="mt-1 text-sm text-cream/50">
        Integração com a Unipile, webhooks e status do sistema
      </p>

      {isAdmin && config && health && (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="card flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold-500/10 border border-gold-500/30">
            <Activity className="h-5 w-5 text-gold-500" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-cream/40">Servidor</div>
            <div className={`flex items-center gap-1.5 text-sm font-medium ${health.ok ? "text-emerald-400" : "text-red-400"}`}>
              {health.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              Online
            </div>
          </div>
        </div>
        <div className="card flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold-500/10 border border-gold-500/30">
            <Server className="h-5 w-5 text-gold-500" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-cream/40">Redis</div>
            <div className={`flex items-center gap-1.5 text-sm font-medium ${health.redis ? "text-emerald-400" : "text-red-400"}`}>
              {health.redis ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              {health.redis ? "Operacional" : "Indisponível"}
            </div>
          </div>
        </div>
        <div className="card flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold-500/10 border border-gold-500/30">
            <Link2 className="h-5 w-5 text-gold-500" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-cream/40">Unipile</div>
            <div className={`flex items-center gap-1.5 text-sm font-medium ${health.unipileConfigured ? "text-emerald-400" : "text-red-400"}`}>
              {health.unipileConfigured ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              {health.unipileConfigured ? "Configurada" : "Não configurada"}
            </div>
          </div>
        </div>
      </div>

      <form onSubmit={onSave} className="card mt-6 space-y-5 p-5">
        <h2 className="flex items-center gap-2 font-serif text-lg text-gold-400">
          <KeyRound className="h-5 w-5" />
          Credenciais da Unipile
        </h2>

        <div>
          <label htmlFor="dsn" className="label">
            DSN da Unipile {dsnOk && <CheckCircle2 className="ml-1 inline h-3.5 w-3.5 text-emerald-400" />}
          </label>
          <input
            id="dsn"
            className="input"
            type="url"
            placeholder="https://api1.unipile.com:13111"
            value={dsn}
            onChange={(e) => setDsn(e.target.value)}
          />
          <p className="mt-1.5 text-xs text-cream/40">
            Endereço da sua instância Unipile. Ex: https://api1.unipile.com:13111
          </p>
        </div>

        <div>
          <label htmlFor="token" className="label">
            Access Token {tokenOk && <CheckCircle2 className="ml-1 inline h-3.5 w-3.5 text-emerald-400" />}
          </label>
          <input
            id="token"
            className="input"
            type="password"
            placeholder={tokenOk ? "•••••••• (definido)" : "Cole seu access token"}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <p className="mt-1.5 text-xs text-cream/40">
            O token nunca é exibido novamente após salvar. Deixe em branco para manter o atual.
          </p>
        </div>

        <div>
          <label htmlFor="webhookUrl" className="label">
            URL pública do webhook
          </label>
          <input
            id="webhookUrl"
            className="input"
            type="url"
            placeholder="https://seu-dominio.com"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
          />
          <p className="mt-1.5 text-xs text-cream/40">
            URL base pública onde este servidor é acessível. A Unipile enviará eventos para{" "}
            <code className="text-gold-400">{webhookUrl}/api/webhooks/unipile</code>. Necessária
            para detecção de aceites e mensagens.
          </p>
        </div>

        <div className="flex justify-end">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Salvando..." : "Salvar configurações"}
            {!saving && <Save className="h-4 w-4" />}
          </button>
        </div>
      </form>

      <section className="card mt-6 p-5">
        <h2 className="font-serif text-lg text-gold-400">Webhooks registrados</h2>
        {config.webhooks.length === 0 ? (
          <p className="mt-2 text-sm text-cream/50">
            Nenhum webhook registrado. Use a página{" "}
            <span className="text-cream">Contas LinkedIn</span> para registrar.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {config.webhooks.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-3 rounded-lg border border-ink-400 bg-ink-800 px-4 py-2.5 text-sm">
                <span className="font-medium capitalize text-cream">{w.source}</span>
                <code className="truncate text-xs text-cream/50">{w.requestUrl}</code>
              </li>
            ))}
          </ul>
        )}
      </section>
        </>
      )}

      <form
        className="card mt-6 space-y-4 p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.post("/auth/change-password", { currentPassword, newPassword });
            toast("success", "Senha alterada");
            setCurrentPassword("");
            setNewPassword("");
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
    </div>
  );
}
