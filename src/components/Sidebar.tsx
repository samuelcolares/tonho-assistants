import type { ComponentType } from "react";
import { Bell, Folder, GitBranch, History, Lock, Settings, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import logoAntonio from "@/assets/logos/logo-antonio.png";
import logoDante from "@/assets/logos/logo-dante.png";
import logoBonnie from "@/assets/logos/logo-bonnie.png";
import logoGeneral from "@/assets/logos/logo-general.png";

export type View = "watchers" | "actions" | "activity" | "reminders" | "vault" | "repos" | "settings";

interface NavItem {
  key: View;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const ANTONIO_ITEMS: NavItem[] = [
  { key: "watchers", label: "Pastas monitoradas", icon: Folder },
  { key: "actions", label: "Regras de ação", icon: Zap },
  { key: "activity", label: "Atividade", icon: History },
];
const DANTE_ITEMS: NavItem[] = [{ key: "reminders", label: "Lembretes", icon: Bell }];
const BONNIE_ITEMS: NavItem[] = [
  { key: "vault", label: "Vault", icon: Lock },
  { key: "repos", label: "Repos", icon: GitBranch },
];

interface DogGroupProps {
  name: string;
  role: string;
  logo: string;
  ringClass: string;
  activeBgClass: string;
  activeTextClass: string;
  items: NavItem[];
  view: View;
  onChangeView: (v: View) => void;
}

function DogGroup({
  name,
  role,
  logo,
  ringClass,
  activeBgClass,
  activeTextClass,
  items,
  view,
  onChangeView,
}: DogGroupProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2.5 px-2 pb-1">
        <img
          src={logo}
          alt={name}
          className={cn("h-8 w-8 shrink-0 rounded-full object-cover ring-[1.5px]", ringClass)}
        />
        <div className="flex min-w-0 flex-col leading-tight">
          <strong className="truncate text-[13px] font-semibold text-ink">{name}</strong>
          <span className="truncate text-[11px] text-ink-muted">{role}</span>
        </div>
      </div>
      <div className="flex flex-col gap-0.5 pl-1">
        {items.map((item) => {
          const active = view === item.key;
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              onClick={() => onChangeView(item.key)}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] font-medium transition-colors",
                active ? cn(activeBgClass, activeTextClass) : "text-ink-muted hover:bg-bg-200 hover:text-ink"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface SidebarProps {
  view: View;
  onChangeView: (v: View) => void;
  status: "running" | "stopped" | "error";
  autostart: boolean;
  onToggleAutostart: () => void;
}

export function Sidebar({ view, onChangeView, status, autostart, onToggleAutostart }: SidebarProps) {
  const settingsActive = view === "settings";

  return (
    <nav className="flex h-full w-[232px] shrink-0 flex-col bg-bg-100" style={{ WebkitAppRegion: "drag" } as React.CSSProperties }>
      <div className="flex items-center gap-2.5 px-4 py-5" style={{ WebkitAppRegion: "drag" } as React.CSSProperties }>
        <img src={logoGeneral} alt="Tonho Assistants" className="h-9 w-9 rounded-full object-cover" />
        <div className="flex flex-col leading-tight">
          <strong className="text-[15px] font-bold text-ink">Tonho</strong>
          <span className="text-[10.5px] uppercase tracking-wide text-ink-faint">Assistants</span>
        </div>
      </div>

      <div
        className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 pb-3"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties }
      >
        <DogGroup
          name="Antonio Pepperoni"
          role="Organização de arquivos"
          logo={logoAntonio}
          ringClass="ring-antonio"
          activeBgClass="bg-antonio-subtle"
          activeTextClass="text-antonio"
          items={ANTONIO_ITEMS}
          view={view}
          onChangeView={onChangeView}
        />
        <DogGroup
          name="Dante Margherita"
          role="Lembretes & agenda"
          logo={logoDante}
          ringClass="ring-dante"
          activeBgClass="bg-dante-subtle"
          activeTextClass="text-dante"
          items={DANTE_ITEMS}
          view={view}
          onChangeView={onChangeView}
        />
        <DogGroup
          name="Bonnie Calabresa"
          role="Vault de informações"
          logo={logoBonnie}
          ringClass="ring-bonnie"
          activeBgClass="bg-bonnie-subtle"
          activeTextClass="text-bonnie"
          items={BONNIE_ITEMS}
          view={view}
          onChangeView={onChangeView}
        />
      </div>

      <div className="border-t border-border px-3 py-3" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties }>
        <button
          onClick={() => onChangeView("settings")}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] font-medium transition-colors",
            settingsActive ? "bg-bg-200 text-ink" : "text-ink-muted hover:bg-bg-200 hover:text-ink"
          )}
        >
          <Settings className="h-4 w-4 shrink-0" />
          Configurações
        </button>
      </div>

      <div
        className="flex flex-col gap-3 border-t border-border px-4 py-3"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties }
      >
        <StatusPill status={status} />
        <label className="flex items-center justify-between gap-2 text-[11.5px] text-ink-muted">
          <span>Iniciar com o Windows</span>
          <Switch checked={autostart} onCheckedChange={onToggleAutostart} />
        </label>
      </div>
    </nav>
  );
}

function StatusPill({ status }: { status: "running" | "stopped" | "error" }) {
  const map = {
    running: { label: "Ativo", dot: "bg-success", text: "text-success" },
    stopped: { label: "Parado", dot: "bg-warning", text: "text-warning" },
    error: { label: "Erro", dot: "bg-danger", text: "text-danger" },
  } as const;
  const { label, dot, text } = map[status];
  return (
    <span className={cn("inline-flex w-fit items-center gap-1.5 text-[11.5px] font-semibold", text)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
      {label}
    </span>
  );
}

