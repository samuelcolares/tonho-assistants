import {
  comprasAddManualPrice,
  comprasRefresh,
  comprasSaveImageFromUrl,
  comprasUpsertOffer,
} from "@/api";
import type { ComprasItem, ComprasOffer, OfferView } from "@/types";
import type { OfferDraft } from "./OfferSourceForm";

export function blankItem(partial: Partial<ComprasItem>): ComprasItem {
  return {
    id: "",
    category: "",
    name: "",
    qty: 1,
    budgetUnitCents: null,
    targetCents: null,
    notes: "",
    bought: false,
    imagePath: null,
    specs: {},
    templateId: null,
    modelToken: null,
    priority: 1,
    createdAt: "",
    updatedAt: "",
    room: null,
    archived: false,
    ...partial,
  };
}

function blankOffer(itemId: string, partial: Partial<ComprasOffer>): ComprasOffer {
  return {
    id: "",
    itemId,
    store: "",
    url: null,
    title: null,
    sku: null,
    adapter: "generic",
    shippingCents: null,
    shippingNote: null,
    pixDiscountPct: null,
    status: "pending",
    failCount: 0,
    lastError: null,
    lastCheckedAt: null,
    nextPollAt: null,
    createdAt: "",
    ...partial,
  };
}

/** Strips view-only fields so only the ComprasOffer contract goes over IPC. */
export function toOffer(o: OfferView): ComprasOffer {
  return {
    id: o.id,
    itemId: o.itemId,
    store: o.store,
    url: o.url,
    title: o.title,
    sku: o.sku,
    adapter: o.adapter,
    shippingCents: o.shippingCents,
    shippingNote: o.shippingNote,
    pixDiscountPct: o.pixDiscountPct,
    status: o.status,
    failCount: o.failCount,
    lastError: o.lastError,
    lastCheckedAt: o.lastCheckedAt,
    nextPollAt: o.nextPollAt,
    createdAt: o.createdAt,
  };
}

export interface CreateOfferResult {
  /** Non-fatal problem (e.g. image download failed). */
  warning?: string;
}

/**
 * Persists an offer draft for an item.
 * - URL drafts become auto-polled offers; the preview price is stored as the first observation
 *   (a refresh is queued only when the preview had no usable price).
 * - Manual drafts become adapter "manual" offers with a typed price observation.
 * `saveImage` also downloads the preview image (used when creating a new item).
 */
export async function createOfferFromDraft(
  itemId: string,
  draft: OfferDraft,
  opts: { saveImage?: boolean } = {}
): Promise<CreateOfferResult> {
  let warning: string | undefined;

  if (draft.kind === "url") {
    const e = draft.extracted;
    const offer = await comprasUpsertOffer(
      blankOffer(itemId, {
        store: e.store,
        url: e.url,
        title: e.title,
        sku: e.sku,
        adapter: e.adapter,
        status: "pending",
      }),
      e
    );
    if (opts.saveImage && e.imageUrl) {
      try {
        await comprasSaveImageFromUrl(itemId, e.imageUrl);
      } catch (err) {
        warning = `Item criado, mas a imagem não foi salva: ${String(err)}`;
      }
    }
    const seeded = !e.blocked && (e.listCents != null || e.cashCents != null);
    if (!seeded) {
      try {
        await comprasRefresh(null, offer.id);
      } catch {
        // the ticker will pick it up anyway
      }
    }
    return { warning };
  }

  const offer = await comprasUpsertOffer(
    blankOffer(itemId, {
      store: draft.store.trim(),
      url: draft.url.trim() || null,
      adapter: "manual",
      status: "manual",
    })
  );
  await comprasAddManualPrice(offer.id, draft.listCents, draft.cashCents, draft.inStock);
  return { warning };
}
