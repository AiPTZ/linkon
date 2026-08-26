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
