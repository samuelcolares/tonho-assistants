import { useEffect, useState } from "react";
import { Check, Loader2, RefreshCw } from "lucide-react";
import { comprasRefresh, comprasTestNotification } from "@/api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { ComprasSettings } from "@/types";
import { DataSection } from "./DataSection";
import { DiscordSection } from "./DiscordSection";
import { errorMessage, formatRelative } from "./format";
import { MlApiSection } from "./MlApiSection";
import { PixRowsEditor } from "./PixRowsEditor";
import { RoomsSection } from "./RoomsSection";
import { NumberSelect, SettingRow, SettingsSection } from "./SettingsParts";
import { CmButton, CmInput, CmSwitch } from "./ui";
import type { ComprasData } from "./useComprasData";
import { useSettingsAutosave, type SaveState } from "./useSettingsAutosave";

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

const COOLDOWN_OPTIONS = [6, 12, 24, 48];
const REALERT_OPTIONS = [1, 3, 5, 10];
const MAX_TOAST_OPTIONS = [1, 2, 3, 4, 5];
const TARGET_PCT_OPTIONS = [5, 10, 15, 20];

const DEFAULT_QUIET = { start: "22:00", end: "08:00" };

/** Configurações de Compras: uma página só, tudo salvo sozinho. */
export function SettingsPage({ data }: { data: ComprasData }) {
  const { toast } = useToast();
  const { settings, state, error, update, reload } = useSettingsAutosave();
  const [interval, setIntervalText] = useState("120");
  const [amazon, setAmazon] = useState("360");
  const [testing, setTesting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // text fields keep what is being typed; the clamped value is committed on blur and mirrored back here
  const loadedInterval = settings?.pollIntervalMinutes;
  const loadedAmazon = settings?.amazonMinIntervalMinutes;
  useEffect(() => {
    if (loadedInterval != null) setIntervalText(String(loadedInterval));
    if (loadedAmazon != null) setAmazon(String(loadedAmazon));
  }, [loadedInterval, loadedAmazon]);

  if (!settings) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader state={state} error={error} />
        <p className="py-12 text-center text-sm text-cm-muted">{state === "error" ? error : "Carregando configurações…"}</p>
      </div>
    );
  }

  const s: ComprasSettings = settings;
  const notifyOff = !s.notifyEnabled;
  const quietOn = s.quietStart != null && s.quietEnd != null;
  const running = data.pollStatus?.running ?? false;

  const commitInterval = () => {
    const n = clamp(Math.round(Number(interval) || s.pollIntervalMinutes), 60, 180);
    setIntervalText(String(n));
    if (n !== s.pollIntervalMinutes) update({ pollIntervalMinutes: n });
  };
  const commitAmazon = () => {
    const n = clamp(Math.round(Number(amazon) || s.amazonMinIntervalMinutes), 360, 1440);
    setAmazon(String(n));
    if (n !== s.amazonMinIntervalMinutes) update({ amazonMinIntervalMinutes: n });
  };

  const testNotification = async () => {
    setTesting(true);
    try {
      await comprasTestNotification();
      toast({ title: "Aviso de teste enviado", description: "Se ele não apareceu no Windows, confira as notificações do sistema." });
    } catch (e) {
      toast({ variant: "danger", title: "Não foi possível enviar o teste", description: errorMessage(e) });
    } finally {
      setTesting(false);
    }
  };

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      await comprasRefresh(null, null);
      toast({ title: "Atualização iniciada", description: "Os preços vão aparecendo conforme as lojas respondem." });
    } catch (e) {
      toast({ variant: "danger", title: "Falha ao atualizar", description: errorMessage(e) });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader state={state} error={error} />

      <SettingsSection id="avisos" title="Avisos" description="Como e quando o app avisa que um preço chegou onde você queria.">
        <SettingRow label="Avisos de preço" hint="Liga ou desliga todos os avisos (Windows e Discord) quando um item chega no preço do aviso.">
          <CmSwitch aria-label="Avisos de preço" checked={s.notifyEnabled} onChange={(v) => update({ notifyEnabled: v })} />
          <CmButton size="sm" onClick={testNotification} disabled={testing}>
            {testing ? "Enviando…" : "Testar no Windows"}
          </CmButton>
        </SettingRow>
        <SettingRow
          label="Avisar também quando aparecer um novo menor preço"
          hint="Mesmo sem ter chegado no preço que você pediu, avisa se o item bateu o menor valor já visto."
          disabled={notifyOff}
        >
          <CmSwitch
            aria-label="Avisar novo menor preço"
            checked={s.notifyNewLow}
            disabled={notifyOff}
            onChange={(v) => update({ notifyNewLow: v })}
          />
        </SettingRow>
        <SettingRow
          label="Horário silencioso"
          hint="Avisos nesse horário ficam guardados e aparecem depois."
          disabled={notifyOff}
        >
          <CmSwitch
            aria-label="Horário silencioso"
            checked={quietOn}
            disabled={notifyOff}
            onChange={(v) =>
              update(v ? { quietStart: s.quietStart ?? DEFAULT_QUIET.start, quietEnd: s.quietEnd ?? DEFAULT_QUIET.end } : { quietStart: null, quietEnd: null })
            }
          />
          {quietOn && (
            <>
              <label className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[1.5px] text-cm-muted">
                Das
                <CmInput
                  type="time"
                  aria-label="Início do horário silencioso"
                  className="w-32"
                  disabled={notifyOff}
                  value={s.quietStart ?? DEFAULT_QUIET.start}
                  onChange={(e) => e.target.value && update({ quietStart: e.target.value })}
                />
              </label>
              <label className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[1.5px] text-cm-muted">
                Às
                <CmInput
                  type="time"
                  aria-label="Fim do horário silencioso"
                  className="w-32"
                  disabled={notifyOff}
                  value={s.quietEnd ?? DEFAULT_QUIET.end}
                  onChange={(e) => e.target.value && update({ quietEnd: e.target.value })}
                />
              </label>
            </>
          )}
        </SettingRow>
        <SettingRow
          label="Intervalo mínimo entre avisos do mesmo item"
          hint="Depois de avisar, o mesmo item só avisa de novo depois desse tempo."
          disabled={notifyOff}
        >
          <NumberSelect
            label="Intervalo mínimo entre avisos"
            value={s.cooldownHours}
            options={COOLDOWN_OPTIONS}
            format={(n) => `${n} horas`}
            disabled={notifyOff}
            onChange={(n) => update({ cooldownHours: n })}
          />
        </SettingRow>
        <SettingRow
          label="Avisar de novo só se cair mais"
          hint="Se o item já avisou e o preço caiu um pouco mais, só avisa de novo se a queda for pelo menos esta."
          disabled={notifyOff}
        >
          <NumberSelect
            label="Avisar de novo só se cair mais"
            value={s.realertDropPct}
            options={REALERT_OPTIONS}
            format={(n) => `${n}%`}
            disabled={notifyOff}
            onChange={(n) => update({ realertDropPct: n })}
          />
        </SettingRow>
        <SettingRow
          label="Máximo de avisos de uma vez"
          hint="Se muitos itens chegarem no preço juntos, o resto vira um aviso só: “+N itens no preço”."
          disabled={notifyOff}
        >
          <NumberSelect
            label="Máximo de avisos de uma vez"
            value={s.maxToastsPerCycle}
            options={MAX_TOAST_OPTIONS}
            format={(n) => String(n)}
            disabled={notifyOff}
            onChange={(n) => update({ maxToastsPerCycle: n })}
          />
        </SettingRow>
        <DiscordSection settings={s} update={update} masterOff={notifyOff} />
      </SettingsSection>

      <SettingsSection id="precos" title="Preços" description="Como o app compara os preços das lojas.">
        <SettingRow label="Somar o frete no preço" hint="O preço que você vê já inclui o frete, quando a loja informa.">
          <CmSwitch aria-label="Somar o frete no preço" checked={s.includeShipping} onChange={(v) => update({ includeShipping: v })} />
        </SettingRow>
        <SettingRow label="Usar preço no Pix quando houver" hint="Compara pelo preço à vista no Pix, que costuma ser menor.">
          <CmSwitch aria-label="Usar preço no Pix quando houver" checked={s.usePix} onChange={(v) => update({ usePix: v })} />
        </SettingRow>
        <SettingRow label="Sugestão padrão para o aviso" hint="Ao ligar um aviso, sugerimos esta queda em relação ao preço de hoje.">
          <NumberSelect
            label="Sugestão padrão para o aviso"
            value={s.defaultTargetPct}
            options={TARGET_PCT_OPTIONS}
            format={(n) => `${n}% abaixo`}
            onChange={(n) => update({ defaultTargetPct: n })}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        id="comodos"
        title="Cômodos"
        description="Os lugares da casa para agrupar os itens. Aparecem como sugestão ao escolher o cômodo de um item."
      >
        <RoomsSection rooms={s.rooms} onChange={(rooms) => update({ rooms })} onItemsChanged={() => void data.reload()} />
      </SettingsSection>

      <SettingsSection id="lojas" title="Lojas" description="Ajustes por loja para o preço ficar mais próximo do que você paga de verdade.">
        <PixRowsEditor value={s.pixDiscountByStore} onChange={(m) => update({ pixDiscountByStore: m })} />
        <MlApiSection />
      </SettingsSection>

      <SettingsSection id="coleta" title="Coleta" description="Com que frequência o app consulta os preços nas lojas.">
        <SettingRow label="Verificar preços automaticamente" hint="Consulta as lojas em segundo plano enquanto o app está aberto.">
          <CmSwitch aria-label="Verificar preços automaticamente" checked={s.pollEnabled} onChange={(v) => update({ pollEnabled: v })} />
        </SettingRow>
        <SettingRow label="Intervalo entre consultas" hint="Entre 60 e 180 minutos." disabled={!s.pollEnabled}>
          <div className="relative w-36">
            <CmInput
              type="number"
              min={60}
              max={180}
              aria-label="Intervalo entre consultas em minutos"
              className="pr-12"
              disabled={!s.pollEnabled}
              value={interval}
              onChange={(e) => setIntervalText(e.target.value)}
              onBlur={commitInterval}
              onKeyDown={(e) => e.key === "Enter" && commitInterval()}
            />
            <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-bold uppercase tracking-[1px] text-cm-muted">
              min
            </span>
          </div>
        </SettingRow>
        <SettingRow label="Intervalo mínimo da Amazon" hint="A Amazon bloqueia consultas frequentes. Entre 360 e 1440 minutos." disabled={!s.pollEnabled}>
          <div className="relative w-36">
            <CmInput
              type="number"
              min={360}
              max={1440}
              aria-label="Intervalo mínimo da Amazon em minutos"
              className="pr-12"
              disabled={!s.pollEnabled}
              value={amazon}
              onChange={(e) => setAmazon(e.target.value)}
              onBlur={commitAmazon}
              onKeyDown={(e) => e.key === "Enter" && commitAmazon()}
            />
            <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-bold uppercase tracking-[1px] text-cm-muted">
              min
            </span>
          </div>
        </SettingRow>
        <SettingRow
          label="Última checagem"
          hint={running ? `Atualizando agora${data.pollStatus?.queued ? ` · ${data.pollStatus.queued} na fila` : ""}` : formatRelative(data.pollStatus?.lastRunAt)}
        >
          <CmButton onClick={refreshAll} disabled={refreshing || running}>
            <RefreshCw className={cn("h-4 w-4", (refreshing || running) && "animate-spin")} /> Atualizar tudo agora
          </CmButton>
        </SettingRow>
      </SettingsSection>

      <SettingsSection id="dados" title="Dados" description="Cópia de segurança e troca de dados com planilhas.">
        <DataSection
          onImported={() => void data.reload()}
          onRestored={() => {
            void reload();
            void data.reload();
          }}
        />
      </SettingsSection>
    </div>
  );
}

function PageHeader({ state, error }: { state: SaveState; error: string | null }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-[40px] font-bold uppercase leading-[1.1] tracking-[-0.5px] text-cm-ink">Configurações</h1>
        <p className="mt-2 text-[14px] font-light text-cm-body">Tudo o que você muda aqui é salvo sozinho.</p>
      </div>
      <div role="status" aria-live="polite" className="flex h-9 items-center gap-2 text-[12px] font-bold uppercase tracking-[1.5px]">
        {state === "saving" && (
          <span className="flex items-center gap-2 text-cm-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Salvando…
          </span>
        )}
        {state === "saved" && (
          <span className="flex items-center gap-2 text-cm-accent">
            <Check className="h-4 w-4" /> Salvo
          </span>
        )}
        {state === "error" && (
          <span className="max-w-xs text-cm-danger" title={error ?? undefined}>
            Não foi possível salvar
          </span>
        )}
      </div>
    </header>
  );
}
