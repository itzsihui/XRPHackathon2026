import { storePayTo } from "@/lib/config";
import { enrichFashionMeta } from "@/lib/inventory/fashion";
import type { StoreRecord } from "@/lib/store/types";

const SAMPLE_TITLE_CAP = 12;
const FACET_CAP = 20;

/** Slim Firestore doc for paginated / filtered registry discovery. */
export type RegistryIndexEntry = {
  slug: string;
  name: string;
  listOnMarket: boolean;
  ownerUid?: string;
  merchantDisplayName?: string;
  merchantAddress: string;
  skuCount: number;
  inStockCount: number;
  priceMin: number;
  priceMax: number;
  /** Fashion subcategories present in this store. */
  subcategories: string[];
  colors: string[];
  sizes: string[];
  materials: string[];
  /** First N SKU titles for keyword shortlist. */
  sampleTitles: string[];
  /** Verified-purchase aggregate (native Borneo reviews). */
  ratingAvg: number | null;
  ratingCount: number;
  updatedAt: string;
  createdAt: string;
};

export type RegistryIndexPage = {
  entries: RegistryIndexEntry[];
  nextCursor: string | null;
  /** Best-effort total listed; may be null when unknown. */
  totalHint: number | null;
};

function uniqCap(values: string[], cap: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const v = raw.trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= cap) break;
  }
  return out;
}

/** Build a fashion-aware registry index row from a full store catalog. */
export function buildRegistryIndexEntry(
  store: StoreRecord,
  reviewAgg?: { ratingAvg: number | null; ratingCount: number },
): RegistryIndexEntry {
  const prices = store.skus
    .map((s) => Number(s.price))
    .filter((n) => Number.isFinite(n) && n > 0);
  const subcategories: string[] = [];
  const colors: string[] = [];
  const sizes: string[] = [];
  const materials: string[] = [];

  for (const sku of store.skus) {
    if (sku.attrs?.subcategory) subcategories.push(sku.attrs.subcategory);
    if (sku.attrs?.color) colors.push(sku.attrs.color);
    if (sku.attrs?.size) sizes.push(sku.attrs.size);
    if (sku.attrs?.material) materials.push(sku.attrs.material);
    // Fallback: infer from title when attrs missing (legacy / sample SKUs)
    if (!sku.attrs?.subcategory) {
      const fashion = enrichFashionMeta(sku.title, sku.description);
      if (fashion.subcategory) subcategories.push(fashion.subcategory);
      const attrs = fashion.attrs ?? {};
      if (attrs.color) colors.push(attrs.color);
      if (attrs.frameColor) colors.push(attrs.frameColor);
      if (attrs.size) sizes.push(attrs.size);
      if (attrs.waist && attrs.inseam) {
        sizes.push(`${attrs.waist}x${attrs.inseam}`);
      } else if (attrs.waist) {
        sizes.push(attrs.waist);
      }
      if (attrs.material) materials.push(attrs.material);
      if (attrs.metal) materials.push(attrs.metal);
    }
  }

  const now = new Date().toISOString();
  return {
    slug: store.slug,
    name: store.name,
    listOnMarket: store.listOnMarket !== false,
    ownerUid: store.ownerUid,
    merchantDisplayName: store.merchantDisplayName,
    merchantAddress: storePayTo(store),
    skuCount: store.skus.length,
    inStockCount: store.skus.filter((s) => s.quantity > 0).length,
    priceMin: prices.length ? Math.min(...prices) : 0,
    priceMax: prices.length ? Math.max(...prices) : 0,
    subcategories: uniqCap(subcategories, FACET_CAP),
    colors: uniqCap(colors, FACET_CAP),
    sizes: uniqCap(sizes, FACET_CAP),
    materials: uniqCap(materials, FACET_CAP),
    sampleTitles: store.skus.slice(0, SAMPLE_TITLE_CAP).map((s) => s.title),
    ratingAvg: reviewAgg?.ratingAvg ?? null,
    ratingCount: reviewAgg?.ratingCount ?? 0,
    updatedAt: store.updatedAt || now,
    createdAt: store.createdAt || now,
  };
}

export function normalizeRegistryIndexEntry(
  raw: unknown,
): RegistryIndexEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const slug = String(d.slug || "").trim();
  const name = String(d.name || "").trim();
  const merchantAddress = String(d.merchantAddress || "").trim();
  if (!slug || !name || !merchantAddress) return null;
  const asStringArray = (v: unknown) =>
    Array.isArray(v)
      ? v.map((x) => String(x || "").trim()).filter(Boolean)
      : [];
  return {
    slug,
    name,
    listOnMarket: d.listOnMarket !== false,
    ownerUid: d.ownerUid ? String(d.ownerUid) : undefined,
    merchantDisplayName: d.merchantDisplayName
      ? String(d.merchantDisplayName)
      : undefined,
    merchantAddress,
    skuCount: Number(d.skuCount) || 0,
    inStockCount: Number(d.inStockCount) || 0,
    priceMin: Number(d.priceMin) || 0,
    priceMax: Number(d.priceMax) || 0,
    subcategories: asStringArray(d.subcategories),
    colors: asStringArray(d.colors),
    sizes: asStringArray(d.sizes),
    materials: asStringArray(d.materials),
    sampleTitles: asStringArray(d.sampleTitles),
    ratingAvg:
      d.ratingAvg != null && Number.isFinite(Number(d.ratingAvg))
        ? Number(d.ratingAvg)
        : null,
    ratingCount: Number(d.ratingCount) || 0,
    updatedAt: String(d.updatedAt || new Date().toISOString()),
    createdAt: String(d.createdAt || new Date().toISOString()),
  };
}

/** Keyword score an index entry for search shortlist (higher = better). */
export function scoreRegistryIndexEntry(
  entry: RegistryIndexEntry,
  query: string,
): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const tokens = q.split(/\s+/).filter((t) => t.length > 1);
  const hay = [
    entry.name,
    entry.slug,
    ...entry.sampleTitles,
    ...entry.subcategories,
    ...entry.colors,
    ...entry.sizes,
    ...entry.materials,
  ]
    .join(" ")
    .toLowerCase();

  let score = 0;
  if (hay.includes(q)) score += 5;
  for (const t of tokens) {
    if (hay.includes(t)) score += 1;
    if (entry.subcategories.some((s) => s.toLowerCase() === t)) score += 2;
    if (entry.colors.some((c) => c.toLowerCase() === t)) score += 1.5;
  }
  return score;
}

/**
 * Shortlist store slugs from the fashion registry index before loading full catalogs.
 */
export function shortlistRegistrySlugs(
  entries: RegistryIndexEntry[],
  query: string,
  limit = 40,
): string[] {
  const listed = entries.filter((e) => e.listOnMarket);
  if (!query.trim()) {
    return listed.slice(0, limit).map((e) => e.slug);
  }
  return listed
    .map((e) => ({ slug: e.slug, score: scoreRegistryIndexEntry(e, query) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.slug);
}
