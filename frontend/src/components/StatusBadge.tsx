import type { AccountStatus, CampaignStatus, LeadStatus } from "../types";
import {
  ACCOUNT_STATUS_LABEL,
  CAMPAIGN_STATUS_LABEL,
  LEAD_STATUS_LABEL,
  accountStatusStyle,
  campaignStatusStyle,
  leadStatusStyle,
} from "../lib/format";

type Status = CampaignStatus | AccountStatus | LeadStatus;
type Kind = "campaign" | "account" | "lead";

const LABELS = {
  campaign: CAMPAIGN_STATUS_LABEL,
  account: ACCOUNT_STATUS_LABEL,
  lead: LEAD_STATUS_LABEL,
} as const;

const STYLES = {
  campaign: campaignStatusStyle,
  account: accountStatusStyle,
  lead: leadStatusStyle,
} as const;

export function StatusBadge({
  status,
  kind,
  mode,
}: {
  status: Status;
  kind: Kind;
  mode?: "DISPARO" | "SEARCH" | "SWEEP";
}) {
  let label = (LABELS[kind] as Record<string, string>)[status] ?? status;
  if (kind === "campaign" && mode === "DISPARO" && status === "COMPLETED") {
    label = "Enviado";
  }
  const style = (STYLES[kind] as (s: Status) => string)(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${style}`}
    >
      <span
        className="h-1.5 w-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]"
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
