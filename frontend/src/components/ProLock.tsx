import { Crown, MessageCircle } from "lucide-react";

const DEFAULT_WHATSAPP = "5519990041826";

export function proWhatsAppUrl(text: string): string {
  const number = import.meta.env.VITE_WHATSAPP_SUPPORT ?? DEFAULT_WHATSAPP;
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

export function isPro(user: { role: string; pro?: boolean } | null): boolean {
  return user?.role === "ADMIN" || user?.pro === true;
}

export const PRO_DEFAULT_DESCRIPTION =
  "Essa função usa inteligência artificial e está disponível apenas na Versão PRO.";

export function ProLock({ description = PRO_DEFAULT_DESCRIPTION }: { description?: string }) {
  return (
    <div className="flex min-h-[45vh] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-gold-500/40 bg-gold-500/5 p-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gold-500/10 text-gold-400">
        <Crown className="h-6 w-6" />
      </div>
      <h2 className="font-serif text-xl font-semibold text-cream">Versão PRO</h2>
      <p className="max-w-sm text-sm text-cream/60">{description}</p>
      <a
        href={proWhatsAppUrl("Olá! Quero contratar a Versão PRO do Link ON.")}
        target="_blank"
        rel="noopener noreferrer"
        className="btn btn-primary"
      >
        <MessageCircle className="h-4 w-4" />
        Contrate agora a Versão PRO
      </a>
    </div>
  );
}
