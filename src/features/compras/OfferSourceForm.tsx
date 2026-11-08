import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Link2, Loader2, PenLine, Search } from "lucide-react";
import { comprasPreviewUrl } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { Extracted } from "@/types";
import { BrlInput } from "./BrlInput";
import { errorMessage } from "./format";
import { formatBRL } from "./money";
import { Field } from "./shared";

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

/** Whether the draft has enough data to be submitted. */
export function draftIsValid(d: OfferDraft | null): boolean {
  if (!d) return false;
  if (d.kind === "url") return !d.extracted.blocked;
  return d.store.trim() !== "" && (d.listCents != null || d.cashCents != null);
}

interface OfferSourceFormProps {
  draft: OfferDraft | null;
  onChange: (d: OfferDraft | null) => void;
  className?: string;
  /** A link to preview as soon as the form shows up (quick add on the Hoje panel). */
  initialUrl?: string;
}

type Mode = "url" | "manual";

const EMPTY_MANUAL: Extract<OfferDraft, { kind: "manual" }> = {
  kind: "manual",
  store: "",
  url: "",
  listCents: null,
  cashCents: null,
  inStock: true,
};

/** URL (with preview) or manual offer entry. Shared by "add item" and "add offer". */
export function OfferSourceForm({ draft, onChange, className, initialUrl }: OfferSourceFormProps) {
  const [mode, setMode] = useState<Mode>(draft?.kind ?? "url");
  const [url, setUrl] = useState(draft?.kind === "url" ? draft.extracted.url : (initialUrl ?? ""));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const manual = draft?.kind === "manual" ? draft : EMPTY_MANUAL;
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
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="inline-flex w-fit rounded-md border border-border bg-bg-100 p-0.5">
        <ModeButton active={mode === "url"} onClick={() => switchMode("url")} icon={<Link2 className="h-3.5 w-3.5" />}>
          Colar link da loja
        </ModeButton>
        <ModeButton active={mode === "manual"} onClick={() => switchMode("manual")} icon={<PenLine className="h-3.5 w-3.5" />}>
          Preço manual
        </ModeButton>
      </div>

      {mode === "url" ? (
        <>
          <div className="flex gap-2">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.kabum.com.br/produto/…"
              onKeyDown={(e) => e.key === "Enter" && fetchPreview()}
            />
            <Button variant="secondary" onClick={fetchPreview} disabled={loading || !url.trim()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Buscar
            </Button>
          </div>
          {error && <p className="rounded-md border border-danger/40 bg-danger-subtle p-2.5 text-[13px] text-danger">{error}</p>}
          {extracted && <UrlPreviewCard extracted={extracted} onUseManual={useManualFromBlocked} />}
        </>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Loja">
            <Input
              value={manual.store}
              onChange={(e) => onChange({ ...manual, store: e.target.value })}
              placeholder="Ex.: Mercado Livre"
            />
          </Field>
          <Field label="Link (opcional)">
            <Input
              value={manual.url}
              onChange={(e) => onChange({ ...manual, url: e.target.value })}
              placeholder="https://…"
            />
          </Field>
          <Field label="Preço cheio">
            <BrlInput value={manual.listCents} onChange={(c) => onChange({ ...manual, listCents: c })} />
          </Field>
          <Field label="Preço Pix / à vista">
            <BrlInput value={manual.cashCents} onChange={(c) => onChange({ ...manual, cashCents: c })} />
          </Field>
          <label className="col-span-2 flex items-center gap-2 text-[13px] text-ink-muted">
            <Switch checked={manual.inStock} onCheckedChange={(v) => onChange({ ...manual, inStock: v })} />
            Em estoque
          </label>
        </div>
      )}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
        active ? "bg-compras-subtle text-compras" : "text-ink-muted hover:text-ink"
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function UrlPreviewCard({ extracted, onUseManual }: { extracted: Extracted; onUseManual: () => void }) {
  return (
    <div className="flex gap-3 rounded-lg border border-border bg-bg-100 p-3">
      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-bg-200">
        {extracted.imageUrl ? (
          <img src={extracted.imageUrl} alt="" referrerPolicy="no-referrer" className="h-full w-full object-contain" />
        ) : (
          <Link2 className="h-5 w-5 text-ink-faint" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Badge variant="default">{extracted.store}</Badge>
          {extracted.inStock === false && <Badge variant="danger">Sem estoque</Badge>}
        </div>
        <p className="line-clamp-2 text-[13px] font-medium text-ink">{extracted.title ?? "Título não encontrado"}</p>
        {extracted.blocked ? (
          <div className="flex flex-col gap-2 rounded-md border border-danger/40 bg-danger-subtle p-2.5 text-[12.5px] text-danger">
            <span className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Esta loja bloqueia a leitura automática (captcha/WAF). O app não tenta contornar isso. Você pode
              cadastrar a oferta manualmente, com o link para abrir a loja.
            </span>
            <Button size="sm" variant="secondary" className="w-fit" onClick={onUseManual}>
              Cadastrar como oferta manual
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[13px]">
            <span className="text-ink-muted">
              Preço: <strong className="tabular-nums text-ink">{formatBRL(extracted.listCents)}</strong>
            </span>
            <span className="text-ink-muted">
              Pix: <strong className="tabular-nums text-success">{formatBRL(extracted.cashCents)}</strong>
            </span>
            {extracted.installmentsText && <span className="text-ink-faint">{extracted.installmentsText}</span>}
          </div>
        )}
        {extracted.warnings.map((w, i) => (
          <p key={i} className="flex items-start gap-1.5 text-[12px] text-warning">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            {w}
          </p>
        ))}
      </div>
    </div>
  );
}
