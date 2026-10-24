import { imageForProduct } from "@/lib/market/product-images";
import type { BuyerSizingPrefs } from "@/lib/buyer-account";
import type { FashionProfile, MarketProductPick } from "./buyer-flow";
import {
  formatFlagSummary,
  quarantineCatalog,
  wantsInjectionDemo,
  type QuarantinedSku,
} from "./catalog-quarantine";
import { decomposeIntent } from "./intent-decompose";

/** Product shape from GET /api/search (market catalog + rank score). */
type SearchApiProduct = {
  id: string;
  title: string;
  description?: string;
  price: string;
  quantity: number;
  storeSlug: string;
  storeName: string;
  merchantDisplayName?: string;
  merchantAddress?: string;
  visaReceiveLabel?: string;
  visaReceiveId?: string;
  imageUrl?: string;
  acceptRlusd?: boolean;
  acceptXrp?: boolean;
  acceptVisa?: boolean;
  score: number;
};

type SearchPayload = {
  products?: SearchApiProduct[];
};

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/t-shirt/g, "tshirt")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseBudgetMax(profile?: FashionProfile | null): number | null {
  if (!profile?.budget) return null;
  const m = profile.budget.match(/([\d.]+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function rankTitle(product: SearchApiProduct, q: QuarantinedSku): string {
  return q.safeForFashionRank
    ? product.title
    : `${product.id} ${q.displayTitle}`;
}

function toPick(
  product: SearchApiProduct,
  q: QuarantinedSku,
  score: number,
): MarketProductPick {
  return {
    id: `${product.storeSlug}:${product.id}`,
    title: product.title,
    description: product.description,
    price: product.price,
    quantity: product.quantity,
    storeSlug: product.storeSlug,
    storeName: product.storeName,
    merchantDisplayName: product.merchantDisplayName,
    // Stale catalog rows may still carry the dead rHb9… payTo; settle uses env.
    merchantAddress:
      product.merchantAddress === "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh"
        ? undefined
        : product.merchantAddress,
    visaReceiveLabel: product.visaReceiveLabel,
    visaReceiveId: product.visaReceiveId,
    imageUrl:
      product.imageUrl ||
      imageForProduct(product.title, product.description, product.id),
    acceptRlusd: product.acceptRlusd !== false,
    acceptXrp: product.acceptXrp !== false,
    acceptVisa: product.acceptVisa !== false,
    score,
    injectionFlags: q.injectionFlags.length ? q.injectionFlags : undefined,
    quarantined: q.injectionFlags.length > 0,
  };
}

function considerPick(
  scored: Map<string, MarketProductPick>,
  flaggedSeen: Map<string, QuarantinedSku>,
  product: SearchApiProduct,
  q: QuarantinedSku,
  score: number,
  demoIntent: boolean,
) {
  if (score <= 0) return;
  const key = `${product.storeSlug}:${product.id}`;
  if (!q.safeForFashionRank) {
    flaggedSeen.set(key, q);
    if (!demoIntent) return;
  }
  const pick = toPick(product, q, score);
  const existing = scored.get(pick.id);
  if (!existing || pick.score > existing.score) scored.set(pick.id, pick);
}

async function fetchSearchHits(
  queries: string[],
  limit: number,
): Promise<SearchApiProduct[]> {
  const params = new URLSearchParams({
    limit: String(limit),
  });
  for (const q of queries) {
    if (q.trim()) params.append("q", q.trim());
  }
  const res = await fetch(`/api/search?${params}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Market search failed (HTTP ${res.status})`);
  }
  const data = (await res.json()) as SearchPayload;
  return data.products ?? [];
}

/**
 * Discover apparel picks via the same GET /api/search agents use,
 * then apply buyer extras (exclude, budget, quarantine, sizing, outfit mix).
 */
export async function discoverFashionPicks(
  intent: string,
  profile?: FashionProfile | null,
  searchQueries?: string[],
  opts?: { excludeSkuIds?: string[]; sizing?: BuyerSizingPrefs | null },
): Promise<{
  picks: MarketProductPick[];
  flagged: QuarantinedSku[];
  decomposed: ReturnType<typeof decomposeIntent>;
  storeSlugs: string[];
  searchUrls: string[];
}> {
  const queries = (
    searchQueries?.length
      ? searchQueries
      : profile?.items?.length
        ? profile.items
        : [intent]
  )
    .map((q) => q.trim())
    .filter(Boolean);

  const primaryIntent = queries.join(" ") || intent;
  const preferredHints =
    profile?.items && profile.items.length > 0
      ? profile.items
      : searchQueries && searchQueries.length > 0
        ? searchQueries
        : undefined;
  const decomposed = decomposeIntent(primaryIntent, {
    itemHints: preferredHints,
    occasion: profile?.occasion,
    style: profile?.style,
  });

  const limitPerQuery = queries.length > 1 ? 10 : 12;
  const searchParams = new URLSearchParams({
    limit: String(limitPerQuery),
  });
  for (const q of queries) searchParams.append("q", q);
  const searchUrls = [`/api/search?${searchParams.toString()}`];

  // One request embeds all nouns in a single OpenAI round-trip
  const productsRaw = await fetchSearchHits(queries, limitPerQuery);
  let products = productsRaw;

  const exclude = new Set(
    (opts?.excludeSkuIds || []).map((id) => id.toLowerCase()),
  );
  if (exclude.size) {
    products = products.filter(
      (p) =>
        !exclude.has(p.id.toLowerCase()) &&
        !exclude.has(`${p.storeSlug}:${p.id}`.toLowerCase()),
    );
  }

  const budgetMax = parseBudgetMax(profile);
  if (budgetMax != null) {
    products = products.filter((p) => {
      const price = Number(p.price);
      return !Number.isFinite(price) || price <= budgetMax;
    });
  }

  const quarantined = quarantineCatalog(products);
  const qByKey = new Map<string, QuarantinedSku>();
  for (const q of quarantined) {
    qByKey.set(`${q.storeSlug}:${q.id}`, q);
  }

  const demoIntent = wantsInjectionDemo(intent, queries);
  const flaggedSeen = new Map<string, QuarantinedSku>();
  const scored = new Map<string, MarketProductPick>();
  const sizing = opts?.sizing;
  const huntingGarments = queries.some(isGarmentNounQuery);

  for (const product of products) {
    const key = `${product.storeSlug}:${product.id}`;
    const q = qByKey.get(key);
    if (!q) continue;
    const base = Math.max(1, Math.round(product.score * 100));
    const total =
      base +
      sizingBoost(product, q, sizing) +
      occasionFitDelta(product, q, profile) +
      garmentQueryFitDelta(product, q, queries);
    considerPick(scored, flaggedSeen, product, q, total, demoIntent);
  }

  for (const q of quarantined) {
    if (q.injectionFlags.length) {
      flaggedSeen.set(`${q.storeSlug}:${q.id}`, q);
    }
  }

  let picks = [...scored.values()].sort((a, b) => b.score - a.score);

  // Outfit / shirt+pants hunts: drop accessories that snuck through
  if (huntingGarments) {
    picks = picks.filter((p) => {
      const role = apparelRole(p.title);
      if (role === "top" || role === "bottom" || role === "outer") return true;
      const hay = normalize(`${p.id} ${p.title} ${p.description || ""}`);
      return queries.some((gq) => {
        const n = normalize(gq);
        return n.length >= 3 && hay.includes(n);
      });
    });
  }

  const limit = queries.length > 1 ? 6 : 5;
  const outfitFirst = diversifyOutfitPicks(picks, queries, qByKey);
  picks = (
    queries.length > 1 ? outfitFirst : diversifyByStore(outfitFirst, limit)
  ).slice(0, limit);

  const flagged = [...flaggedSeen.values()];
  const storeSlugs = [
    ...new Set([
      ...picks.map((p) => p.storeSlug),
      ...flagged.map((f) => f.storeSlug),
    ]),
  ];

  return { picks, flagged, decomposed, storeSlugs, searchUrls };
}

function apparelRole(title: string): "top" | "bottom" | "outer" | "other" {
  const t = normalize(title);
  if (/\b(jeans?|pants?|trousers?|shorts?|skirts?|chinos?)\b/.test(t)) {
    return "bottom";
  }
  if (/\b(coats?|blazers?|jackets?|overcoat)\b/.test(t)) return "outer";
  if (
    /\b(shirts?|tees?|tshirts?|blouses?|tops?|crews?|sweaters?|hoodies?)\b/.test(
      t,
    )
  ) {
    return "top";
  }
  return "other";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-token size match in normalized haystack (titles often `… / M` or `30x32`). */
function sizeTokenInHay(hay: string, token: string): boolean {
  const t = token.trim().toLowerCase();
  if (!t) return false;
  if (t.includes("x")) {
    return hay.includes(t) || hay.includes(t.replace(/x/g, " x "));
  }
  return new RegExp(
    `(?:^|[^a-z0-9])${escapeRegExp(t)}(?:[^a-z0-9]|$)`,
  ).test(hay);
}

function garmentKind(title: string): "top" | "bottom" | "shoe" | "other" {
  const t = normalize(title);
  if (/\b(shoes?|sneakers?|runners?|hikers?|trainers?|boots?|loafers?)\b/.test(t)) {
    return "shoe";
  }
  const role = apparelRole(title);
  if (role === "top" || role === "bottom") return role;
  return "other";
}

/** Soft boost when listing size matches buyer prefs — never filters out misses. */
function sizingBoost(
  product: SearchApiProduct,
  q: QuarantinedSku,
  sizing?: BuyerSizingPrefs | null,
): number {
  if (!sizing) return 0;
  const title = rankTitle(product, q);
  const hay = normalize(`${product.id} ${title} ${product.description || ""}`);
  const kind = garmentKind(title);
  let bonus = 0;

  if (sizing.tops && sizeTokenInHay(hay, sizing.tops.toLowerCase())) {
    if (kind === "top") bonus += 35;
    else if (/\b(shirt|tee|tshirt|blouse|top|crew|sweater|hoodie)\b/.test(hay)) {
      bonus += 35;
    }
  }
  if (sizing.bottoms && sizeTokenInHay(hay, sizing.bottoms)) {
    if (kind === "bottom") bonus += 35;
    else if (/\b(jean|pant|trouser|chino|short|skirt)\b/.test(hay)) {
      bonus += 35;
    }
  }
  if (sizing.shoes && kind === "shoe" && sizeTokenInHay(hay, sizing.shoes)) {
    bonus += 35;
  }
  return bonus;
}

function isProfessionalOccasion(profile?: FashionProfile | null): boolean {
  const occasion = (profile?.occasion || "").toLowerCase();
  const style = (profile?.style || "").toLowerCase();
  if (
    /\b(hackathon|party|date)\b/.test(occasion) ||
    /\b(hackathon|party|date)\b/.test(style)
  ) {
    return false;
  }
  return (
    occasion === "work" ||
    style === "professional" ||
    /\b(present|interview|office|meeting|formal|work|gala)\b/.test(occasion) ||
    /\b(present|interview|office|meeting|formal)\b/.test(style)
  );
}

function isSocialOccasion(profile?: FashionProfile | null): boolean {
  const occasion = (profile?.occasion || "").toLowerCase();
  const style = (profile?.style || "").toLowerCase();
  return (
    occasion === "date" ||
    occasion === "party" ||
    style === "date" ||
    style === "party" ||
    /\b(date|party|dinner|club|night)\b/.test(occasion)
  );
}

function isHackathonOccasion(profile?: FashionProfile | null): boolean {
  const occasion = (profile?.occasion || "").toLowerCase();
  const style = (profile?.style || "").toLowerCase();
  return (
    occasion === "hackathon" ||
    style === "hackathon" ||
    /\bhackathon\b/.test(occasion)
  );
}

/** Occasion fit — formal vs party vs hackathon must surface different SKUs. */
function occasionFitDelta(
  product: SearchApiProduct,
  q: QuarantinedSku,
  profile?: FashionProfile | null,
): number {
  if (!profile?.occasion && !profile?.style) return 0;
  const title = rankTitle(product, q);
  const hay = normalize(`${product.id} ${title} ${product.description || ""}`);

  if (isHackathonOccasion(profile)) {
    if (/\b(poison|lanyard)\b/.test(hay)) return -1000;
    let d = 0;
    if (
      /\b(poplin|shirt\s*dress|ballet\s*flat|pointed|mary\s*jane|gala)\b/.test(
        hay,
      )
    ) {
      d -= 40;
    }
    if (
      /\b(hackathon|tee|tshirt|oversized|camp\s*shirt|treeblend)\b/.test(hay)
    ) {
      d += 55;
    }
    if (/\b(crop|palm|jogger)\b/.test(hay)) d += 25;
    if (/\bdress\b/.test(hay) && !/\btee\b/.test(hay)) d -= 25;
    return d;
  }

  if (isProfessionalOccasion(profile)) {
    if (
      /\b(crop|tank|palm|graphic|sundress|resort|jogger|beach|rash|swim|hackathon|tee|tshirt|treeblend)\b/.test(
        hay,
      )
    ) {
      return -1000;
    }
    let d = 0;
    if (/\b(oversized|tropical|weekend heat|camp\s*collar)\b/.test(hay)) {
      d -= 25;
    }
    if (/\bshorts?\b/.test(hay) && !/\bshirt\b/.test(hay)) d -= 40;
    if (
      /\b(poplin|tailored|chino|linen\s*pant|wide\s*linen|henley|oxford|button)\b/.test(
        hay,
      )
    ) {
      d += 55;
    }
    if (/\b(shirt\s*dress)\b/.test(hay)) d += 35;
    if (/\b(camp\s*shirt|linen\s*camp)\b/.test(hay)) d += 8;
    if (/\b(pant|trouser|chino)\b/.test(hay)) d += 50;
    if (/\b(ballet\s*flat|pointed\s*flat|mary\s*jane)\b/.test(hay)) d += 20;
    return d;
  }

  if (isSocialOccasion(profile)) {
    let d = 0;
    if (
      /\b(rash|jogger|daypack|poison|lanyard|hackathon\s+shirt)\b/.test(hay)
    ) {
      d -= 35;
    }
    if (/\b(dress|camp\s*shirt|linen|silk|sandal|midi|crop|palm)\b/.test(hay)) {
      d += 28;
    }
    if (/\b(oversized|tee|treeblend)\b/.test(hay)) d += 18;
    if (/\b(poplin|tailored|ballet\s*flat)\b/.test(hay)) d -= 8;
    return d;
  }

  return 0;
}

function isGarmentNounQuery(q: string): boolean {
  return /\b(shirt|tee|t-?shirts?|tshirts?|pants?|jeans|blouse|dress|poplin|trousers?|chinos?|tops?|skirts?|shorts?|jackets?|blazers?|coats?|hoodie|sweater|henley|hackathon|oversized)\b/i.test(
    q,
  );
}

function isAccessoryHay(hay: string): boolean {
  return /\b(caps?|hats?|lanyards?|earrings?|anklets?|cuffs?|totes?|daypacks?|crossbody|shades|sunglasses|scar(?:f|ves)|bags?|backpacks?|wallets?)\b/.test(
    hay,
  );
}

/**
 * Shirt/pants hunts must not rank caps, lanyards, or jewelry just because
 * embeddings drifted toward "presentation" / "professional".
 */
function garmentQueryFitDelta(
  product: SearchApiProduct,
  q: QuarantinedSku,
  queries: string[],
): number {
  const garmentQueries = queries.filter(isGarmentNounQuery);
  if (!garmentQueries.length) return 0;

  const title = rankTitle(product, q);
  const hay = normalize(`${product.id} ${title} ${product.description || ""}`);
  const role = apparelRole(title);

  if (isAccessoryHay(hay)) return -1000;

  let best = 0;
  for (const gq of garmentQueries) {
    const n = normalize(gq).replace(/tshirt/g, "tee");
    if (n === "pant" || n === "pants") {
      if (/\bpants?\b|\btrousers?\b|\bchinos?\b/.test(hay)) best = Math.max(best, 45);
    } else if (n === "poplin") {
      if (/\bpoplin\b/.test(hay)) best = Math.max(best, 55);
      else if (/\bshirt\b/.test(hay)) best = Math.max(best, 18);
    } else if (n === "jeans" || n === "jean") {
      if (/\bjeans?\b/.test(hay)) best = Math.max(best, 45);
    } else if (n === "shirt" || n === "blouse") {
      if (/\b(shirts?|blouses?)\b/.test(hay)) best = Math.max(best, 40);
    } else if (n === "tee" || n === "tees") {
      if (/\b(tee|tshirt)\b/.test(hay)) best = Math.max(best, 40);
    } else if (n.length >= 3 && hay.includes(n)) {
      best = Math.max(best, 35);
    }
  }

  if (best > 0) return best;

  // Apparel without a noun hit — mild keep; pure "other" — drop
  if (role === "top" || role === "bottom" || role === "outer") return -8;
  return -1000;
}

function diversifyOutfitPicks(
  picks: MarketProductPick[],
  queries: string[],
  qByKey: ReadonlyMap<string, QuarantinedSku>,
): MarketProductPick[] {
  const wantsBottom = queries.some((q) =>
    /\b(pant|jean|trouser|short|skirt|chino)\b/i.test(q),
  );
  const wantsTop = queries.some((q) =>
    /\b(shirt|tee|blouse|top)\b/i.test(q),
  );
  if (!wantsBottom && !wantsTop) return picks;
  if (picks.length <= 1) return picks;

  const roleOf = (p: MarketProductPick) => {
    const q = qByKey.get(p.id);
    const title =
      q && !q.safeForFashionRank ? q.displayTitle : p.title;
    return apparelRole(title);
  };

  const tops = picks.filter((p) => roleOf(p) === "top");
  const bottoms = picks.filter((p) => roleOf(p) === "bottom");
  const outers = picks.filter((p) => roleOf(p) === "outer");
  const others = picks.filter((p) => roleOf(p) === "other");

  const out: MarketProductPick[] = [];
  const push = (p?: MarketProductPick) => {
    if (!p) return;
    if (out.some((x) => x.id === p.id)) return;
    out.push(p);
  };

  if (wantsTop) push(tops[0]);
  if (wantsBottom) push(bottoms[0] || outers[0]);
  if (out.length < 2) {
    push(outers[0]);
    push(tops[1]);
    push(bottoms[1]);
  }

  for (const pool of [tops, bottoms, outers, others, picks]) {
    for (const pick of pool) {
      push(pick);
      if (out.length >= 6) return out;
    }
  }
  return out;
}

function diversifyByStore(
  picks: MarketProductPick[],
  limit: number,
): MarketProductPick[] {
  if (picks.length <= 2) return picks;
  const out: MarketProductPick[] = [];
  const seenStores = new Set<string>();
  for (const pick of picks) {
    if (seenStores.has(pick.storeSlug)) continue;
    out.push(pick);
    seenStores.add(pick.storeSlug);
    if (out.length >= limit) return out;
  }
  for (const pick of picks) {
    if (out.some((p) => p.id === pick.id)) continue;
    out.push(pick);
    if (out.length >= limit) break;
  }
  return out;
}

export { formatFlagSummary };
