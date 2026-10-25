import { config } from "@/lib/config";
import {
  draftNeedsFashionVariants,
  enrichDraftForDemoImport,
  enrichDraftWithFashion,
  fashionCompletenessAsk,
  isFashionLineComplete,
} from "@/lib/inventory/fashion";
import {
  completeDraftWithPrices,
  draftFromStoreSkus,
  draftLineKey,
  mergeDraftLines,
  normalizeDraft,
  parseCsv,
  resolveMerchantTurn,
  toStore,
  type MerchantDraft,
  type MerchantDraftLine,
  type ParsedInventory,
} from "@/lib/inventory/parse";
import { importShopifyStore } from "@/lib/inventory/shopify";
import { emit } from "@/lib/protocol/events";
import { repo } from "@/lib/store/repo";
import { hasRlusdTrustLine } from "@/lib/xrpl/seller-credential";
import type { Sku, StoreRecord } from "@/lib/store/types";
import {
  parseMerchantAddress,
  type ClassicAddress,
  type MerchantAuthProof,
} from "@/lib/wallet/xrpl";

export type MerchantToolResult =
  | {
      status: "published";
      store: StoreRecord;
      reply: string;
      draft: MerchantDraft | null;
    }
  | {
      status: "need_price";
      store: null;
      reply: string;
      draft: MerchantDraft;
    }
  | {
      status: "need_variants";
      store: null;
      reply: string;
      draft: MerchantDraft;
    }
  | {
      status: "need_wallet";
      store: null;
      reply: string;
      draft: MerchantDraft | null;
    }
  | {
      status: "clarify";
      store: null;
      reply: string;
      draft: null;
    };

function inventoryFromLines(
  lines: Array<MerchantDraftLine & { price: string }>,
  description?: string,
  storeName?: string,
  ownerUid?: string,
): ParsedInventory {
  const skus = lines.map((line) => {
    const title = line.title.trim();
    const isHackathon = /hackathon/i.test(title);
    return {
      title: isHackathon ? "Mastercard Hackathon Shirt" : title,
      description:
        description ||
        `${line.quantity} ${title} for ${line.price} ${config.tokenSymbol}`,
      quantity: line.quantity,
      price: Number(line.price).toFixed(2),
    };
  });
  const isHackathon = skus.some((s) => /hackathon/i.test(s.title));
  const name = isHackathon
    ? "Mastercard Hackathon Shirts"
    : storeName ||
      (skus.length === 1
        ? skus[0].title.replace(/\b\w/g, (c) => c.toUpperCase())
        : "Borneo Store");
  const baseSlug = isHackathon
    ? "hackathon-shirts"
    : name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 40) || "store";
  // Merchant-owned shops get a stable unique slug so publishes don't clobber
  // shared demo slugs like "borneo-store".
  const slug =
    isHackathon || !ownerUid
      ? baseSlug
      : `${baseSlug}-${ownerUid.slice(0, 8).toLowerCase()}`.slice(0, 48);
  return {
    name,
    slug,
    skus,
  };
}

function draftFromInventory(inventory: ParsedInventory): MerchantDraft {
  return enrichDraftWithFashion({
    name: inventory.name,
    slug: inventory.slug,
    lines: inventory.skus.map((s) => ({
      quantity: s.quantity,
      title: s.title,
      name: s.title,
      description: s.description,
      price: s.price,
    })),
  });
}

function needWalletResult(draft: MerchantDraft | null): MerchantToolResult {
  // Should not happen when MERCHANT_ADDRESS is set — clarify only.
  void draft;
  return {
    status: "clarify",
    store: null,
    reply:
      "Server MERCHANT_ADDRESS is missing or invalid. Set a classic XRPL r… address in env, then retry publish.",
    draft: null,
  };
}

function needVariantsResult(
  draft: MerchantDraft,
  reply?: string,
): MerchantToolResult {
  const enriched = enrichDraftWithFashion(draft);
  return {
    status: "need_variants",
    store: null,
    reply:
      reply ??
      (fashionCompletenessAsk(enriched.lines) ||
        "Fill subcategory, size, color, and other fashion details in the inventory form, then set RLUSD prices."),
    draft: enriched,
  };
}

export type MerchantPublishExtras = {
  ownerUid?: string;
  merchantDisplayName?: string;
  visaReceive?: StoreRecord["visaReceive"];
  /** When set, merge SKUs into this live store instead of creating a new one. */
  existingSlug?: string | null;
  /**
   * Merchant's own XRPL wallet (Settings). Used as payTo when it holds an
   * RLUSD trust line, so the Borneo seller credential sits on the address
   * buyers actually pay. Falls back to MERCHANT_ADDRESS otherwise.
   */
  boundWalletAddress?: string | null;
  /** Appear on /market (default true). From merchant governance. */
  listOnMarket?: boolean;
  acceptRlusd?: boolean;
  acceptXrp?: boolean;
  acceptVisa?: boolean;
};

function skuMatchKey(sku: Pick<Sku, "title">): string {
  return sku.title.trim().toLowerCase();
}

/** Merge inventory SKUs into an existing store (update by title, append new). */
export async function mergeInventoryIntoStore(
  slug: string,
  inventory: ParsedInventory,
  extras?: MerchantPublishExtras,
  payTo?: string | null,
): Promise<StoreRecord | null> {
  const existing = await repo.getStore(slug);
  if (!existing) return null;

  const byTitle = new Map(
    existing.skus.map((s) => [skuMatchKey(s), s] as const),
  );
  for (const sku of inventory.skus) {
    const key = skuMatchKey(sku);
    const prev = byTitle.get(key);
    if (prev) {
      byTitle.set(key, {
        ...prev,
        quantity: sku.quantity,
        price: Number(sku.price).toFixed(2),
        description: sku.description || prev.description,
        title: sku.title,
        attrs: sku.attrs || prev.attrs,
      });
    } else {
      byTitle.set(key, {
        id: "",
        title: sku.title,
        description: sku.description,
        quantity: sku.quantity,
        price: Number(sku.price).toFixed(2),
        attrs: sku.attrs,
      });
    }
  }

  const next: StoreRecord = {
    ...existing,
    name: inventory.name || existing.name,
    // Keep settle address in sync with MERCHANT_ADDRESS (demo shared wallet).
    merchantAddress: payTo || existing.merchantAddress,
    ownerUid: extras?.ownerUid || existing.ownerUid,
    merchantDisplayName:
      extras?.merchantDisplayName || existing.merchantDisplayName,
    visaReceive: extras?.visaReceive || existing.visaReceive,
    listOnMarket:
      extras?.listOnMarket !== undefined
        ? extras.listOnMarket !== false
        : existing.listOnMarket !== false,
    acceptRlusd:
      extras?.acceptRlusd !== undefined
        ? extras.acceptRlusd !== false
        : existing.acceptRlusd !== false,
    acceptXrp:
      extras?.acceptXrp !== undefined
        ? extras.acceptXrp !== false
        : existing.acceptXrp !== false,
    acceptVisa:
      extras?.acceptVisa !== undefined
        ? extras.acceptVisa !== false
        : existing.acceptVisa !== false,
    skus: [...byTitle.values()],
    updatedAt: new Date().toISOString(),
  };
  return repo.putStore(next);
}

/**
 * payTo: the merchant's bound wallet when it can receive RLUSD (trust line),
 * else the shared MERCHANT_ADDRESS demo wallet.
 */
async function resolvePayTo(
  extras?: MerchantPublishExtras,
): Promise<{ payTo: ClassicAddress | null; usedBound: boolean; note?: string }> {
  const fallback = parseMerchantAddress(config.merchantAddress);
  const bound = parseMerchantAddress(extras?.boundWalletAddress);
  if (!bound) return { payTo: fallback, usedBound: false };
  if (await hasRlusdTrustLine(bound)) {
    return { payTo: bound, usedBound: true };
  }
  return {
    payTo: fallback,
    usedBound: false,
    note: `Your bound wallet has no ${config.tokenSymbol} trust line yet, so payouts use the shared demo address. Add the trust line and re-publish to settle to your own wallet.`,
  };
}

async function publishStore(
  inventory: ParsedInventory,
  _merchantAuth?: MerchantAuthProof | null,
  extras?: MerchantPublishExtras,
): Promise<MerchantToolResult> {
  const { payTo, note: payToNote } = await resolvePayTo(extras);
  if (!payTo) {
    return needWalletResult(draftFromInventory(inventory));
  }
  if (!extras?.visaReceive?.accountLabel?.trim()) {
    return {
      status: "clarify",
      store: null,
      reply:
        "Set up your Mastercard fiat receiving account before publishing (account label required). Both crypto and Mastercard receive rails are required.",
      draft: null,
    };
  }
  if (!extras.ownerUid) {
    return {
      status: "clarify",
      store: null,
      reply:
        "Sign in as a merchant to publish — products must link to your account.",
      draft: null,
    };
  }

  const existingSlug = extras.existingSlug?.trim();
  if (existingSlug) {
    const merged = await mergeInventoryIntoStore(
      existingSlug,
      inventory,
      extras,
      payTo,
    );
    if (merged) {
      emit({
        status: 200,
        method: "POST",
        path: `/onboard`,
        store: merged.slug,
        message: `updated /s/${merged.slug} skus=${merged.skus.length}`,
      });
      const sheet = draftFromStoreSkus(merged);
      return {
        status: "published",
        store: merged,
        reply: `Inventory updated on /s/${merged.slug} and listed on /market. There ${merged.skus.length === 1 ? "is" : "are"} now ${merged.skus.length} SKU${merged.skus.length === 1 ? "" : "s"} priced in ${config.tokenSymbol}. View inventory sheet to keep editing.${payToNote ? ` ${payToNote}` : ""}`,
        draft: sheet,
      };
    }
  }

  // Prefer unique merchant slug; keep existingSlug if re-creating after catalog miss
  let publishSlug = inventory.slug;
  if (existingSlug) {
    publishSlug = existingSlug;
  } else if (extras.ownerUid && inventory.slug !== "hackathon-shirts") {
    const suffix = extras.ownerUid.slice(0, 8).toLowerCase();
    if (!inventory.slug.endsWith(`-${suffix}`)) {
      publishSlug = `${inventory.slug.slice(0, 40)}-${suffix}`.slice(0, 48);
    }
  }

  const store = toStore(
    { ...inventory, slug: publishSlug },
    payTo,
    {
      ownerUid: extras.ownerUid,
      merchantDisplayName: extras.merchantDisplayName,
      visaReceive: {
        accountLabel: extras.visaReceive.accountLabel.trim(),
        receiveId: extras.visaReceive.receiveId?.trim() || undefined,
        settlementNote: extras.visaReceive.settlementNote?.trim() || undefined,
      },
      listOnMarket: extras.listOnMarket !== false,
      acceptRlusd: extras.acceptRlusd !== false,
      acceptXrp: extras.acceptXrp !== false,
      acceptVisa: extras.acceptVisa !== false,
      slug: publishSlug,
    },
  );
  await repo.putStore(store);
  emit({
    status: 200,
    method: "POST",
    path: `/onboard`,
    store: store.slug,
    message: `published /s/${store.slug}/llms.txt owner=${store.ownerUid} market=${store.listOnMarket !== false}`,
  });
  const sheet = draftFromStoreSkus(store);
  return {
    status: "published",
    store,
    reply: `The store is now live on /market. Agents can read /s/${store.slug}/llms.txt — and the shop is listed on the network /llms.txt registry. There ${store.skus.length === 1 ? "is" : "are"} ${store.skus.length} SKU${store.skus.length === 1 ? "" : "s"} priced in ${config.tokenSymbol}. Settlements go to ${store.merchantAddress}.${payToNote ? ` ${payToNote}` : ""} Next: in Settings, get a Borneo verified-seller credential on XRPL so agents rank you higher.`,
    draft: sheet,
  };
}

function needPriceResult(
  draft: MerchantDraft,
  reply?: string,
): MerchantToolResult {
  const enriched = enrichDraftWithFashion(draft);
  if (draftNeedsFashionVariants(enriched.lines)) {
    return needVariantsResult(
      enriched,
      `${reply ? `${reply} ` : ""}${fashionCompletenessAsk(enriched.lines)}`,
    );
  }
  const list = enriched.lines
    .map((l) => `${l.quantity} ${l.title}`)
    .join(", ");
  return {
    status: "need_price",
    store: null,
    reply:
      reply ??
      `Got it — ${list}. Confirm fashion details and ${config.tokenSymbol} prices below, then submit.`,
    draft: enriched,
  };
}

/** Import Shopify catalog → classify fashion + confirm/edit (never auto-publish). */
export async function importStoreFromUrl(
  url: string,
): Promise<MerchantToolResult> {
  const imported = await importShopifyStore(url);
  if (!imported.ok) {
    return {
      status: "clarify",
      store: null,
      reply: imported.reason,
      draft: null,
    };
  }

  const enriched = enrichDraftForDemoImport(imported.draft);
  const pricedCount = enriched.lines.filter((l) => l.price).length;
  const reply = `Imported ${imported.productCount} product${imported.productCount === 1 ? "" : "s"} from ${imported.storeHost}. Fashion fields, qty, and ${config.tokenSymbol} prices are prefilled for your demo (FX rate ${imported.rate.toFixed(4)} SGD/USD via ${imported.rateSource}${pricedCount < imported.productCount ? "; some items need a price" : ""}). Review the inventory sheet and submit when ready.`;

  return needPriceResult(enriched, reply);
}

/** Deterministic merchant inventory / publish tool. */
export async function createStoreTool(args: {
  message?: string;
  csv?: string;
  url?: string;
  draft?: MerchantDraft | null;
  quantity?: number;
  title?: string;
  price?: string;
  items?: Array<{ quantity: number; title: string; price?: string }>;
  prices?: Array<string | number | null | undefined>;
  storeName?: string;
  merchantAuth?: MerchantAuthProof | null;
  ownerUid?: string;
  merchantDisplayName?: string;
  visaReceive?: StoreRecord["visaReceive"];
  existingSlug?: string | null;
  boundWalletAddress?: string | null;
  listOnMarket?: boolean;
  acceptRlusd?: boolean;
  acceptXrp?: boolean;
  acceptVisa?: boolean;
}): Promise<MerchantToolResult> {
  const draft = normalizeDraft(args.draft);
  const auth = args.merchantAuth;
  const extras: MerchantPublishExtras = {
    ownerUid: args.ownerUid,
    merchantDisplayName: args.merchantDisplayName,
    visaReceive: args.visaReceive,
    existingSlug: args.existingSlug,
    boundWalletAddress: args.boundWalletAddress,
    listOnMarket: args.listOnMarket,
    acceptRlusd: args.acceptRlusd,
    acceptXrp: args.acceptXrp,
    acceptVisa: args.acceptVisa,
  };

  if (draft && args.prices && args.prices.length > 0) {
    const parsed = completeDraftWithPrices(draft, args.prices);
    if (!parsed.ok) {
      if (parsed.missing === "variants") {
        return needVariantsResult(parsed.draft, parsed.ask);
      }
      if (parsed.missing === "price") {
        return needPriceResult(parsed.draft);
      }
      return {
        status: "clarify",
        store: null,
        reply: parsed.ask,
        draft: null,
      };
    }
    return publishStore(parsed.inventory, auth, extras);
  }

  if (args.url?.trim()) {
    return importStoreFromUrl(args.url.trim());
  }

  if (args.items && args.items.length > 0) {
    const lines = args.items.map((item) => ({
      quantity: Number(item.quantity),
      title: String(item.title).trim(),
      price: item.price?.trim(),
    }));
    let needDraft: MerchantDraft = enrichDraftWithFashion({
      name: args.storeName,
      lines: lines.map(({ quantity, title, price }) => ({
        quantity,
        title,
        price,
      })),
    });
    if (draft) {
      needDraft = mergeDraftLines(draft, needDraft.lines);
    }
    const missingPrice = needDraft.lines.some(
      (l) =>
        !l.price ||
        !Number.isFinite(Number(l.price)) ||
        Number(l.price) <= 0 ||
        !l.title ||
        !Number.isFinite(l.quantity) ||
        l.quantity <= 0,
    );
    if (missingPrice || draftNeedsFashionVariants(needDraft.lines)) {
      return needPriceResult(needDraft);
    }
    return publishStore(
      inventoryFromLines(
        needDraft.lines.map((l) => ({
          quantity: l.quantity,
          title: l.title,
          price: String(l.price),
        })),
        args.message,
        args.storeName || needDraft.name,
        args.ownerUid,
      ),
      auth,
      extras,
    );
  }

  const qty = Number(args.quantity);
  const title = args.title?.trim();
  const priceRaw = args.price?.trim();

  if (title && Number.isFinite(qty) && qty > 0) {
    let needDraft: MerchantDraft = enrichDraftWithFashion({
      name: title.replace(/\b\w/g, (c) => c.toUpperCase()),
      lines: [{ quantity: qty, title, price: priceRaw }],
    });
    if (draft) {
      needDraft = mergeDraftLines(draft, needDraft.lines);
    }
    if (
      needDraft.lines.some(
        (l) =>
          !l.price ||
          !Number.isFinite(Number(l.price)) ||
          Number(l.price) <= 0,
      ) ||
      draftNeedsFashionVariants(needDraft.lines)
    ) {
      return needPriceResult(needDraft);
    }
    return publishStore(
      inventoryFromLines(
        needDraft.lines.map((l) => ({
          quantity: l.quantity,
          title: l.title,
          price: String(l.price),
        })),
        args.message,
        args.storeName || needDraft.name,
        args.ownerUid,
      ),
      auth,
      extras,
    );
  }

  if (args.csv?.trim()) {
    const parsed = parseCsv(args.csv);
    if (!parsed.ok) {
      if (parsed.missing === "price" || parsed.missing === "variants") {
        const merged = draft
          ? mergeDraftLines(draft, parsed.draft.lines)
          : parsed.draft;
        return needPriceResult(merged, parsed.ask);
      }
      return {
        status: "clarify",
        store: null,
        reply: parsed.ask,
        draft: null,
      };
    }
    const asDraft = draftFromInventory(parsed.inventory);
    const merged = draft ? mergeDraftLines(draft, asDraft.lines) : asDraft;
    if (draftNeedsFashionVariants(merged.lines)) {
      return needVariantsResult(merged);
    }
    return needPriceResult(
      merged,
      `Loaded ${asDraft.lines.length} SKU(s)${draft ? ` into your sheet (${merged.lines.length} total)` : ""}. Confirm details and ${config.tokenSymbol} prices, then publish.`,
    );
  }

  const parsed = resolveMerchantTurn({
    message: args.message?.trim() || "",
    draft,
  });

  if (!parsed.ok) {
    if (parsed.missing === "price" || parsed.missing === "variants") {
      return needPriceResult(parsed.draft, parsed.ask);
    }
    return {
      status: "clarify",
      store: null,
      reply: parsed.ask,
      draft: null,
    };
  }

  const asDraft = draftFromInventory(parsed.inventory);
  if (draftNeedsFashionVariants(asDraft.lines)) {
    return needVariantsResult(asDraft);
  }

  return publishStore(parsed.inventory, auth, extras);
}

/** Save a complete draft sheet onto a live store (sheet editor path). */
export async function saveDraftToLiveStore(args: {
  slug: string;
  draft: MerchantDraft;
  prices: string[];
  quantities: string[];
  merchantAuth?: MerchantAuthProof | null;
  ownerUid?: string;
  merchantDisplayName?: string;
  visaReceive?: StoreRecord["visaReceive"];
  boundWalletAddress?: string | null;
  listOnMarket?: boolean;
  acceptRlusd?: boolean;
  acceptXrp?: boolean;
  acceptVisa?: boolean;
}): Promise<MerchantToolResult> {
  const draft = normalizeDraft(args.draft);
  if (!draft) {
    return {
      status: "clarify",
      store: null,
      reply: "No inventory to save.",
      draft: null,
    };
  }
  const withQty: MerchantDraft = {
    ...draft,
    lines: draft.lines.map((line, i) => ({
      ...line,
      quantity: Math.max(
        1,
        Math.floor(Number(args.quantities[i]) || line.quantity || 1),
      ),
      price: args.prices[i] || line.price,
    })),
  };

  // Only push complete rows to the live catalog; keep incomplete locally
  const completeLines = withQty.lines.filter((line) => {
    const priceOk =
      line.price &&
      Number.isFinite(Number(line.price)) &&
      Number(line.price) > 0;
    return priceOk && isFashionLineComplete(line) && line.title.trim();
  });

  if (completeLines.length === 0) {
    return needPriceResult(
      withQty,
      "No complete SKUs to save yet — fill size/color, qty, and RLUSD price on at least one row.",
    );
  }

  const completeDraft: MerchantDraft = {
    ...withQty,
    lines: completeLines,
  };
  const parsed = completeDraftWithPrices(
    completeDraft,
    completeDraft.lines.map((l) => l.price),
  );
  if (!parsed.ok) {
    if (parsed.missing === "variants") {
      return needVariantsResult(parsed.draft, parsed.ask);
    }
    if (parsed.missing === "price") {
      return needPriceResult(parsed.draft, parsed.ask);
    }
    return {
      status: "clarify",
      store: null,
      reply: parsed.ask,
      draft: null,
    };
  }
  const published = await publishStore(parsed.inventory, args.merchantAuth, {
    ownerUid: args.ownerUid,
    merchantDisplayName: args.merchantDisplayName,
    visaReceive: args.visaReceive,
    existingSlug: args.slug,
    boundWalletAddress: args.boundWalletAddress,
    listOnMarket: args.listOnMarket,
    acceptRlusd: args.acceptRlusd,
    acceptXrp: args.acceptXrp,
    acceptVisa: args.acceptVisa,
  });
  // Return full working sheet (complete + incomplete) after save
  if (published.status === "published") {
    const left = withQty.lines.length - completeLines.length;
    return {
      ...published,
      draft: withQty,
      reply:
        left > 0
          ? `${published.reply} ${left} incomplete row(s) stayed on the sheet only.`
          : published.reply,
    };
  }
  return published;
}

export type { ClassicAddress, MerchantAuthProof };
export type HexAddress = ClassicAddress;
export { draftLineKey };
