import type { AccountStatus, CampaignStatus, LeadStatus, UserStatus } from "../types";

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  DRAFT: "Rascunho",
  IMPORTING: "Importando leads",
  RUNNING: "Ativa",
  PAUSED: "Pausada",
  LIMIT_HIT: "Limite atingido",
  COMPLETED: "Concluída",
  ERROR: "Erro",
};

export const ACCOUNT_STATUS_LABEL: Record<AccountStatus, string> = {
  CONNECTING: "Conectando",
  OK: "Conectada",
  CHECKPOINT: "Verificação pendente",
  DISCONNECTED: "Desconectada",
  ERROR: "Erro",
  STOPPED: "Parada",
  CREDENTIALS: "Credenciais inválidas",
  PERMISSIONS: "Sem permissão",
  PENDING_LINKEDIN: "Aguardando aprovação",
  REJECTED: "Rejeitada",
};

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  PENDING: "Pendente",
  INVITED: "Convidado",
  ACCEPTED: "Aceito",
  RESPONDED: "Respondido",
  ERROR: "Erro",
  COMPLETED: "Enviado",
};

export function campaignStatusStyle(status: CampaignStatus): string {
  switch (status) {
    case "RUNNING":
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "IMPORTING":
      return "bg-sky-500/15 text-sky-400 border-sky-500/30";
    case "PAUSED":
      return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    case "LIMIT_HIT":
      return "bg-orange-500/15 text-orange-400 border-orange-500/30";
    case "COMPLETED":
      return "bg-gold-500/15 text-gold-400 border-gold-500/30";
    case "ERROR":
      return "bg-red-500/15 text-red-400 border-red-500/30";
    default:
      return "bg-ink-500/40 text-cream/60 border-ink-400";
  }
}

export const USER_STATUS_LABEL: Record<UserStatus, string> = {
  PENDING: "Pendente",
  ACTIVE: "Ativo",
  BLOCKED: "Bloqueado",
};

export function userStatusStyle(status: UserStatus): string {
  switch (status) {
    case "ACTIVE":
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "BLOCKED":
      return "bg-red-500/15 text-red-400 border-red-500/30";
    default:
      return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  }
}

export function accountStatusStyle(status: AccountStatus): string {
  switch (status) {
    case "OK":
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "CHECKPOINT":
      return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    case "PENDING_LINKEDIN":
      return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    case "DISCONNECTED":
    case "ERROR":
    case "REJECTED":
      return "bg-red-500/15 text-red-400 border-red-500/30";
    default:
      return "bg-ink-500/40 text-cream/60 border-ink-400";
  }
}

export function leadStatusStyle(status: LeadStatus): string {
  switch (status) {
    case "ACCEPTED":
    case "RESPONDED":
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "INVITED":
      return "bg-sky-500/15 text-sky-400 border-sky-500/30";
    case "COMPLETED":
      return "bg-gold-500/15 text-gold-400 border-gold-500/30";
    case "ERROR":
      return "bg-red-500/15 text-red-400 border-red-500/30";
    default:
      return "bg-ink-500/40 text-cream/60 border-ink-400";
  }
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function parseJsonArray<T>(raw: string): T[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

export function shortName(name: string | null | undefined, fallback: string): string {
  return name || fallback;
}
