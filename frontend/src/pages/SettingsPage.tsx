import { useState } from "react";
import { api } from "../lib/api";
import { useToast, toastFromError } from "../components/Toast";
import { CalendarSettingsSection } from "../components/CalendarSettingsSection";

export function SettingsPage() {
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  return (
    <div className="max-w-3xl">
      <h1 className="font-serif text-3xl font-semibold gold-gradient-text">Configurações da conta</h1>
      <p className="mt-1 text-sm text-cream/50">
        Preferências da sua conta, senha e agenda de disponibilidade
      </p>

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

      <CalendarSettingsSection />
    </div>
  );
}
