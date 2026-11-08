import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Link2, Loader2, Search } from "lucide-react";
import { comprasPreviewUrl } from "@/api";
import { cn } from "@/lib/utils";
import type { Extracted } from "@/types";
import { errorMessage } from "./format";
import { CmTag } from "./ItemBadges";
import { formatBRL } from "./money";
import { CmBrlInput, CmButton, CmCheckbox, CmField, CmInput } from "./ui";

export type OfferDraft =
  | { kind: "url"; extracted: Extracted }
  | {
      kind: "manual";
      store: string;
      url: string;
      listCents: number | null;
      cashCents: number | null;
      inStock: boolean;
    };

export type ManualDraft = Extract<OfferDraft, { kind: "manual" }>;

/** Whether the draft has enough data to be submitted. */
export function draftIsValid(d: OfferDraft | null): boolean {
  if (!d) return false;
  if (d.kind === "url") return !d.extracted.blocked;
  return d.store.trim() !== "" && (d.listCents != null || d.cashCents != null);
}

export const EMPTY_MANUAL: ManualDraft = {
  kind: "manual",
  store: "",
  url: "",
  listCents: null,
  cashCents: null,
  inStock: true,
};

interface OfferSourceFormProps {
  draft: OfferDraft | null;
  onChange: (d: OfferDraft | null) => void;
  className?: string;
  /** A link to preview as soon as the form shows up. */
  initialUrl?: string;
}

type Mode = "url" | "manual";

/** URL (with preview) or manual offer entry. Used by "add store" on an existing item. */
export function OfferSourceForm({ draft, onChange, className, initialUrl }: OfferSourceFormProps) {
  const [mode, setMode] = useState<Mode>(draft?.kind ?? "url");
  const [url, setUrl] = useState(draft?.kind === "url" ? draft.extracted.url : (initialUrl ?? ""));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const extracted = draft?.kind === "url" ? draft.extracted : null;

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    onChange(m === "manual" ? { ...EMPTY_MANUAL, url: url.trim() } : null);
  };

  const fetchPreview = async () => {
    const target = url.trim();
    if (!target) return;
    setLoading(true);
    setError(null);
    onChange(null);
    try {
      const result = await comprasPreviewUrl(target);
      onChange({ kind: "url", extracted: result });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const autoFetched = useRef(false);
  useEffect(() => {
    if (autoFetched.current || !initialUrl || draft) return;
    autoFetched.current = true;
    void fetchPreview();
    // once, when the form opens with a link already in hand
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const useManualFromBlocked = () => {
    setMode("manual");
    onChange({ ...EMPTY_MANUAL, store: extracted?.store ?? "", url: extracted?.url ?? url.trim() });
  };

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div role="tablist" aria-label="Como adicionar a loja" className="flex gap-6 border-b border-cm-hairline">
        <ModeTab active={mode === "url"} onClick={() => switchMode("url")}>
          <Link2 className="h-4 w-4" aria-hidden /> Colar link da loja
        </ModeTab>
        <ModeTab active={mode === "manual"} onClick={() => switchMode("manual")}>
          Preço manual
        </ModeTab>
      </div>

      {mode === "url" ? (
        <>
          <div className="flex gap-3">
            <CmInput
              value={url}
              aria-label="Link da loja"
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.kabum.com.br/produto/…"
              onKeyDown={(e) => e.key === "Enter" && fetchPreview()}
            />
            <CmButton onClick={fetchPreview} disabled={loading || !url.trim()} className="h-12">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
              Buscar
            </CmButton>
          </div>
          {error && (
            <p role="alert" className="border border-cm-danger p-3 text-[13px] font-light text-cm-danger">
              {error}
            </p>
          )}
          {extracted && <UrlPreviewCard extracted={extracted} onUseManual={useManualFromBlocked} />}
        </>
      ) : (
        <ManualOfferFields value={draft?.kind === "manual" ? draft : EMPTY_MANUAL} onChange={onChange} />
      )}
    </div>
  );
}

function ModeTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "-mb-px inline-flex h-12 items-center gap-2 border-b-2 text-[12px] font-bold uppercase tracking-[1.5px] transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cm-ink",
        active ? "border-cm-accent text-cm-ink" : "border-transparent text-cm-muted hover:text-cm-ink"
      )}
    >
      {children}
    </button>
  );
}

/** Store, link, prices and stock typed by hand (for stores that do not allow automatic reading). */
export function ManualOfferFields({ value, onChange }: { value: ManualDraft; onChange: (d: ManualDraft) => void }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <CmField label="Loja" htmlFor="manual-store">
        <CmInput
          id="manual-store"
          value={value.store}
          onChange={(e) => onChange({ ...value, store: e.target.value })}
          placeholder="Ex.: Mercado Livre"
        />
      </CmField>
      <CmField label="Link (opcional)" htmlFor="manual-url">
        <CmInput id="manual-url" value={value.url} onChange={(e) => onChange({ ...value, url: e.target.value })} placeholder="https://…" />
      </CmField>
      <CmField label="Preço cheio" htmlFor="manual-list">
        <CmBrlInput id="manual-list" value={value.listCents} onChange={(c) => onChange({ ...value, listCents: c })} />
      </CmField>
      <CmField label="Preço Pix / à vista" htmlFor="manual-cash">
        <CmBrlInput id="manual-cash" value={value.cashCents} onChange={(c) => onChange({ ...value, cashCents: c })} />
      </CmField>
      <CmCheckbox className="col-span-2" checked={value.inStock} onChange={(v) => onChange({ ...value, inStock: v })}>
        Em estoque
      </CmCheckbox>
    </div>
  );
}

/** What the store page told us: image, title, store, prices and any warning. Sharp tile, hairline border. */
export function UrlPreviewCard({ extracted, onUseManual }: { extracted: Extracted; onUseManual: () => void }) {
  const price = extracted.cashCents ?? extracted.listCents;
  return (
    <div className="flex gap-4 border border-cm-hairline bg-cm-soft">
      <div className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden bg-cm-card">
        {extracted.imageUrl ? (
          <img src={extracted.imageUrl} alt="" referrerPolicy="no-referrer" className="h-full w-full object-contain" />
        ) : (
          <Link2 aria-hidden className="h-6 w-6 text-cm-muted" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 py-3 pr-4">
        <div className="flex flex-wrap items-center gap-2">
          <CmTag>{extracted.store}</CmTag>
          {extracted.inStock === false && <CmTag variant="danger">Sem estoque</CmTag>}
        </div>
        <p className="line-clamp-2 text-[14px] font-bold leading-5 text-cm-ink">{extracted.title ?? "Título não encontrado"}</p>
        {extracted.blocked ? (
          <div className="flex flex-col gap-3 border border-cm-danger p-3 text-[13px] font-light text-cm-danger">
            <span className="flex items-start gap-2">
              <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              Esta loja não deixa o app ler o preço sozinho (captcha ou proteção). O app não tenta driblar isso: digite o
              preço e guarde o link para abrir a loja.
            </span>
            <CmButton size="sm" className="w-fit" onClick={onUseManual}>
              Digitar preço
            </CmButton>
          </div>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
            <span className="text-[22px] font-bold tabular-nums text-cm-ink">{formatBRL(price)}</span>
            {extracted.cashCents != null && extracted.listCents != null && extracted.listCents !== extracted.cashCents && (
              <span className="text-[13px] font-light text-cm-body">
                no Pix · preço cheio <span className="tabular-nums">{formatBRL(extracted.listCents)}</span>
              </span>
            )}
            {extracted.installmentsText && <span className="text-[13px] font-light text-cm-muted">{extracted.installmentsText}</span>}
            {price == null && <span className="text-[13px] font-light text-cm-warn">Não achamos o preço nesta página.</span>}
          </div>
        )}
        {extracted.warnings.map((w, i) => (
          <p key={i} className="flex items-start gap-2 text-[13px] font-light text-cm-warn">
            <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {w}
          </p>
        ))}
      </div>
    </div>
  );
}
