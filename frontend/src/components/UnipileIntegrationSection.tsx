import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, KeyRound, Save, ShieldCheck, XCircle } from "lucide-react";
import { api } from "../lib/api";
import type { ConfigInfo, HealthInfo } from "../types";
import { useToast, toastFromError } from "./Toast";

export function UnipileIntegrationSection() {
  const { toast } = useToast();
  const [config, setConfig] = useState<ConfigInfo | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [dsn, setDsn] = useState("");
  const [token, setToken] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [saving, setSaving] = useState(false);

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
    load();
  }, [load]);

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

  if (!config || !health) return null;

  const dsnOk = config.unipileDsnConfigured;
  const tokenOk = config.unipileAccessTokenConfigured;

  return (
    <div className="space-y-6">
      <div className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-gold-500/30 bg-gold-500/10">
            <ShieldCheck className="h-5 w-5 text-gold-500" />
          </div>
          <div>
            <div className="text-sm font-medium text-cream">Status da integração</div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-cream/60">
              <span className="inline-flex items-center gap-1">
                {health.unipileConfigured ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-red-400" />
                )}
                {health.unipileConfigured ? "Configurada" : "Não configurada"}
              </span>
              <span>·</span>
              <span>DSN {dsnOk ? "definido" : "vazio"}</span>
              <span>·</span>
              <span>Access Token {tokenOk ? "definido" : "vazio"}</span>
              <span>·</span>
              <span>Webhook {config.webhookPublicUrlConfigured ? "definido" : "vazio"}</span>
            </div>
          </div>
        </div>
      </div>

      <form onSubmit={onSave} className="card space-y-5 p-5">
        <h2 className="flex items-center gap-2 font-serif text-lg text-gold-400">
          <KeyRound className="h-5 w-5" />
          Credenciais da Unipile
        </h2>
        <p className="text-sm text-cream/50">
          Estas credenciais são usadas pela plataforma para conectar e enviar pelo LinkedIn. Apenas
          o administrador pode alterá-las.
        </p>

        <div>
          <label htmlFor="unipileDsn" className="label">
            DSN da Unipile {dsnOk && <CheckCircle2 className="ml-1 inline h-3.5 w-3.5 text-emerald-400" />}
          </label>
          <input
            id="unipileDsn"
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
          <label htmlFor="unipileAccessToken" className="label">
            Access Token {tokenOk && <CheckCircle2 className="ml-1 inline h-3.5 w-3.5 text-emerald-400" />}
          </label>
          <input
            id="unipileAccessToken"
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
          <label htmlFor="webhookPublicUrl" className="label">
            URL pública do webhook
          </label>
          <input
            id="webhookPublicUrl"
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

      <section className="card p-5">
        <h2 className="font-serif text-lg text-gold-400">Webhooks registrados</h2>
        {config.webhooks.length === 0 ? (
          <p className="mt-2 text-sm text-cream/50">
            Nenhum webhook registrado. Use a página{" "}
            <span className="text-cream">Contas LinkedIn</span> (seção de webhooks, no painel do
            administrador) para registrar.
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
    </div>
  );
}
