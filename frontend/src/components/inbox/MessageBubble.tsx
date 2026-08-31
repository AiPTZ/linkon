import type { ConversationMessage } from "../../types";
import { formatTime } from "../../lib/format";

const ROLE_LABEL: Record<ConversationMessage["role"], string> = {
  LEAD: "Lead",
  BOT: "Bot",
  HUMAN: "Você",
  SYSTEM: "Sistema",
};

function roleColor(role: ConversationMessage["role"]): string {
  switch (role) {
    case "LEAD":
      return "bg-ink-700 text-cream";
    case "BOT":
      return "bg-gold-500/15 text-gold-300";
    case "HUMAN":
      return "bg-emerald-500/15 text-emerald-300";
    case "SYSTEM":
      return "bg-amber-500/15 text-amber-300";
    default:
      return "bg-ink-700 text-cream";
  }
}

export function MessageBubble({ message }: { message: ConversationMessage }) {
  return (
    <div className={`flex ${message.role === "LEAD" ? "justify-start" : "justify-end"}`}>
      <div className={`max-w-[75%] rounded-2xl px-3 py-2 ${roleColor(message.role)}`}>
        <div className="mb-0.5 flex items-center gap-2 text-[10px] text-cream/40">
          <span>{ROLE_LABEL[message.role]}</span>
          <span>{formatTime(message.createdAt)}</span>
        </div>
        <div className="whitespace-pre-wrap break-words text-sm text-cream">{message.content}</div>
        {message.costUsd != null && message.role === "BOT" && (
          <div className="mt-1 text-[10px] text-cream/30">custo ~US$ {message.costUsd.toFixed(5)}</div>
        )}
      </div>
    </div>
  );
}
