import { Link } from "react-router-dom";
import {
  CheckCircle2,
  Clock3,
  HelpCircle,
  ListChecks,
  MessageCircle,
  Play,
  Radar,
  Send,
  Settings,
  UserPlus,
} from "lucide-react";

interface Step {
  n: number;
  title: string;
  text: string;
  action?: { to: string; label: string };
  icon: typeof Settings;
}

const STEPS: Step[] = [
  {
    n: 1,
    title: "Integração configurada pelo administrador",
    text: "A conexão com o LinkedIn passa por uma integração configurada pelo administrador. Ele informa o endereço da API, o token de acesso e a URL do webhook em Administração → Integração e registra os webhooks na página Contas LinkedIn. Usuários comuns não precisam de nenhuma credencial.",
    icon: Settings,
  },
  {
    n: 2,
    title: "Conecte sua conta do LinkedIn",
    text: "Na página Conta LinkedIn, use o login nativo (e-mail e senha) ou o Assistente (conexão guiada em nova aba). Usuários comuns têm limite de 1 conta e a conexão fica Aguardando aprovação até o administrador liberar em Administração → Contas LinkedIn. O administrador conecta quantas contas precisar e já usa na hora.",
    action: { to: "/conectar", label: "Conectar conta" },
    icon: UserPlus,
  },
  {
    n: 3,
    title: "Crie uma campanha de convites (busca salva)",
    text: "A campanha prospecta perfis de uma busca do LinkedIn. Em Nova campanha, cole a URL da busca salva (normal ou Sales Navigator), escolha a conta, escreva o convite e defina a estratégia. Os resultados da busca viram leads automaticamente e recebem convite com a sua mensagem.",
    action: { to: "/campanhas/nova", label: "Criar campanha" },
    icon: Send,
  },
  {
    n: 4,
    title: "Crie um disparo de mensagens (sua rede)",
    text: "O disparo envia mensagens em massa para contatos da sua própria rede. Em Novo disparo, escolha a conta, escreva a mensagem (até 300 caracteres, com variáveis como {nome} e {cargo}) e, se quiser, monte uma cadência de acompanhamento com novas mensagens após alguns dias. Você decide para quem enviar no próximo passo.",
    action: { to: "/disparos/nova", label: "Criar disparo" },
    icon: MessageCircle,
  },
  {
    n: 5,
    title: "Ajuste os limites e o ritmo de envio",
    text: "Na criação, defina o limite diário (recomendado: 40) e semanal (150), o atraso aleatório entre envios (padrão de 5 a 15 minutos) e a janela de horário comercial. Esses controles protegem sua conta contra bloqueios do LinkedIn.",
    icon: Clock3,
  },
  {
    n: 6,
    title: "Selecione os destinatários e inicie",
    text: "No disparo, clique em Varrer rede para importar suas conexões, filtre por nome ou cargo, marque/desmarque quem vai receber e inicie. Na campanha, a importação é automática e os convites entram na fila. O primeiro envio sai na hora; os demais seguem no ritmo configurado.",
    action: { to: "/disparos", label: "Ver disparos" },
    icon: Radar,
  },
  {
    n: 7,
    title: "Acompanhe e deixe o bot responder (opcional)",
    text: "O sino de notificações avisa quando um disparo termina ou atinge o limite. Acompanhe os leads (convidado, aceito, respondido), as conversas no Inbox e os contatos extraídos com e-mail e telefone. Na Versão PRO, o bot de IA responde automaticamente quem respondeu — com fluxo visual opcional para montar o funil.",
    icon: Play,
  },
];

export function TutorialPage() {
  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-gold-500/30 bg-gold-500/10">
          <HelpCircle className="h-6 w-6 text-gold-500" />
        </div>
        <div>
          <h1 className="font-serif text-3xl font-semibold gold-gradient-text">Tutorial</h1>
          <p className="mt-1 text-sm text-cream/50">Aprenda a usar o Link ON em poucos passos</p>
        </div>
      </div>

      <ol className="mt-8 space-y-4">
        {STEPS.map((s) => (
          <li key={s.n} className="card flex gap-4 p-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold-500/10 border border-gold-500/30">
              <s.icon className="h-5 w-5 text-gold-500" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-gold-400">
                  Passo {s.n}
                </span>
                <h2 className="font-serif text-lg text-cream">{s.title}</h2>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-cream/60">{s.text}</p>
              {s.action && (
                <Link
                  to={s.action.to}
                  className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-gold-400 underline-offset-2 hover:text-gold-300 hover:underline"
                >
                  {s.action.label}
                </Link>
              )}
            </div>
          </li>
        ))}
      </ol>

      <div className="card mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 border-gold-500/25 px-5 py-4">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-400" />
          <div>
            <div className="text-sm font-medium text-cream">Boas práticas</div>
            <p className="text-xs text-cream/50">
              Comece com poucos contatos, respeite os limites diários e use a janela de envio no
              horário comercial da sua região.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <MessageCircle className="h-5 w-5 text-gold-400" />
          <div>
            <div className="text-sm font-medium text-cream">Precisa de ajuda?</div>
            <p className="text-xs text-cream/50">
              Os logs de cada campanha e o sino de notificações mostram o que acontece a cada envio.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ListChecks className="h-5 w-5 text-gold-400" />
          <div>
            <div className="text-sm font-medium text-cream">Status dos envios</div>
            <p className="text-xs text-cream/50">
              "Enviado" significa que a mensagem saiu; "Aceito" indica quem aceitou o convite e
              "Respondido", quem respondeu.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
