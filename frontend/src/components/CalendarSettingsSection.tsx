import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CalendarDays, Link2, Loader2, Save, Unlink } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast, toastFromError } from "../components/Toast";
import { ProLock, isPro } from "./ProLock";

interface CalendarStatus {
  connected: boolean;
  googleEmail: string;
  disconnectedAt: string | null;
}

interface WindowRow {
  weekday: number;
  startMin: number;
  endMin: number;
}

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function toHHMM(min: number): string {
  const h = String(Math.floor(min / 60)).padStart(2, "0");
  const m = String(min % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function fromHHMM(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function CalendarSettingsSection() {
  const { toast } = useToast();
  const { user } = useAuth();
  const aiAllowed = isPro(user);
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [windows, setWindows] = useState<WindowRow[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    if (!aiAllowed) return;
    api.get<CalendarStatus>("/calendar/status").then(setStatus).catch(() => setStatus(null));
    api.get<{ windows: WindowRow[] }>("/calendar/availability").then((r) => setWindows(r.windows)).catch(() => {});
  }, [aiAllowed]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("calendar") === "connected") {
      toast("success", "Google Agenda conectado!");
      window.history.replaceState({}, "", window.location.pathname);
      load();
    } else if (params.get("calendar") === "error") {
      toast("error", "Falha ao conectar o Google Agenda.");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [toast, load]);

  async function onConnect() {
    setConnecting(true);
    try {
      const r = await api.get<{ url: string }>("/calendar/oauth/url");
      window.location.assign(r.url);
    } catch (err) {
      toastFromError(toast, err);
      setConnecting(false);
    }
  }

  async function onDisconnect() {
    try {
      await api.post("/calendar/disconnect");
      toast("success", "Google Agenda desconectado.");
      load();
    } catch (err) {
      toastFromError(toast, err);
    }
  }

  function toggleDay(weekday: number) {
    const exists = windows.some((w) => w.weekday === weekday);
    if (exists) {
      setWindows(windows.filter((w) => w.weekday !== weekday));
    } else {
      setWindows([...windows, { weekday, startMin: 540, endMin: 1080 }]);
    }
  }

  function patchWindow(weekday: number, patch: Partial<WindowRow>) {
    setWindows(windows.map((w) => (w.weekday === weekday ? { ...w, ...patch } : w)));
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put("/calendar/availability", windows);
      toast("success", "Disponibilidade salva.");
    } catch (err) {
      toastFromError(toast, err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card mt-6 p-5">
      <h2 className="flex items-center gap-2 font-serif text-lg text-gold-400">
        <CalendarDays className="h-5 w-5" />
        Google Agenda
      </h2>
      <p className="mt-1 text-sm text-cream/50">
        A IA usa sua agenda para oferecer horários reais de reunião aos leads.
      </p>

      {aiAllowed ? (
        <>
          {status && (
            <div className="mt-4 rounded-lg border border-ink-400 bg-ink-800 px-4 py-3">
              {status.connected ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm text-emerald-400">
                    <Link2 className="h-4 w-4" />
                    Conectado como {status.googleEmail || "conta Google"}
                  </div>
                  <button type="button" className="btn btn-secondary" onClick={onDisconnect}>
                    <Unlink className="h-4 w-4" />
                    Desconectar
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm text-cream/60">Nenhuma conta conectada.</span>
                  <button type="button" className="btn btn-primary" onClick={onConnect} disabled={connecting}>
                    {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                    Conectar Google Agenda
                  </button>
                </div>
              )}
            </div>
          )}

          <form onSubmit={onSave} className="mt-5 space-y-4">
            <div>
              <span className="label !mb-2">Horários de disponibilidade</span>
              <div className="space-y-2">
                {WEEKDAYS.map((name, weekday) => {
                  const w = windows.find((x) => x.weekday === weekday);
                  return (
                    <div key={weekday} className="flex flex-wrap items-center gap-3 rounded-lg border border-ink-400 bg-ink-800 px-3 py-2">
                      <label className="flex w-28 items-center gap-2 text-sm text-cream/80">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-gold-500"
                          checked={Boolean(w)}
                          onChange={() => toggleDay(weekday)}
                        />
                        {name}
                      </label>
                      {w && (
                        <>
                          <input
                            type="time"
                            className="input !w-auto"
                            value={toHHMM(w.startMin)}
                            onChange={(e) => patchWindow(weekday, { startMin: fromHHMM(e.target.value) })}
                            aria-label={`Início ${name}`}
                          />
                          <span className="text-cream/40">até</span>
                          <input
                            type="time"
                            className="input !w-auto"
                            value={toHHMM(w.endMin)}
                            onChange={(e) => patchWindow(weekday, { endMin: fromHHMM(e.target.value) })}
                            aria-label={`Fim ${name}`}
                          />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="mt-1.5 text-xs text-cream/40">
                Sem janelas ativas, a IA não oferece agendamento e transfere a conversa.
              </p>
            </div>
            <div className="flex justify-end">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Salvar disponibilidade
              </button>
            </div>
          </form>
        </>
      ) : (
        <ProLock description="A IA usa sua agenda para oferecer horários reais de reunião aos leads. Disponível na Versão PRO." />
      )}
    </section>
  );
}
