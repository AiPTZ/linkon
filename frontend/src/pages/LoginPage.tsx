import { useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { Loader2, Lock, ShieldCheck, User, ArrowRight, MessageCircle } from "lucide-react";
import { useAuth } from "../lib/auth";
import { toastFromError, useToast } from "../components/Toast";
import { Logo } from "../components/Logo";

export function LoginPage() {
  const { user, login } = useAuth();
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/campanhas" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await login(username.trim(), password);
      toast("success", `Bem-vindo de volta, ${username.trim()}`);
      window.location.assign("/campanhas");
    } catch (err) {
      toastFromError(toast, err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-ink px-4">
      {/* Camadas de fundo com textura */}
      <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="glow-orb pointer-events-none absolute -top-40 left-1/2 h-[34rem] w-[34rem] -translate-x-1/2 rounded-full" aria-hidden="true" />
      <div className="glow-orb-gold pointer-events-none absolute -bottom-48 -left-32 h-[26rem] w-[26rem] rounded-full opacity-40" aria-hidden="true" />
      <div className="bg-grain pointer-events-none absolute inset-0" aria-hidden="true" />

      <div className="relative z-10 w-full max-w-md">
        <div className="flex justify-center">
          <Logo size="lg" />
        </div>
        <p className="mt-2 text-center font-serif text-lg text-cream/50">
          Automação de prospecção no LinkedIn
        </p>

        <div className="gold-frame card mt-8 p-8 backdrop-blur-sm">
          <div className="mb-7 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-gold-500/40 bg-gold-500/10 shadow-gold">
              <ShieldCheck className="h-5 w-5 text-gold-400" />
            </div>
            <div>
              <h1 className="font-serif text-2xl font-semibold text-cream">Entrar na sua conta</h1>
              <p className="text-xs text-cream/40">Acesso ao painel do Link ON</p>
            </div>
          </div>

          <form onSubmit={onSubmit} className="space-y-5">
            <div>
              <label htmlFor="login-username" className="label">
                Usuário
              </label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gold-500/70" />
                <input
                  id="login-username"
                  className="input !pl-10"
                  autoComplete="username"
                  required
                  placeholder="Seu usuário"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label htmlFor="login-password" className="label">
                Senha
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gold-500/70" />
                <input
                  id="login-password"
                  className="input !pl-10"
                  type="password"
                  autoComplete="current-password"
                  required
                  placeholder="Sua senha"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            <button type="submit" className="btn btn-primary w-full !py-3" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Autenticando...
                </>
              ) : (
                <>
                  Entrar
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

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
        </div>

        <p className="mt-6 text-center text-xs text-cream/30">
          Painel do Link ON — automação de prospecção no LinkedIn
        </p>
      </div>
    </div>
  );
}
