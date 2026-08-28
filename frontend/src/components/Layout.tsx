import { NavLink, Outlet } from "react-router-dom";
import { Link2, Settings, ShieldCheck, UserPlus, X, Menu, Plus, LogOut, Home, Sun, Moon, Radar, ScanSearch, HelpCircle, Inbox, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Logo } from "./Logo";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme";
import { NotificationBell } from "./NotificationBell";

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const isAdmin = user?.role === "ADMIN";
  const NAV: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
    { to: "/", label: "Início", icon: Home, end: true },
    { to: "/campanhas", label: "Campanhas", icon: Link2 },
    { to: "/disparos", label: "Disparos", icon: Radar },
    { to: "/inbox", label: "Inbox", icon: Inbox },
    { to: "/extracao", label: "Extração", icon: ScanSearch },
    { to: "/conectar", label: "Conta LinkedIn", icon: UserPlus },
    ...(isAdmin ? [{ to: "/administracao", label: "Administração", icon: ShieldCheck }] : []),
    { to: "/configuracoes", label: "Configurações", icon: Settings },
    { to: "/tutorial", label: "Tutorial", icon: HelpCircle },
  ];
  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pb-6 pt-6">
        <Logo />
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                isActive
                  ? "gold-nav-active text-gold-400"
                  : "text-cream/55 hover:bg-ink-600 hover:text-cream"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={`absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-full bg-gradient-to-b from-gold-400 to-gold-600 transition-opacity ${
                    isActive ? "opacity-100" : "opacity-0"
                  }`}
                  aria-hidden="true"
                />
                <item.icon className="h-[18px] w-[18px]" />
                {item.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="space-y-3 px-3 pb-5">
        <NotificationBell />
        <NavLink to="/campanhas/nova" onClick={onNavigate} className="btn btn-primary w-full">
          <Plus className="h-4 w-4" />
          Nova campanha
        </NavLink>
        <button
          type="button"
          onClick={toggle}
          className="btn btn-secondary w-full"
          aria-label="Alternar tema"
          title={theme === "dark" ? "Tema claro" : "Tema escuro"}
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {theme === "dark" ? "Tema claro" : "Tema escuro"}
        </button>
        <div className="rounded-xl border border-ink-400 bg-ink-800/80 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-cream">{user?.username}</div>
              <div className="text-xs text-cream/40">{isAdmin ? "Administrador" : "Usuário"}</div>
            </div>
            <button
              type="button"
              className="btn btn-secondary !p-2"
              onClick={() => {
                logout();
                window.location.assign("/login");
              }}
              aria-label="Sair"
              title="Sair"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MobileThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      className="btn btn-secondary !p-2"
      onClick={toggle}
      aria-label="Alternar tema"
      title={theme === "dark" ? "Tema claro" : "Tema escuro"}
    >
      {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}

export function Layout() {
  const [open, setOpen] = useState(false);
  const { operatingAs, clearOperatingAs } = useAuth();

  return (
    <div className="min-h-dvh bg-ink">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-ink-400 bg-ink-800/80 backdrop-blur lg:block">
        <SidebarContent />
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-ink-400 bg-ink-800/90 px-4 py-3 backdrop-blur lg:hidden">
        <Logo size="sm" />
        <div className="flex items-center gap-2">
          <MobileThemeToggle />
          <NotificationBell compact />
          <button
            type="button"
            className="btn btn-secondary !p-2"
            onClick={() => setOpen(true)}
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 left-0 w-72 bg-ink-800 shadow-2xl">
            <button
              type="button"
              className="btn btn-secondary absolute right-3 top-4 !p-2"
              onClick={() => setOpen(false)}
              aria-label="Fechar menu"
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarContent onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="px-4 py-6 sm:px-6 lg:ml-64 lg:px-10 lg:py-8">
        <div className="mx-auto max-w-6xl">
          {operatingAs && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gold-500/30 bg-gold-500/10 px-4 py-2.5 text-sm">
              <span className="text-cream">
                Operando como <span className="font-semibold text-gold-400">{operatingAs.name || operatingAs.username}</span>
              </span>
              <button
                type="button"
                className="btn btn-secondary !px-3 !py-1.5 text-xs"
                onClick={() => {
                  clearOperatingAs();
                  window.location.assign("/administracao");
                }}
              >
                Voltar ao painel
              </button>
            </div>
          )}
          <Outlet />
        </div>
      </main>
    </div>
  );
}
