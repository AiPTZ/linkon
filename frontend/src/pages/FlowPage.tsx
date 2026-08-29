import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { api } from "../lib/api";
import { parseFlow } from "../lib/flow";
import type { Campaign, Flow } from "../types";
import { FlowEditor } from "../components/FlowEditor";
import { PageLoader } from "../components/Spinner";
import { StatusBadge } from "../components/StatusBadge";
import { useToast, toastFromError } from "../components/Toast";

export function FlowPage() {
  const { id = "" } = useParams();
  const { toast } = useToast();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<Campaign>(`/campaigns/${id}`)
      .then(setCampaign)
      .catch((e) => toastFromError(toast, e));
  }, [id, toast]);

  const onSave = useCallback(
    async (flow: Flow) => {
      setSaving(true);
      try {
        await api.put(`/campaigns/${id}`, { flow });
        toast("success", "Fluxo salvo com sucesso");
        const updated = await api.get<Campaign>(`/campaigns/${id}`);
        setCampaign(updated);
      } catch (err) {
        toastFromError(toast, err);
      } finally {
        setSaving(false);
      }
    },
    [id, toast],
  );

  if (!campaign) return <PageLoader />;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <Link to={`/campanhas/${id}`} className="inline-flex items-center gap-1.5 text-sm text-cream/50 hover:text-gold-400">
          <ArrowLeft className="h-4 w-4" />
          Voltar para a campanha
        </Link>
        <StatusBadge status={campaign.status} kind="campaign" mode={campaign.mode} />
      </div>

      <h1 className="font-serif text-3xl font-semibold gold-gradient-text">Fluxo de mensagens</h1>
      <p className="mt-1 text-sm text-cream/50">
        {campaign.name} · Monte o funil em blocos conectáveis. Quando o fluxo estiver preenchido, ele
        comanda todos os envios; o agente nativo e a mensagem de convite padrão são usados apenas quando o
        fluxo estiver vazio.
      </p>

      <div className="mt-6">
        <FlowEditor key={campaign.id} initialFlow={parseFlow(campaign.flow)} onSave={onSave} saving={saving} />
      </div>

      <div className="mt-4 flex justify-end">
        <Link to={`/campanhas/${id}`} className="btn btn-secondary">
          Concluir
        </Link>
      </div>
    </div>
  );
}
