import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Bell, BellOff, ImageOff } from "lucide-react";
import { comprasListAlertEvents, comprasMarkEventsSeen, comprasSnoozeAlert, comprasTestNotification, onComprasAlert } from "@/api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { AlertEvent, ItemView } from "@/types";
import { AlertDialog } from "./AlertDialog";
import {
  ALERT_FILTER_LABEL,
  dedupeEvents,
  formatTime,
  groupByDay,
  isSnoozed,
  matchesFilter,
  notifyAlertsChanged,
  type AlertFilter,
} from "./alertFeed";
import { errorMessage } from "./format";
import { formatBRL } from "./money";
import { CmButton, CmStripe } from "./ui";
import type { ComprasData } from "./useComprasData";

const FILTERS: AlertFilter[] = ["all", "unseen", "target", "new_low"];
const SNOOZE_MS = 7 * 24 * 3600 * 1000;

interface AlertsViewProps {
  data: ComprasData;
  /** Opens the item detail. */
  onOpen: (itemId: string) => void;
  /** Goes to the Itens screen. */
  onGoItems: () => void;
}

/** Feed of alert events, grouped by day. Opening the screen does not mark anything as seen. */
export function AlertsView({ data, onOpen, onGoItems }: AlertsViewProps) {
  const { toast } = useToast();
  const [events, setEvents] = useState<AlertEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AlertFilter>("all");
  const [alertTarget, setAlertTarget] = useState<ItemView | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const evs = await comprasListAlertEvents(200, false);
      if (!alive.current) return;
      setEvents(dedupeEvents(evs));
      setError(null);
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    load();
    // new or delivered (was pending) events: reload; dedupe handles repeated emissions
    const unlisten = onComprasAlert(() => load());
    return () => {
      alive.current = false;
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [load]);

  const itemsById = useMemo(() => new Map((data.items ?? []).map((v) => [v.item.id, v])), [data.items]);
  const unseen = useMemo(() => (events ?? []).filter((e) => !e.seen).length, [events]);
  const counts = useMemo(() => {
    const evs = events ?? [];
    return Object.fromEntries(FILTERS.map((f) => [f, evs.filter((e) => matchesFilter(e, f)).length])) as Record<AlertFilter, number>;
  }, [events]);
  const groups = useMemo(() => groupByDay((events ?? []).filter((e) => matchesFilter(e, filter))), [events, filter]);

  const markSeen = async (ids: string[] | null) => {
    try {
      await comprasMarkEventsSeen(ids);
      setEvents((prev) => prev?.map((e) => (ids == null || ids.includes(e.id) ? { ...e, seen: true } : e)) ?? prev);
      notifyAlertsChanged();
    } catch {
      // best effort: the badge and the feed refresh on the next event
    }
  };

  const markAll = async () => {
    setBusy(true);
    await markSeen(null);
    setBusy(false);
  };

  const test = async () => {
    setBusy(true);
    try {
      await comprasTestNotification();
      toast({ variant: "success", title: "Aviso de teste enviado", description: "Confira a notificação do Windows." });
    } catch (e) {
      toast({ variant: "danger", title: "Não foi possível enviar o aviso de teste", description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const openItem = (e: AlertEvent) => {
    if (!e.seen) void markSeen([e.id]);
    onOpen(e.itemId);
  };

  const snooze = async (v: ItemView, resume: boolean) => {
    try {
      await comprasSnoozeAlert(v.item.id, resume ? null : new Date(Date.now() + SNOOZE_MS).toISOString());
      toast(
        resume
          ? { title: "Avisos reativados", description: v.item.name }
          : { variant: "success", title: "Avisos silenciados por 7 dias", description: v.item.name }
      );
      await data.reload();
    } catch (e) {
      toast({ variant: "danger", title: "Não foi possível alterar o silêncio", description: errorMessage(e) });
    }
  };

  if (events == null) {
    return <p className="py-12 text-center text-sm text-cm-muted">{error ?? "Carregando avisos…"}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-[28px] font-bold uppercase leading-[1.15] text-cm-ink">Alertas</h2>
          <p className="text-[14px] font-light text-cm-body">
            {unseen > 0
              ? `${unseen} ${unseen === 1 ? "aviso novo" : "avisos novos"} · preços que chegaram no valor que você pediu.`
              : "Preços que chegaram no valor que você pediu."}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <CmButton variant="ghost" disabled={busy} onClick={test}>
            Testar aviso
          </CmButton>
          <CmButton disabled={busy || unseen === 0} onClick={markAll}>
            Marcar tudo como visto
          </CmButton>
        </div>
      </div>

      <div className="flex flex-wrap items-stretch gap-6 border-b border-cm-hairline" role="tablist" aria-label="Filtrar avisos">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              "-mb-px h-12 border-b-2 px-1 text-[12px] font-bold uppercase tracking-[1.5px] transition-colors",
              filter === f ? "border-cm-accent text-cm-ink" : "border-transparent text-cm-muted hover:text-cm-ink"
            )}
          >
            {ALERT_FILTER_LABEL[f]}
            <span className="ml-1.5 font-light tabular-nums text-cm-muted">{counts[f]}</span>
          </button>
        ))}
      </div>

      {events.length === 0 ? (
        <EmptyAlerts onGoItems={onGoItems} />
      ) : groups.length === 0 ? (
        <p className="border border-dashed border-cm-hairline py-12 text-center text-sm font-light text-cm-body">
          Nenhum aviso neste filtro.
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="flex flex-col">
            <h3 className="pb-2 text-[12px] font-bold uppercase tracking-[1.5px] text-cm-muted">{g.label}</h3>
            <ul className="flex flex-col border-t border-cm-hairline">
              {g.events.map((e) => (
                <EventRow
                  key={e.id}
                  event={e}
                  view={itemsById.get(e.itemId) ?? null}
                  onOpen={() => openItem(e)}
                  onSnooze={snooze}
                  onEdit={setAlertTarget}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      <AlertDialog view={alertTarget} onClose={() => setAlertTarget(null)} onDone={data.reload} />
    </div>
  );
}

function EmptyAlerts({ onGoItems }: { onGoItems: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 border border-dashed border-cm-hairline py-16 text-center">
      <Bell className="h-8 w-8 text-cm-muted" />
      <div className="flex flex-col gap-2">
        <p className="text-[16px] font-bold uppercase tracking-[1px] text-cm-ink">Nenhum aviso ainda.</p>
        <p className="max-w-md text-[14px] font-light text-cm-body">
          Ligue o sino de um item e escolha o preço. Quando a loja chegar nesse valor, você recebe um aviso aqui e no Windows.
        </p>
      </div>
      <CmButton onClick={onGoItems}>Ir para Itens</CmButton>
    </div>
  );
}

function Thumb({ view }: { view: ItemView | null }) {
  const [failed, setFailed] = useState(false);
  const src = view?.imageFile ? `${convertFileSrc(view.imageFile)}?v=${encodeURIComponent(view.item.updatedAt)}` : null;
  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden bg-cm-card">
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <ImageOff className="h-5 w-5 text-cm-muted" />
      )}
    </div>
  );
}

function EventRow({
  event: e,
  view,
  onOpen,
  onSnooze,
  onEdit,
}: {
  event: AlertEvent;
  view: ItemView | null;
  onOpen: () => void;
  onSnooze: (v: ItemView, resume: boolean) => void;
  onEdit: (v: ItemView) => void;
}) {
  const store = e.offerId ? view?.offers.find((o) => o.id === e.offerId)?.store : undefined;
  const snoozed = isSnoozed(view?.alert?.snoozeUntil);
  return (
    <li className={cn("relative flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-cm-hairline py-4 pl-5 pr-2", !e.seen && "bg-cm-soft")}>
      {!e.seen && <CmStripe className="absolute inset-y-0 left-0 h-auto w-1" />}
      <Thumb view={view} />
      <div className="flex min-w-[220px] flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[14px] font-bold uppercase tracking-[0.5px] text-cm-ink">{e.title}</span>
          {!e.seen && <span className="sr-only">Não visto</span>}
          {e.pending && (
            <span className="border border-dashed border-cm-hairline px-2 py-0.5 text-[11px] font-bold uppercase tracking-[1px] text-cm-muted">
              Aguardando horário
            </span>
          )}
        </div>
        <p className="text-[13px] font-light text-cm-body">{e.reason}</p>
        {snoozed && view?.alert?.snoozeUntil && (
          <p className="text-[12px] font-light text-cm-muted">
            Avisos silenciados até {new Date(view.alert.snoozeUntil).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
          </p>
        )}
      </div>
      <div className="flex flex-col items-end gap-0.5 tabular-nums">
        <span className={cn("text-[18px] font-bold", e.kind === "target" ? "text-cm-accent" : "text-cm-ink")}>{formatBRL(e.priceCents)}</span>
        <span className="text-[12px] font-light text-cm-muted">
          {store ? `${store} · ` : ""}
          {formatTime(e.createdAt)}
        </span>
      </div>
      {view && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <CmButton size="sm" onClick={onOpen}>
            Ver item
          </CmButton>
          <CmButton size="sm" variant="ghost" onClick={() => onEdit(view)}>
            Mudar valor
          </CmButton>
          <CmButton size="sm" variant="ghost" onClick={() => onSnooze(view, snoozed)}>
            {snoozed ? (
              <>
                <Bell className="h-3.5 w-3.5" /> Reativar
              </>
            ) : (
              <>
                <BellOff className="h-3.5 w-3.5" /> Silenciar 7 dias
              </>
            )}
          </CmButton>
        </div>
      )}
    </li>
  );
}
