import { useEffect, useState } from "react";
import { CalendarDays, CheckCircle2, Circle, ExternalLink } from "lucide-react";
import type { ConversationSummary } from "../../types";
import { formatDateTime, shortName } from "../../lib/format";
import { Spinner } from "../Spinner";

export interface LeadContextPanelProps {
  conversation: ConversationSummary | null;
  savingNote: boolean;
  onSaveNote: (note: string) => Promise<void>;
  onToggleResolved: () => Promise<void>;
}

export function LeadContextPanel({ conversation, savingNote, onSaveNote, onToggleResolved }: LeadContextPanelProps) {
  const [note, setNote] = useState(conversation?.note ?? "");

  useEffect(() => {
    setNote(conversation?.note ?? "");
  }, [conversation?.id, conversation?.note]);

  if (!conversation) return null;

  return (
    <div className="card space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-serif text-lg font-semibold text-cream">Lead</h2>
        <button
          type="button"
          onClick={onToggleResolved}
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            conversation.resolved
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : "border-ink-400 text-cream/50 hover:text-cream/80"
          }`}
        >
          {conversation.resolved ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
          {conversation.resolved ? "Resolvida" : "Marcar como resolvida"}
        </button>
      </div>

      <div className="text-sm">
        <div className="font-medium text-cream">{shortName(conversation.lead?.name, "Lead")}</div>
        {conversation.lead?.headline && <div className="text-cream/50">{conversation.lead.headline}</div>}
        {conversation.lead?.profileUrl && (
          <a
            href={conversation.lead.profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-xs text-gold-400 hover:text-gold-300"
          >
            <ExternalLink className="h-3 w-3" /> Ver perfil no LinkedIn
          </a>
        )}
      </div>

      {conversation.campaign && (
        <div className="text-sm">
          <div className="text-xs uppercase tracking-wide text-cream/30">Campanha</div>
          <div className="text-cream/70">{conversation.campaign.name}</div>
        </div>
      )}

      {conversation.booking && (
        <div className="text-sm">
          <div className="text-xs uppercase tracking-wide text-cream/30">Reunião</div>
          <div className="flex items-center gap-1.5 text-cream/70">
            <CalendarDays className="h-3.5 w-3.5 text-gold-400" />
            {formatDateTime(conversation.booking.startTime)}
          </div>
          {conversation.booking.meetLink && (
            <a
              href={conversation.booking.meetLink}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-300 hover:text-emerald-200"
            >
              <ExternalLink className="h-3 w-3" /> Abrir Meet
            </a>
          )}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSaveNote(note);
        }}
      >
        <div className="text-xs uppercase tracking-wide text-cream/30">Nota interna</div>
        <textarea
          className="input mt-1 min-h-[80px] w-full resize-none"
          placeholder="Anotações do vendedor..."
          value={note}
          maxLength={2000}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="mt-1 flex items-center justify-between">
          <button type="submit" className="btn btn-primary" disabled={savingNote || note === conversation.note}>
            {savingNote ? <Spinner className="h-4 w-4" /> : "Salvar nota"}
          </button>
        </div>
      </form>
    </div>
  );
}
