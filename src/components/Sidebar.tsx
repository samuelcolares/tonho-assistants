import type { ComponentType } from "react";
import { Bell, BellRing, Folder, GitBranch, History, LayoutDashboard, Lock, Settings, ShoppingCart, SlidersHorizontal, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { useUnseenAlerts } from "@/features/compras/useUnseenAlerts";
import logoAntonio from "@/assets/logos/logo-antonio.png";
import logoDante from "@/assets/logos/logo-dante.png";
import logoBonnie from "@/assets/logos/logo-bonnie.png";
import logoGeneral from "@/assets/logos/logo-general.png";

export type View =
  | "watchers"
  | "actions"
  | "activity"
  | "reminders"
  | "vault"
  | "repos"
  | "compras-dashboard"
  | "compras-items"
  | "compras-alerts"
  | "compras-settings"
  | "settings";

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

const COMPRAS_ITEMS: NavItem[] = [
  { key: "compras-dashboard", label: "Painel", icon: LayoutDashboard },
  { key: "compras-items", label: "Itens", icon: ShoppingCart },
  { key: "compras-alerts", label: "Alertas", icon: BellRing },
  { key: "compras-settings", label: "Configurações", icon: SlidersHorizontal },
];

interface DogGroupProps {
  name: string;
  role: string;
  logo: string;
  ringClass: string;
  activeBorderClass: string;
  items: NavItem[];
  view: View;
  onChangeView: (v: View) => void;
  /** Unseen-count badges by view key. */
  badges?: Partial<Record<View, number>>;
}

function DogGroup({
  name,
  role,
  logo,
  ringClass,
  activeBorderClass,
  items,
  view,
  onChangeView,
  badges,
}: DogGroupProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2.5 px-3 pb-2">
        <img
          src={logo}
          alt={name}
          className={cn("h-8 w-8 shrink-0 rounded-none object-cover ring-1", ringClass)}
        />
        <div className="flex min-w-0 flex-col leading-tight">
          <strong className="truncate text-[11px] font-bold uppercase tracking-[1.5px] text-ink-muted">{name}</strong>
          <span className="truncate text-[11px] font-light text-ink-faint">{role}</span>
        </div>
      </div>
      <div className="flex flex-col">
        {items.map((item) => {
          const active = view === item.key;
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              onClick={() => onChangeView(item.key)}
              className={cn(
                "flex min-h-[44px] items-center gap-2.5 border-l-[3px] px-3 py-2 text-left text-[13px] font-bold uppercase tracking-[0.5px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink",
                active ? cn(activeBorderClass, "bg-bg-200 text-ink") : "border-transparent text-ink-muted hover:bg-bg-100 hover:text-ink"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1">{item.label}</span>
              {(badges?.[item.key] ?? 0) > 0 && (
                <span
                  className="min-w-[18px] bg-compras px-1.5 text-center text-[10.5px] font-bold leading-[18px] tabular-nums text-black"
                  aria-label={`${badges?.[item.key]} avisos não vistos`}
                >
                  {(badges?.[item.key] ?? 0) > 99 ? "99+" : badges?.[item.key]}
                </span>
              )}
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
  const unseenAlerts = useUnseenAlerts();

  return (
    <nav className="flex h-full w-[232px] shrink-0 flex-col border-r border-border bg-bg-000" style={{ WebkitAppRegion: "drag" } as React.CSSProperties }>
      <div className="flex items-center gap-2.5 px-4 py-5" style={{ WebkitAppRegion: "drag" } as React.CSSProperties }>
        <img src={logoGeneral} alt="Tonho Assistants" className="h-9 w-9 rounded-none object-cover" />
        <div className="flex flex-col leading-tight">
          <strong className="text-[18px] font-bold uppercase tracking-[1.5px] text-ink">Tonho</strong>
          <span className="text-[11px] font-bold uppercase tracking-[1.5px] text-ink-faint">Assistants</span>
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
          activeBorderClass="border-antonio"
          items={ANTONIO_ITEMS}
          view={view}
          onChangeView={onChangeView}
        />
        <DogGroup
          name="Dante Margherita"
          role="Lembretes & agenda"
          logo={logoDante}
          ringClass="ring-dante"
          activeBorderClass="border-dante"
          items={DANTE_ITEMS}
          view={view}
          onChangeView={onChangeView}
        />
        <DogGroup
          name="Bonnie Calabresa"
          role="Vault de informações"
          logo={logoBonnie}
          ringClass="ring-bonnie"
          activeBorderClass="border-bonnie"
          items={BONNIE_ITEMS}
          view={view}
          onChangeView={onChangeView}
        />
        <DogGroup
          name="Compras para Casa"
          role="Preços & orçamento"
          logo={logoGeneral}
          ringClass="ring-compras"
          activeBorderClass="border-compras"
          items={COMPRAS_ITEMS}
          view={view}
          onChangeView={onChangeView}
          badges={{ "compras-alerts": unseenAlerts }}
        />
      </div>

      <div className="border-t border-border py-2" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties }>
        <button
          onClick={() => onChangeView("settings")}
          className={cn(
            "flex min-h-[44px] w-full items-center gap-2.5 border-l-[3px] px-3 py-2 text-left text-[13px] font-bold uppercase tracking-[0.5px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink",
            settingsActive ? "border-ink bg-bg-200 text-ink" : "border-transparent text-ink-muted hover:bg-bg-100 hover:text-ink"
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
        <label className="flex items-center justify-between gap-2 text-[11.5px] font-light text-ink-muted">
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
    <span className={cn("inline-flex w-fit items-center gap-1.5 text-[11px] font-bold uppercase tracking-[1.5px]", text)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
      {label}
    </span>
  );
}

