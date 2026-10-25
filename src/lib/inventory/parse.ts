import type { Sku, StoreRecord } from "@/lib/store/types";
import { config } from "@/lib/config";
import Papa from "papaparse";
import {
  applyFashionTitlesToLines,
  draftNeedsFashionVariants,
  enrichDraftWithFashion,
  enrichFashionMeta,
  fashionCompletenessAsk,
  type FashionAxis,
  type FashionMeta,
  type FashionSubcategory,
} from "@/lib/inventory/fashion";

export type ParsedInventory = {
  name: string;
  slug: string;
  skus: Omit<Sku, "id">[];
};

/** Slim attrs stamped onto published SKUs for agent catalog/search. */
export function skuAttrsFromFashion(
  fashion?: FashionMeta | null,
): Sku["attrs"] | undefined {
  if (!fashion?.subcategory) return undefined;
  const attrs = fashion.attrs ?? {};
  const tags: string[] = [];
  const push = (v?: string) => {
    const t = String(v || "").trim();
    if (t && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) {
      tags.push(t);
    }
  };
  push(fashion.style);
  push(attrs.fit);
  push(attrs.length);
  push(attrs.pattern);
  push(attrs.finish);
  if (attrs.waist && attrs.inseam) push(`${attrs.waist}x${attrs.inseam}`);
  else {
    push(attrs.waist);
    push(attrs.inseam);
  }
  if (attrs.band && attrs.cup) push(`${attrs.band}${attrs.cup}`);
  push(attrs.frameColor);
  push(attrs.lensColor);
  push(attrs.metal);

  const size =
    String(attrs.size || "").trim() ||
    (attrs.waist && attrs.inseam
      ? `${attrs.waist}x${attrs.inseam}`
      : String(attrs.waist || "").trim()) ||
    (attrs.band && attrs.cup
      ? `${attrs.band}${attrs.cup}`
      : String(attrs.band || "").trim()) ||
    undefined;

  const color =
    String(attrs.color || attrs.frameColor || "").trim() || undefined;
  const material =
    String(attrs.material || attrs.metal || "").trim() || undefined;

  return {
    subcategory: fashion.subcategory,
    color,
    size,
    material,
    tags: tags.length ? tags : undefined,
  };
}

export type MerchantDraftLine = {
  quantity: number;
  title: string;
  name?: string;
  /** Optional product blurb (e.g. from Shopify body_html). */
  description?: string;
  /** Set when inventory is priced but wallet is still missing. */
  price?: string;
  /** Fashion taxonomy + editable variant axes. */
  fashion?: FashionMeta | null;
};

export type MerchantDraft = {
  name?: string;
  slug?: string;
  lines: MerchantDraftLine[];
};

/** Accept legacy single-line drafts from older clients. */
export function normalizeDraft(
  draft:
    | MerchantDraft
    | { quantity: number; title: string; name?: string; lines?: MerchantDraftLine[] }
    | null
    | undefined,
): MerchantDraft | null {
  if (!draft) return null;
  if (Array.isArray(draft.lines) && draft.lines.length > 0) {
    const normalized: MerchantDraft = {
      name: draft.name,
      slug: "slug" in draft ? draft.slug : undefined,
      lines: draft.lines.map((line) => ({
        quantity: Number(line.quantity),
        title: String(line.title).trim(),
        name: line.name,
        description: line.description,
        price: line.price,
        fashion: line.fashion ?? null,
      })),
    };
    return enrichDraftWithFashion(normalized);
  }
  if ("quantity" in draft && "title" in draft && draft.title) {
    return enrichDraftWithFashion({
      name: draft.name,
      lines: [
        {
          quantity: Number(draft.quantity),
          title: String(draft.title).trim(),
          name: draft.name,
        },
      ],
    });
  }
  return null;
}

export type InventoryParseResult =
  | { ok: true; inventory: ParsedInventory }
  | {
      ok: false;
      missing: "price";
      draft: MerchantDraft;
      ask: string;
    }
  | {
      ok: false;
      missing: "variants";
      draft: MerchantDraft;
      ask: string;
    }
  | {
      ok: false;
      missing: "inventory";
      draft: null;
      ask: string;
    };

export function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 48) || "store"
  );
}

/** Ensure SKU ids are unique within a store (slugify collisions on long similar titles). */
export function ensureUniqueSkuIds(store: StoreRecord): StoreRecord {
  const used = new Set<string>();
  return {
    ...store,
    skus: store.skus.map((sku, index) => {
      const fallback = `sku-${index + 1}`;
      let id = (sku.id || slugify(sku.title) || fallback).slice(0, 48);
      if (!id) id = fallback;
      if (!used.has(id)) {
        used.add(id);
        return sku.id === id ? sku : { ...sku, id };
      }
      const base = id.slice(0, 44);
      let n = 2;
      let candidate = `${base}-${n}`;
      while (used.has(candidate)) {
        n += 1;
        candidate = `${base}-${n}`;
      }
      used.add(candidate);
      return { ...sku, id: candidate };
    }),
  };
}

function cleanPrompt(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function stripSellerPreamble(text: string) {
  return text
    .replace(
      /^(?:create a store[.!]?\s*)?(?:i(?:'m| am) selling|selling|sell)\s+/i,
      "",
    )
    .replace(
      /^(?:i\s+wanna\s+set\s+up|i\s+want\s+to\s+set\s+up|set\s+up)\s+(?:a\s+)?(?:\w+\s+)*store[,.]?\s*/i,
      "",
    )
    .trim();
}

function normalizeTitle(raw: string) {
  return raw
    .replace(/\s+for\s+\d+(?:\.\d+)?\s*(?:usdc|usd|xsgd|sgd)?\.?$/i, "")
    .replace(/[.,!;:?]+$/g, "")
    .trim();
}

function storeNameFromTitle(title: string) {
  if (/hackathon/i.test(title)) return "Mastercard Hackathon Shirts";
  return title.replace(/\b\w/g, (c) => c.toUpperCase());
}

function looksLikeGreetingOrChat(text: string) {
  const t = cleanPrompt(text).toLowerCase().replace(/[!?.]+$/g, "");
  if (!t) return true;
  if (
    /^(hi|hello|hey|yo|sup|thanks|thank you|thx|ok|okay|cool|nice|help|what|whats|what's|whatt|huh|hm+|umm+|idk|lol|haha|test)$/i.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /^(hi|hello|hey)\b/.test(t) &&
    !/\d+\s+\w+/.test(t) &&
    !/\bselling\b/i.test(t)
  ) {
    return true;
  }
  if (
    /^(what|how|why|who|where|can you|could you|help)\b/i.test(t) &&
    !/\bselling\b/i.test(t) &&
    !/\d+\s+[a-z]/i.test(t) &&
    !/\b(add|stock|sell|caps?|hats?|tees?|shirts?|pants?|jeans|shorts?|sneakers?|shoes?|bags?|inventory)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

function hasSellIntent(text: string) {
  return /(?:create\s+a\s+store|i(?:'m| am)\s+selling|\bselling\b|\bsell\b|set\s+up\s+(?:a\s+)?\w+\s+store)/i.test(
    text,
  );
}

/** Price-only follow-up after we asked "how much?" */
export function parsePriceOnly(text: string): string | null {
  const cleaned = cleanPrompt(text);
  const match = cleaned.match(
    /^(?:for\s+)?(\d+(?:\.\d+)?)\s*(?:usdc|usd|xsgd|sgd)?(?:\s+each)?\.?$/i,
  );
  return match ? Number(match[1]).toFixed(2) : null;
}

function guideAsk() {
  return `Tell me what you're selling — quantity, product, and price in ${config.tokenSymbol}. Example: "10 water bottles for 2 RLUSD each".`;
}

function priceAsk(draft: MerchantDraft) {
  if (draft.lines.length === 1) {
    const { quantity, title } = draft.lines[0];
    const unit = title.replace(/s$/i, "") || title;
    return `Got it — ${quantity} ${title}. Fill in the ${config.tokenSymbol} price below (or reply e.g. "2 ${config.tokenSymbol} each").`;
  }
  const list = draft.lines
    .map((l) => `${l.quantity} ${l.title}`)
    .join(", ");
  return `Got it — ${list}. Fill in a ${config.tokenSymbol} price for each product below.`;
}

function draftFromLines(
  lines: MerchantDraftLine[],
  storeHint?: string,
): MerchantDraft {
  const name =
    storeHint ||
    (lines.length === 1
      ? storeNameFromTitle(lines[0].title)
      : "Borneo Store");
  return enrichDraftWithFashion({
    name,
    slug: slugify(name),
    lines,
  });
}

/** Stable key for matching SKUs across chat / sheet / store. */
export function draftLineKey(line: MerchantDraftLine): string {
  const fashion =
    line.fashion ?? enrichFashionMeta(line.title, line.description);
  const style = (fashion.style || line.title || "").trim().toLowerCase();
  const attrs = fashion.attrs ?? {};
  const bits = Object.keys(attrs)
    .sort()
    .map((k) => `${k}:${String(attrs[k as FashionAxis] ?? "").trim().toLowerCase()}`)
    .join("|");
  return `${fashion.subcategory}::${style}::${bits || line.title.trim().toLowerCase()}`;
}

/**
 * Append or update draft lines. Matching keys update qty/price/attrs;
 * new keys are concatenated.
 */
export function mergeDraftLines(
  existing: MerchantDraft,
  incoming: MerchantDraftLine[],
): MerchantDraft {
  const base = normalizeDraft(existing) ?? enrichDraftWithFashion(existing);
  const nextLines = [...base.lines];
  const indexByKey = new Map<string, number>();
  nextLines.forEach((line, i) => indexByKey.set(draftLineKey(line), i));

  for (const raw of incoming) {
    const line = {
      ...raw,
      fashion: enrichFashionMeta(raw.title, raw.description, raw.fashion),
    };
    const key = draftLineKey(line);
    const at = indexByKey.get(key);
    if (at == null) {
      indexByKey.set(key, nextLines.length);
      nextLines.push(line);
      continue;
    }
    const prev = nextLines[at]!;
    nextLines[at] = {
      ...prev,
      ...line,
      quantity: line.quantity || prev.quantity,
      price: line.price || prev.price,
      description: line.description || prev.description,
      fashion: {
        ...prev.fashion!,
        ...line.fashion!,
        attrs: {
          ...(prev.fashion?.attrs ?? {}),
          ...(line.fashion?.attrs ?? {}),
        },
      },
    };
  }

  return enrichDraftWithFashion({
    ...base,
    lines: nextLines,
  });
}

/** Rebuild a draft sheet from published store SKUs (best-effort fashion parse). */
export function draftFromStoreSkus(
  store: Pick<StoreRecord, "name" | "slug" | "skus">,
): MerchantDraft {
  return enrichDraftWithFashion({
    name: store.name,
    slug: store.slug,
    lines: store.skus.map((sku) => ({
      quantity: sku.quantity,
      title: sku.title,
      name: sku.title,
      description: sku.description,
      price: sku.price,
    })),
  });
}

/** Extract "5 shirts, 5 jeans, 10 socks" style lines (optionally with prices). */
export function extractInventoryLines(text: string): {
  lines: Array<MerchantDraftLine & { price?: string }>;
  storeHint?: string;
} | null {
  const cleaned = cleanPrompt(text);
  if (!cleaned) return null;

  const storeMatch = cleaned.match(
    /(?:set\s+up|open|create)\s+(?:a\s+)?([a-z][a-z\s]{0,40}?)\s+store/i,
  );
  const storeHint = storeMatch
    ? storeNameFromTitle(storeMatch[1].trim())
    : undefined;

  const body = stripSellerPreamble(cleaned);
  const withPrices: Array<MerchantDraftLine & { price?: string }> = [];

  // "5 shirts for 2 RLUSD, 5 jeans at 10"
  const pricedRe =
    /(\d+)\s+([a-z][a-z0-9\s-]{0,40}?)\s+(?:for|at|@|=)\s+(\d+(?:\.\d+)?)\s*(?:usdc|usd|xsgd|sgd)?(?:\s+each)?/gi;
  let m: RegExpExecArray | null;
  const pricedSpans: Array<{ start: number; end: number }> = [];
  while ((m = pricedRe.exec(body)) !== null) {
    withPrices.push({
      quantity: Number(m[1]),
      title: normalizeTitle(m[2]),
      price: Number(m[3]).toFixed(2),
    });
    pricedSpans.push({ start: m.index, end: m.index + m[0].length });
  }

  // Strip priced spans then find qty+title without price
  let remainder = body;
  for (const span of [...pricedSpans].reverse()) {
    remainder =
      remainder.slice(0, span.start) + " " + remainder.slice(span.end);
  }
  remainder = remainder.replace(/\s+/g, " ").trim();

  const bareRe = /(\d+)\s+([a-z][a-z0-9\s-]{1,40}?)(?=\s*(?:,|and|&|\d+\s+[a-z]|$))/gi;
  while ((m = bareRe.exec(remainder)) !== null) {
    const title = normalizeTitle(m[2]);
    if (!title || title.length < 2) continue;
    if (looksLikeGreetingOrChat(title)) continue;
    withPrices.push({ quantity: Number(m[1]), title });
  }

  // Single "10 water bottles" leftover
  if (withPrices.length === 0) {
    const single = remainder.match(/^(\d+)\s+([a-z].+)$/i);
    if (single) {
      const title = normalizeTitle(single[2]);
      if (title && !looksLikeGreetingOrChat(title)) {
        withPrices.push({ quantity: Number(single[1]), title });
      }
    }
  }

  // "add 5 caps" / "can I add caps?" / "also add in pants"
  if (withPrices.length === 0) {
    const addQty = cleaned.match(
      /(?:add(?:\s+in)?|also(?:\s+add)?|stock)\s+(\d+)\s+([a-z][a-z0-9\s-]{1,40}?)(?:\s+too)?[.?!]?$/i,
    );
    if (addQty) {
      const title = normalizeTitle(addQty[2]);
      if (title && !looksLikeGreetingOrChat(title)) {
        withPrices.push({ quantity: Number(addQty[1]), title });
      }
    }
  }
  if (withPrices.length === 0) {
    const addBare = cleaned.match(
      /(?:can\s+i\s+)?(?:add(?:\s+in)?|also(?:\s+add)?)\s+(?:some\s+|a\s+few\s+)?([a-z][a-z0-9\s-]{1,40}?)(?:\s+too)?[.?!]?$/i,
    );
    if (addBare) {
      const title = normalizeTitle(addBare[1]);
      if (
        title &&
        title.length >= 2 &&
        !/^(in|to|the|my|some|more)$/i.test(title) &&
        !looksLikeGreetingOrChat(title)
      ) {
        withPrices.push({ quantity: 5, title });
      }
    }
  }

  if (withPrices.length === 0) return null;
  return { lines: withPrices, storeHint };
}

export function parseMerchantPrompt(text: string): InventoryParseResult {
  const cleaned = cleanPrompt(text);
  if (!cleaned || looksLikeGreetingOrChat(cleaned)) {
    return { ok: false, missing: "inventory", draft: null, ask: guideAsk() };
  }

  const extracted = extractInventoryLines(cleaned);
  if (extracted && extracted.lines.length > 0) {
    const missingPrice = extracted.lines.some(
      (l) => !l.price || !Number.isFinite(Number(l.price)) || Number(l.price) <= 0,
    );
    if (missingPrice) {
      const draft = draftFromLines(
        extracted.lines.map(({ quantity, title }) => ({ quantity, title })),
        extracted.storeHint,
      );
      return {
        ok: false,
        missing: "price",
        draft,
        ask: priceAsk(draft),
      };
    }
    const skus = extracted.lines.map((line) => {
      const isHackathon = /hackathon/i.test(line.title);
      return {
        title: isHackathon ? "Mastercard Hackathon Shirt" : line.title,
        description: `${line.quantity} ${line.title} for ${line.price} ${config.tokenSymbol}`,
        quantity: line.quantity,
        price: String(line.price),
      };
    });
    const isHackathon = skus.some((s) => /hackathon/i.test(s.title));
    const name = isHackathon
      ? "Mastercard Hackathon Shirts"
      : extracted.storeHint ||
        (skus.length === 1
          ? storeNameFromTitle(skus[0].title)
          : "Borneo Store");
    return {
      ok: true,
      inventory: {
        name,
        slug: isHackathon ? "hackathon-shirts" : slugify(name),
        skus,
      },
    };
  }

  const sellIntent = hasSellIntent(cleaned);
  if (sellIntent && !parsePriceOnly(cleaned)) {
    return {
      ok: false,
      missing: "inventory",
      draft: null,
      ask: `Almost — I need quantity + product (+ price). Example: "5 shirts, 5 jeans, 10 socks" then set prices.`,
    };
  }

  return { ok: false, missing: "inventory", draft: null, ask: guideAsk() };
}

/** Merge a single price reply onto a pending draft (first line without price / only line). */
export function completeDraftWithPrice(
  draft: MerchantDraft,
  priceText: string,
): InventoryParseResult {
  const normalized = normalizeDraft(draft);
  if (!normalized) {
    return { ok: false, missing: "inventory", draft: null, ask: guideAsk() };
  }
  const price = parsePriceOnly(priceText);
  if (!price) {
    return {
      ok: false,
      missing: "price",
      draft: normalized,
      ask: `Still need prices. Use the form below or reply with a number in ${config.tokenSymbol}.`,
    };
  }
  if (normalized.lines.length === 1) {
    return completeDraftWithPrices(normalized, [price]);
  }
  return {
    ok: false,
    missing: "price",
    draft: normalized,
    ask: priceAsk(normalized),
  };
}

/** Apply prices (by index) to every draft line and publish inventory. */
export function completeDraftWithPrices(
  draft: MerchantDraft,
  prices: Array<string | number | null | undefined>,
): InventoryParseResult {
  const normalized = normalizeDraft(draft);
  if (!normalized) {
    return { ok: false, missing: "inventory", draft: null, ask: guideAsk() };
  }

  if (draftNeedsFashionVariants(normalized.lines)) {
    return {
      ok: false,
      missing: "variants",
      draft: normalized,
      ask:
        fashionCompletenessAsk(normalized.lines) ||
        "Fill subcategory, size, color, and other fashion details in the inventory form.",
    };
  }

  const titledLines = applyFashionTitlesToLines(normalized.lines);
  const skus: Omit<Sku, "id">[] = [];
  for (let i = 0; i < titledLines.length; i++) {
    const line = titledLines[i];
    const raw = prices[i] ?? line.price;
    const priceNum = Number(String(raw ?? "").replace(/[^\d.]/g, ""));
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      return {
        ok: false,
        missing: "price",
        draft: { ...normalized, lines: titledLines },
        ask: `Need a ${config.tokenSymbol} price for ${line.quantity} ${line.title}.`,
      };
    }
    const price = priceNum.toFixed(2);
    const isHackathon = /hackathon/i.test(line.title);
    skus.push({
      title: isHackathon ? "Mastercard Hackathon Shirt" : line.title,
      description:
        line.description?.trim() ||
        `${line.quantity} ${line.title} for ${price} ${config.tokenSymbol}`,
      quantity: line.quantity,
      price,
      attrs: skuAttrsFromFashion(line.fashion),
    });
  }

  const isHackathon = skus.some((s) => /hackathon/i.test(s.title));
  const name = isHackathon
    ? "Mastercard Hackathon Shirts"
    : normalized.name ||
      (skus.length === 1
        ? storeNameFromTitle(skus[0].title)
        : "Borneo Store");

  return {
    ok: true,
    inventory: {
      name,
      slug: isHackathon
        ? "hackathon-shirts"
        : normalized.slug || slugify(name),
      skus,
    },
  };
}

/**
 * Resolve a turn: price follow-up, new inventory, or chat/clarify.
 * If a draft is pending and the user adds more products, append/merge.
 */
export function resolveMerchantTurn(args: {
  message: string;
  draft?: MerchantDraft | null;
}): InventoryParseResult {
  const message = cleanPrompt(args.message);
  const draft = normalizeDraft(args.draft);

  if (!message) {
    return draft
      ? {
          ok: false,
          missing: "price",
          draft,
          ask: priceAsk(draft),
        }
      : { ok: false, missing: "inventory", draft: null, ask: guideAsk() };
  }

  if (draft) {
    if (parsePriceOnly(message) && draft.lines.length === 1) {
      return completeDraftWithPrice(draft, message);
    }
    if (looksLikeGreetingOrChat(message)) {
      return {
        ok: false,
        missing: "price",
        draft,
        ask: priceAsk(draft),
      };
    }

    const parsed = parseMerchantPrompt(message);
    if (!parsed.ok) {
      if (parsed.missing === "price" || parsed.missing === "variants") {
        const merged = mergeDraftLines(draft, parsed.draft.lines);
        return {
          ok: false,
          missing: draftNeedsFashionVariants(merged.lines)
            ? "variants"
            : "price",
          draft: merged,
          ask: `Added to your sheet — ${parsed.ask}`,
        };
      }
      // Non-inventory clarify while draft open: keep draft, re-ask
      return {
        ok: false,
        missing: "price",
        draft,
        ask: priceAsk(draft),
      };
    }

    // Fully priced inventory from chat → merge into draft for confirm
    const incoming = parsed.inventory.skus.map((s) => ({
      quantity: s.quantity,
      title: s.title,
      name: s.title,
      description: s.description,
      price: s.price,
    }));
    const merged = mergeDraftLines(
      {
        ...draft,
        name: draft.name || parsed.inventory.name,
        slug: draft.slug || parsed.inventory.slug,
      },
      incoming,
    );
    return {
      ok: false,
      missing: draftNeedsFashionVariants(merged.lines) ? "variants" : "price",
      draft: merged,
      ask: `Added ${incoming.length} product(s) to your inventory sheet (${merged.lines.length} SKUs total). Confirm sizes, qty, and ${config.tokenSymbol} prices, then publish.`,
    };
  }

  return parseMerchantPrompt(message);
}

const FASHION_CSV_AXES: FashionAxis[] = [
  "color",
  "size",
  "fit",
  "waist",
  "inseam",
  "length",
  "width",
  "band",
  "cup",
  "material",
  "finish",
  "metal",
  "frameColor",
  "lensColor",
  "circumference",
  "pattern",
];

const SUBCATEGORY_ALIASES: Record<string, FashionSubcategory> = {
  tops: "tops",
  top: "tops",
  outerwear: "tops",
  bottoms: "bottoms",
  bottom: "bottoms",
  jeans: "bottoms",
  dresses: "dresses",
  dress: "dresses",
  jumpsuits: "dresses",
  footwear: "footwear",
  shoes: "footwear",
  sneakers: "footwear",
  intimates: "intimates",
  swimwear: "intimates",
  bags: "bags",
  bag: "bags",
  luggage: "bags",
  belts: "belts_slg",
  belts_slg: "belts_slg",
  slg: "belts_slg",
  wallet: "belts_slg",
  jewelry: "jewelry",
  eyewear: "eyewear",
  hats: "hats",
  hat: "hats",
  soft_accessories: "soft_accessories",
  accessories: "soft_accessories",
  scarf: "soft_accessories",
};

function fashionFromCsvRecord(
  record: Record<string, string>,
  title: string,
  description?: string,
): FashionMeta {
  const rawSub = String(
    record.subcategory || record.category || record.type || "",
  )
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const subcategory =
    SUBCATEGORY_ALIASES[rawSub] ||
    enrichFashionMeta(title, description).subcategory;

  const attrs: FashionMeta["attrs"] = {};
  for (const axis of FASHION_CSV_AXES) {
    const key = axis.toLowerCase();
    const alt =
      axis === "frameColor"
        ? record.framecolor || record.frame_color || record.frame
        : axis === "lensColor"
          ? record.lenscolor || record.lens_color || record.lens
          : record[key];
    const value = String(alt ?? "").trim();
    if (value) attrs[axis] = value;
  }

  const style = String(record.style || title).trim() || title;
  return enrichFashionMeta(title, description, {
    subcategory,
    style,
    attrs,
  });
}

export function parseCsv(csv: string): InventoryParseResult {
  const parsed = Papa.parse<Record<string, string>>(csv.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  // Headerless fallback: title,quantity,price
  if (
    parsed.meta.fields?.length === 1 ||
    !parsed.meta.fields?.some((f) =>
      /title|name|price|qty|quantity/.test(f),
    )
  ) {
    return parseCsvHeaderless(csv);
  }

  if (parsed.data.length === 0) {
    return parseMerchantPrompt("50 shirts for 50 XSGD");
  }

  const draftLines: MerchantDraftLine[] = [];
  let storeHint: string | undefined;

  for (const record of parsed.data) {
    const title = String(record.title || record.name || "").trim() || "Untitled";
    const description = String(record.description || "").trim() || undefined;
    const misaligned = Array.isArray(
      (record as { __parsed_extra?: unknown }).__parsed_extra,
    );
    const quantity = Number(
      String(record.quantity ?? record.qty ?? "").trim() || NaN,
    );
    const priceRaw = record.price || record.xsgd;
    const priceNum = Number(String(priceRaw ?? "").replace(/[^\d.]/g, ""));
    const qtyOk = !misaligned && Number.isFinite(quantity) && quantity > 0;
    const priceOk = !misaligned && Number.isFinite(priceNum) && priceNum > 0;
    const fashion = fashionFromCsvRecord(record, title, description);

    draftLines.push({
      quantity: qtyOk ? quantity : 1,
      title,
      name: title,
      description,
      price: priceOk ? priceNum.toFixed(2) : undefined,
      fashion,
    });

    if (record.store || record.store_name) {
      storeHint = String(record.store || record.store_name).trim();
    }
  }

  if (draftLines.length === 0) {
    return {
      ok: false,
      missing: "inventory",
      draft: null,
      ask: "That CSV had no products. Use columns title, description, quantity, price — plus optional subcategory, color, size, waist, inseam.",
    };
  }

  const draft = draftFromLines(draftLines, storeHint);

  if (draftNeedsFashionVariants(draft.lines)) {
    return {
      ok: false,
      missing: "variants",
      draft,
      ask:
        fashionCompletenessAsk(draft.lines) ||
        "Fill fashion details (size, color, etc.) in the inventory form.",
    };
  }

  const missingPrice = draft.lines.some(
    (l) => !l.price || !Number.isFinite(Number(l.price)) || Number(l.price) <= 0,
  );
  if (missingPrice) {
    return {
      ok: false,
      missing: "price",
      draft,
      ask: `${priceAsk(draft)} (CSV had missing or invalid prices — fill them below.)`,
    };
  }

  // Always open the edit form so sellers can confirm fashion attrs + prices
  return {
    ok: false,
    missing: "price",
    draft,
    ask: `Loaded ${draft.lines.length} fashion SKU(s) with sizes/attributes. Confirm details and ${config.tokenSymbol} prices below, then publish.`,
  };
}

function parseCsvHeaderless(csv: string): InventoryParseResult {
  const parsed = Papa.parse<string[]>(csv.trim(), {
    header: false,
    skipEmptyLines: true,
  });
  const skus: Omit<Sku, "id">[] = [];
  const missingLines: MerchantDraftLine[] = [];

  for (const cols of parsed.data) {
    if (!cols?.length) continue;
    // Skip accidental header row
    if (/^title$/i.test(String(cols[0])) && /price/i.test(String(cols[2] ?? cols[3] ?? ""))) {
      continue;
    }
    const title = String(cols[0] || "Untitled").trim();
    const quantity = Number(cols[1] || 1);
    const priceRaw = cols[2];
    const priceNum = Number(String(priceRaw ?? "").replace(/[^\d.]/g, ""));
    const qtyOk = Number.isFinite(quantity) && quantity > 0;
    const priceOk = Number.isFinite(priceNum) && priceNum > 0;
    if (!qtyOk || !priceOk) {
      missingLines.push({
        quantity: qtyOk ? quantity : 1,
        title,
        name: title,
      });
      continue;
    }
    skus.push({
      title,
      description: title,
      quantity,
      price: priceNum.toFixed(2),
    });
  }

  if (missingLines.length > 0) {
    const draft = draftFromLines(missingLines);
    return {
      ok: false,
      missing: "price",
      draft,
      ask: `${priceAsk(draft)} (CSV had missing or invalid prices — fill them below.)`,
    };
  }

  if (skus.length === 0) {
    return {
      ok: false,
      missing: "inventory",
      draft: null,
      ask: "That CSV had no products. Use title,quantity,price or a header row.",
    };
  }

  const name =
    skus.length === 1
      ? skus[0].title.replace(/\b\w/g, (c) => c.toUpperCase())
      : "Borneo Store";
  return { ok: true, inventory: { name, slug: slugify(name), skus } };
}

export function toStore(
  parsed: ParsedInventory,
  merchantAddress: string = config.merchantAddress,
  extras?: {
    ownerUid?: string;
    merchantDisplayName?: string;
    visaReceive?: StoreRecord["visaReceive"];
    listOnMarket?: boolean;
    acceptRlusd?: boolean;
    acceptXrp?: boolean;
    acceptVisa?: boolean;
    /** Force slug (e.g. re-publish after catalog miss). */
    slug?: string;
  },
): StoreRecord {
  return ensureUniqueSkuIds({
    slug: extras?.slug?.trim() || parsed.slug,
    name: parsed.name,
    ownerUid: extras?.ownerUid,
    merchantDisplayName: extras?.merchantDisplayName,
    merchantAddress,
    visaReceive: extras?.visaReceive,
    listOnMarket: extras?.listOnMarket !== false,
    acceptRlusd: extras?.acceptRlusd !== false,
    acceptXrp: extras?.acceptXrp !== false,
    acceptVisa: extras?.acceptVisa !== false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    skus: parsed.skus.map((sku, index) => {
      const quantity = Number(sku.quantity);
      const priceNum = Number(sku.price);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error(`Invalid quantity for ${sku.title}`);
      }
      if (!Number.isFinite(priceNum) || priceNum <= 0) {
        throw new Error(`Invalid price for ${sku.title}`);
      }
      const slug = extras?.slug?.trim() || parsed.slug;
      return {
        id:
          slug === "hackathon-shirts"
            ? "shirt"
            : slugify(sku.title) || `sku-${index + 1}`,
        title: sku.title,
        description: sku.description,
        quantity,
        price: priceNum.toFixed(2),
        attrs: sku.attrs,
      };
    }),
  });
}
