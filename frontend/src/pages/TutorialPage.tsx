import { Link } from "react-router-dom";
import {
  CheckCircle2,
  HelpCircle,
  ListChecks,
  MessageCircle,
  Play,
  Radar,
  Send,
  Settings,
  UserPlus,
  Workflow,
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
    title: "Configure a API da Unipile",
    text: "Acesse Configurações e informe o DSN e o Access Token da sua instância Unipile, além da URL pública do webhook. É o motor que conecta e envia pelo LinkedIn.",
    action: { to: "/configuracoes", label: "Abrir configurações" },
    icon: Settings,
  },
  {
    n: 2,
    title: "Conecte uma conta do LinkedIn",
    text: "Em Contas LinkedIn, use o login nativo (e-mail e senha) ou o assistente guiado. Confirme eventuais verificações. Você pode conectar mais de uma conta e usar cada uma em um disparo diferente.",
    action: { to: "/conectar", label: "Conectar conta" },
    icon: UserPlus,
  },
  {
    n: 3,
    title: "Crie um disparo",
    text: "Em Disparos, clique em Novo disparo, escolha a conta e escreva a mensagem. Defina limites diário/semanal e a janela de envio para proteger sua conta contra bloqueios.",
    action: { to: "/disparos/nova", label: "Criar disparo" },
    icon: Send,
  },
  {
    n: 4,
    title: "Varra a rede e selecione os contatos",
    text: "Na tela de seleção, clique em Varrer rede para importar suas conexões. Marque os contatos que receberão a mensagem e clique em Disparar.",
    action: { to: "/disparos", label: "Ver disparos" },
    icon: Radar,
  },
  {
    n: 5,
    title: "Acompanhe o envio em tempo real",
    text: "O primeiro contato é enviado na hora e os demais seguem em intervalos de 15 minutos. Na área de exibição você vê apenas os selecionados, na ordem de envio, com status Enviado ao concluir. O sino de notificações avisa quando o disparo termina.",
    icon: Play,
  },
  {
    n: 6,
    title: "Use fluxo e chatbot (opcional)",
    text: "No Fluxo, monte um funil com blocos de mensagem, espera e reação a respostas. Com o chatbot ativo, o sistema responde automaticamente mensagens recebidas conforme as regras definidas.",
    icon: Workflow,
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
              "Enviado" significa que a mensagem saiu; "Respondido" indica quem respondeu.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
