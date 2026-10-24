import { storePayTo } from "@/lib/config";
import type { StoreRecord } from "@/lib/store/types";
import { repo } from "@/lib/store/repo";

function normalizeProductToken(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pull "earring" from "buy a earring" / "buy earrings from …". */
export function extractRequestedProduct(message?: string): string | null {
  if (!message?.trim()) return null;
  const cleaned = message.replace(/\/s\/[a-z0-9-]+/gi, " ").replace(/\s+/g, " ");
  const patterns = [
    /buy\s+(?:an?\s+|the\s+|one\s+|1\s+)?(.+?)(?:\s+from|\s+at|\s+in|\s+on|$)/i,
    /(?:want|get|purchase)\s+(?:an?\s+|the\s+|one\s+|1\s+)?(.+?)(?:\s+from|\s+at|\s+in|$)/i,
  ];
  for (const re of patterns) {
    const match = cleaned.match(re);
    if (!match?.[1]) continue;
    let product = normalizeProductToken(match[1]);
    product = product
      .replace(/\b(hackathon|item|product|sku|please)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!product || product.length < 2) continue;
    if (/^(something|anything|one|it|that|this)$/i.test(product)) return null;
    return product;
  }
  return null;
}

export function productMatchScore(
  requested: string,
  product: { id: string; title: string },
): number {
  const req = normalizeProductToken(requested);
  const title = normalizeProductToken(product.title);
  const id = normalizeProductToken(product.id);
  if (!req) return 0;
  if (title === req || id === req) return 100;
  const stem = (s: string) => s.replace(/s$/i, "");
  if (stem(title) === stem(req) || stem(id) === stem(req)) return 90;
  if (title.startsWith(req) || req.startsWith(title)) return 80;
  if (title.includes(req)) return 70;
  if (req.includes(title) && title.length >= 3) return 60;
  if (id.includes(req) || req.includes(id)) return 40;
  // token overlap
  const reqTokens = req.split(" ").filter((t) => t.length > 2);
  const titleTokens = new Set(title.split(" "));
  const hits = reqTokens.filter((t) => titleTokens.has(t) || stem(title).includes(t));
  if (hits.length > 0) return 30 + hits.length * 10;
  return 0;
}

export function productMatches(
  requested: string,
  product: { id: string; title: string },
): boolean {
  return productMatchScore(requested, product) >= 40;
}

export function extractSlugFromMessage(message?: string): string | null {
  if (!message?.trim()) return null;
  const fromPath = message.match(/\/s\/([a-z0-9-]+)/i)?.[1];
  if (fromPath) return fromPath.toLowerCase();
  const fromFrom = message.match(
    /(?:from|at)\s+\/?s?\/?([a-z0-9-]+)/i,
  )?.[1];
  if (fromFrom && fromFrom.length > 2) return fromFrom.toLowerCase();
  return null;
}

export type NetworkMatch = {
  store: StoreRecord;
  sku: { id: string; title: string; price: string };
  score: number;
};

/** Resolve slug + sku across the Borneo network when the buyer omits /s/{slug}. */
export async function resolveBuyerTarget(args: {
  slug?: string;
  message?: string;
  product?: string;
  /** Locked SKU id from the tapped quote — never fuzzy-match titles. */
  skuId?: string;
}): Promise<
  | {
      ok: true;
      slug: string;
      sku: { id: string; title: string; price: string };
      merchantAddress: string;
      via: "slug" | "registry" | "quote";
    }
  | {
      ok: false;
      reason: string;
      available?: string;
    }
> {
  const slugHint =
    args.slug?.trim() || extractSlugFromMessage(args.message) || null;
  const lockedSkuId = args.skuId?.trim() || null;
  const requested =
    lockedSkuId ||
    args.product?.trim() ||
    extractRequestedProduct(args.message) ||
    null;

  // CaMeL-shaped path: exact slug + skuId from the UI quote
  if (slugHint && lockedSkuId) {
    const store = await repo.getStore(slugHint);
    if (!store) {
      return { ok: false, reason: `Store /s/${slugHint} not found.` };
    }
    const sku = store.skus.find(
      (s) => s.id.toLowerCase() === lockedSkuId.toLowerCase(),
    );
    if (!sku) {
      return {
        ok: false,
        reason: `SKU ${lockedSkuId} does not exist in /s/${slugHint}.`,
        available: store.skus.map((s) => s.id).join(", "),
      };
    }
    return {
      ok: true,
      slug: store.slug,
      sku: { id: sku.id, title: sku.title, price: sku.price },
      merchantAddress: storePayTo(store),
      via: "quote",
    };
  }

  if (slugHint) {
    const store = await repo.getStore(slugHint);
    if (!store) {
      return { ok: false, reason: `Store /s/${slugHint} not found.` };
    }
    if (store.skus.length === 0) {
      return { ok: false, reason: `Store /s/${slugHint} has an empty catalog.` };
    }
    if (!requested) {
      const first = store.skus[0];
      return {
        ok: true,
        slug: store.slug,
        sku: { id: first.id, title: first.title, price: first.price },
        merchantAddress: storePayTo(store),
        via: "slug",
      };
    }
    let best = { sku: store.skus[0], score: 0 };
    for (const sku of store.skus) {
      const score = productMatchScore(requested, sku);
      if (score > best.score) best = { sku, score };
    }
    if (best.score < 40) {
      return {
        ok: false,
        reason: `"${requested}" does not exist in /s/${slugHint}.`,
        available: store.skus.map((s) => s.title).join(", "),
      };
    }
    return {
      ok: true,
      slug: store.slug,
      sku: { id: best.sku.id, title: best.sku.title, price: best.sku.price },
      merchantAddress: storePayTo(store),
      via: "slug",
    };
  }

  // No slug — search the network registry (in-process)
  const stores = (await repo.listStores()).filter(
    (s) => s.listOnMarket !== false,
  );
  if (stores.length === 0) {
    return {
      ok: false,
      reason: "Network registry is empty. Publish a store on /onboard first.",
    };
  }

  if (!requested) {
    // Default to first store's first sku (demo fallback)
    const store = stores[0];
    const first = store.skus[0];
    if (!first) {
      return { ok: false, reason: "No SKUs in the network registry." };
    }
    return {
      ok: true,
      slug: store.slug,
      sku: { id: first.id, title: first.title, price: first.price },
      merchantAddress: storePayTo(store),
      via: "registry",
    };
  }

  let best: NetworkMatch | null = null;
  for (const store of stores) {
    for (const sku of store.skus) {
      const score = productMatchScore(requested, sku);
      if (score < 40) continue;
      if (!best || score > best.score) {
        best = {
          store,
          sku: { id: sku.id, title: sku.title, price: sku.price },
          score,
        };
      }
    }
  }

  if (!best) {
    const sample = stores
      .flatMap((s) => s.skus.map((sku) => sku.title))
      .slice(0, 12)
      .join(", ");
    return {
      ok: false,
      reason: `No store sells "${requested}" on the Borneo network.`,
      available: sample || "(empty)",
    };
  }

  return {
    ok: true,
    slug: best.store.slug,
    sku: { id: best.sku.id, title: best.sku.title, price: best.sku.price },
    merchantAddress: storePayTo(best.store),
    via: "registry",
  };
}
