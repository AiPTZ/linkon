import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  Bot,
  CheckCircle2,
  Clock3,
  FileText,
  HeartHandshake,
  Linkedin,
  LogIn,
  Mail,
  MousePointerClick,
  Phone,
  Play,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  UserPlus,
  Users,
  Zap,
} from "lucide-react";
import { Logo } from "../components/Logo";

const FEATURES = [
  {
    icon: UserPlus,
    title: "Convites e disparos em escala",
    desc: "Envia convites personalizados para buscas salvas do LinkedIn e mensagens em massa para a sua rede — até 300 caracteres, com a identidade da sua marca.",
  },
  {
    icon: Clock3,
    title: "Comportamento humano",
    desc: "Atrasos aleatórios entre envios (padrão de 5 a 15 min), janela de horário comercial e limites diários e semanais configuráveis por campanha.",
  },
  {
    icon: Zap,
    title: "Detecção de aceite em tempo real",
    desc: "Webhooks new_relation e message_received identificam quem aceitou e quem já enviou mensagem, atualizando os leads na hora.",
  },
  {
    icon: Bot,
    title: "Bot de IA para respostas",
    desc: "Na Versão PRO, o bot com IA responde automaticamente quem aceita ou responde, com fluxo visual e transferência para um humano no Inbox.",
  },
  {
    icon: ShieldCheck,
    title: "Segurança e limites",
    desc: "Limites recomendados pelo LinkedIn (40/dia, 150/semana), criptografia das credenciais e fila de processamento com retry.",
  },
  {
    icon: BarChart3,
    title: "Painel completo",
    desc: "Leads com status, aceites e respostas, contatos com e-mail e telefone exportáveis, logs de todas as ações e saúde do sistema em um só lugar.",
  },
];

const STEPS = [
  {
    title: "Administrador configura a integração",
    desc: "Em Administração → Integração, o admin informa o endereço da API, o token de acesso e a URL do webhook e registra os webhooks. Usuários não precisam de credenciais.",
  },
  {
    title: "Conecte sua conta do LinkedIn",
    desc: "Na página Conta LinkedIn, conecte pelo login nativo (e-mail e senha) ou pelo Assistente. A conexão é validada na hora e a conta já fica disponível para uso nas campanhas.",
  },
  {
    title: "Crie a campanha de convites",
    desc: "No LinkedIn, monte uma busca de pessoas (normal ou Sales Navigator), salve e copie a URL. Cole na campanha: a automação importa os perfis e envia o convite com a sua mensagem.",
  },
  {
    title: "Crie o disparo para a sua rede",
    desc: "Para falar com quem já é seu contato, crie um disparo com mensagem personalizada e cadência de acompanhamento opcional. No passo seguinte você escolhe os destinatários.",
  },
  {
    title: "Ajuste ritmo e limites",
    desc: "Defina limites diários/semanais, o atraso entre envios e a janela comercial. Ative o fluxo visual ou o bot de IA (PRO) para automatizar as respostas.",
  },
  {
    title: "Inicie e acompanhe",
    desc: "Varra a rede e selecione os contatos no disparo, ou deixe a campanha importar a busca. Acompanhe aceites e respostas em tempo real e exporte contatos com e-mail e telefone.",
  },
];

const TIPS = [
  "Use LinkedIn Premium ou Sales Navigator para mais resultados e menor risco de restrições.",
  "Respeite os limites: 40 convites/dia e 150/semana por conta (recomendação do LinkedIn).",
  "Envie convites apenas para perfis realmente relevantes à sua oferta.",
  "O administrador registra os webhooks para ativar a detecção automática de aceites e respostas.",
];

export function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-ink">
      {/* Fundos decorativos */}
      <div className="pointer-events-none fixed inset-0" aria-hidden="true">
        <div className="bg-grain absolute inset-0" />
        <div className="bg-grid absolute inset-0" />
        <div className="glow-orb absolute -top-32 right-[-10%] h-[520px] w-[520px]" />
        <div className="glow-orb-gold absolute left-[-15%] top-1/3 h-[460px] w-[460px]" />
        <div className="glow-orb absolute bottom-[-10%] left-1/3 h-[420px] w-[420px] opacity-60" />
      </div>

      {/* Barra superior */}
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-5 py-6">
        <Logo />
        <div className="pointer-events-none absolute left-1/2 hidden -translate-x-1/2 whitespace-nowrap font-serif text-sm font-medium gold-gradient-text sm:block">
          Essa empresa serve ao senhor Jesus!
        </div>
        <button type="button" className="btn btn-primary" onClick={() => navigate("/campanhas")}>
          <LogIn className="h-4 w-4" />
          Acessar painel
        </button>
      </header>

      <main className="relative z-10">
        {/* Hero */}
        <section className="mx-auto max-w-4xl px-5 pb-20 pt-10 text-center sm:pt-16">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-gold-500/25 bg-gold-500/5 px-4 py-1.5 text-xs font-medium text-gold-400">
            <Sparkles className="h-3.5 w-3.5" />
            Automação de prospecção para LinkedIn
          </div>
          <h1 className="font-serif text-4xl font-bold leading-tight text-cream sm:text-6xl">
            Sua prospecção no LinkedIn{" "}
            <span className="gold-gradient-text">no piloto automático</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-cream/60 sm:text-lg">
            O Link ON conecta, convida e conversa com os seus contatos de forma escalável e com
            comportamento humano — respeitando os limites do LinkedIn e acompanhando cada aceite e
            resposta em tempo real.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <button type="button" className="btn btn-primary px-6 py-3 text-base" onClick={() => navigate("/campanhas")}>
              Começar agora
              <ArrowRight className="h-4 w-4" />
            </button>
            <a href="#como-funciona" className="btn btn-secondary px-6 py-3 text-base">
              Como funciona
            </a>
          </div>

          <div className="mx-auto mt-14 grid max-w-2xl grid-cols-3 gap-3 text-center">
            {[
              { value: "40/dia", label: "Convites (limite recomendado)" },
              { value: "150/semana", label: "Tetos por conta" },
              { value: "5–15 min", label: "Atraso entre convites" },
            ].map((item) => (
              <div key={item.label} className="card px-3 py-4">
                <div className="gold-gradient-text font-serif text-xl font-bold sm:text-2xl">{item.value}</div>
                <div className="mt-1 text-[11px] leading-tight text-cream/45 sm:text-xs">{item.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* O que a automação faz */}
        <section className="mx-auto max-w-6xl px-5 py-14">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <div className="label !text-gold-500/80">O que a automação faz</div>
            <h2 className="font-serif text-3xl font-bold text-cream sm:text-4xl">
              Do primeiro convite à primeira conversa
            </h2>
            <p className="mt-4 text-cream/55">
              Todo o ciclo de prospecção automática, com a segurança de quem respeita as regras da
              plataforma.
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="card group p-6">
                <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-b from-gold-400/20 to-gold-600/10 text-gold-400 ring-1 ring-gold-500/25 transition-transform duration-300 group-hover:scale-110">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="font-semibold text-cream">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-cream/50">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Passo a passo */}
        <section id="como-funciona" className="mx-auto max-w-4xl px-5 py-14">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <div className="label !text-gold-500/80">Passo a passo</div>
            <h2 className="font-serif text-3xl font-bold text-cream sm:text-4xl">
              Como operar em 6 passos
            </h2>
            <p className="mt-4 text-cream/55">
              Da integração (feita pelo administrador) ao primeiro envio — em poucos
              minutos.
            </p>
          </div>

          <ol className="relative space-y-8 before:absolute before:left-[22px] before:top-2 before:bottom-2 before:w-px before:bg-gradient-to-b before:from-gold-500/50 before:via-gold-500/20 before:to-transparent">
            {STEPS.map((step, i) => (
              <li key={step.title} className="relative flex gap-5">
                <div className="relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-gold-500/40 bg-ink-800 font-serif text-lg font-bold text-gold-400 shadow-[0_0_18px_-4px_rgba(212,175,55,0.5)]">
                  {i + 1}
                </div>
                <div className="card flex-1 p-5">
                  <h3 className="font-semibold text-cream">{step.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-cream/50">{step.desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Boas práticas */}
        <section className="mx-auto max-w-4xl px-5 py-14">
          <div className="card gold-frame overflow-hidden p-8">
            <div className="flex items-start gap-4">
              <ShieldCheck className="mt-1 h-6 w-6 shrink-0 text-gold-400" />
              <div>
                <h2 className="font-serif text-2xl font-bold text-cream">Boas práticas para não cair em restrições</h2>
                <p className="mt-2 text-sm text-cream/55">
                  A automação respeita os limites recomendados, mas seu comportamento também conta.
                </p>
                <ul className="mt-5 space-y-3">
                  {TIPS.map((tip) => (
                    <li key={tip} className="flex items-start gap-3 text-sm text-cream/70">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-gold-500" />
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Sobre */}
        <section id="sobre" className="mx-auto max-w-6xl px-5 py-14">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <div className="label !text-gold-500/80">Sobre</div>
            <h2 className="font-serif text-3xl font-bold text-cream sm:text-4xl">
              Automação com propósito e comportamento humano
            </h2>
            <p className="mt-4 text-cream/55">
              O Link ON nasceu para quem quer escalar a prospecção no LinkedIn sem abrir mão da
              naturalidade, da transparência e da segurança da sua conta.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-3">
            <div className="card group p-6">
              <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-b from-gold-400/20 to-gold-600/10 text-gold-400 ring-1 ring-gold-500/25 transition-transform duration-300 group-hover:scale-110">
                <Target className="h-5 w-5" />
              </div>
              <h3 className="font-semibold text-cream">Missão</h3>
              <p className="mt-2 text-sm leading-relaxed text-cream/50">
                Transformar prospecção em um processo escalável e repetível, mantendo cada interação
                com o toque humano que o networking exige.
              </p>
            </div>
            <div className="card group p-6">
              <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-b from-gold-400/20 to-gold-600/10 text-gold-400 ring-1 ring-gold-500/25 transition-transform duration-300 group-hover:scale-110">
                <Users className="h-5 w-5" />
              </div>
              <h3 className="font-semibold text-cream">Para quem é</h3>
              <p className="mt-2 text-sm leading-relaxed text-cream/50">
                Consultores, agências, times comerciais e recrutadores que dependem de networking
                qualificado para gerar oportunidades todos os dias.
              </p>
            </div>
            <div className="card group p-6">
              <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-b from-gold-400/20 to-gold-600/10 text-gold-400 ring-1 ring-gold-500/25 transition-transform duration-300 group-hover:scale-110">
                <HeartHandshake className="h-5 w-5" />
              </div>
              <h3 className="font-semibold text-cream">Valores</h3>
              <p className="mt-2 text-sm leading-relaxed text-cream/50">
                Comportamento humano, transparência e respeito às regras da plataforma — porque a
                reputação é o ativo mais valioso da sua marca.
              </p>
            </div>
          </div>

          <div className="card gold-frame mt-6 p-8">
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-gold-500/40 bg-gold-500/10 shadow-gold">
                <Zap className="h-6 w-6 text-gold-400" />
              </div>
              <div>
                <h3 className="font-serif text-lg font-semibold text-cream">
                  Conecta, convida e conversa por você
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-cream/55">
                  Do primeiro convite à primeira resposta, o Link ON acompanha cada aceite e cada
                  mensagem em tempo real — enquanto você cuida do que realmente importa.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Contato */}
        <section id="contato" className="mx-auto max-w-4xl px-5 py-14">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <div className="label !text-gold-500/80">Contato</div>
            <h2 className="font-serif text-3xl font-bold text-cream sm:text-4xl">
              Fale com a gente
            </h2>
            <p className="mt-4 text-cream/55">
              Dúvidas, parcerias ou suporte na configuração da sua automação.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-3">
            <a
              href="mailto:arcanjo@potencializadores.com.br"
              className="card group p-6 text-center transition-all duration-200 hover:border-gold-500/40 hover:shadow-gold"
            >
              <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-b from-gold-400/20 to-gold-600/10 text-gold-400 ring-1 ring-gold-500/25 transition-transform duration-300 group-hover:scale-110">
                <Mail className="h-6 w-6" />
              </div>
              <div className="font-semibold text-cream">E-mail</div>
              <div className="mt-1 break-all text-sm text-cream/50">arcanjo@potencializadores.com.br</div>
            </a>
            <a
              href="https://wa.me/5519990041826"
              target="_blank"
              rel="noreferrer"
              className="card group p-6 text-center transition-all duration-200 hover:border-gold-500/40 hover:shadow-gold"
            >
              <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-b from-gold-400/20 to-gold-600/10 text-gold-400 ring-1 ring-gold-500/25 transition-transform duration-300 group-hover:scale-110">
                <Phone className="h-6 w-6" />
              </div>
              <div className="font-semibold text-cream">WhatsApp</div>
              <div className="mt-1 text-sm text-cream/50">(19) 99004-1826</div>
            </a>
            <a
              href="https://www.linkedin.com/in/gabriel-arcanjo-6b276731a/"
              target="_blank"
              rel="noreferrer"
              className="card group p-6 text-center transition-all duration-200 hover:border-gold-500/40 hover:shadow-gold"
            >
              <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-b from-gold-400/20 to-gold-600/10 text-gold-400 ring-1 ring-gold-500/25 transition-transform duration-300 group-hover:scale-110">
                <Linkedin className="h-6 w-6" />
              </div>
              <div className="font-semibold text-cream">LinkedIn</div>
              <div className="mt-1 break-all text-sm text-cream/50">/in/gabriel-arcanjo-6b276731a</div>
            </a>
          </div>
        </section>

        {/* CTA final */}
        <section className="mx-auto max-w-3xl px-5 py-16 text-center">
          <h2 className="font-serif text-3xl font-bold text-cream">
            Pronto para colocar sua prospecção <span className="gold-gradient-text">no automático?</span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-cream/55">
            Conecte sua conta do LinkedIn e inicie a primeira campanha em poucos minutos.
          </p>
          <button type="button" className="btn btn-primary mt-8 px-8 py-3 text-base" onClick={() => navigate("/campanhas")}>
            <Play className="h-4 w-4" />
            Entrar e criar campanha
          </button>
        </section>
      </main>

      <footer className="relative z-10 border-t border-ink-400/70 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 text-sm text-cream/35 sm:flex-row">
          <div className="flex items-center gap-2">
            <MousePointerClick className="h-4 w-4 text-gold-500/60" />
            Link ON — automação de prospecção no LinkedIn
          </div>
          <div className="flex items-center gap-5">
            <a href="#sobre" className="transition-colors hover:text-gold-400">Sobre</a>
            <a href="#contato" className="transition-colors hover:text-gold-400">Contato</a>
            <span className="inline-flex items-center gap-1.5">
              <Search className="h-3.5 w-3.5" /> Buscas salvas
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" /> Leads
            </span>
            <span className="inline-flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" /> Logs
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Settings className="h-3.5 w-3.5" /> Webhooks
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
