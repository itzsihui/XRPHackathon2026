import { config } from "@/lib/config";
import { imageForProduct } from "@/lib/market/product-images";
import type { StoreRecord } from "@/lib/store/types";
import {
  toSellerBadge,
  type SellerBadge,
  type SellerVerification,
} from "@/lib/xrpl/seller-verification-types";

const TITLE_CAP = 8;

export type RegistrySku = {
  id: string;
  title: string;
  price: string;
  quantity: number;
};

export type RegistryStore = {
  slug: string;
  name: string;
  llmsTxt: string;
  agentCard: string;
  catalog: string;
  reviews: string;
  buyX402: string;
  checkoutStraitsX: string;
  skuCount: number;
  skus: RegistrySku[];
};

export type MarketProduct = {
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
  imageUrl: string;
  attrs?: import("@/lib/store/types").SkuAttrs;
  /** Borneo verified-seller credential on the payTo address (XLS-70). */
  sellerVerification?: SellerBadge;
};

export function buildRegistryStores(
  stores: StoreRecord[],
  origin: string,
): RegistryStore[] {
  return [...stores]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((store) => {
      const base = `${origin}/s/${store.slug}`;
      return {
        slug: store.slug,
        name: store.name,
        llmsTxt: `${base}/llms.txt`,
        agentCard: `${base}/agent.json`,
        catalog: `${base}/catalog.json`,
        reviews: `${base}/reviews.json`,
        buyX402: `${base}/buy`,
        checkoutStraitsX: `${base}/checkout`,
        skuCount: store.skus.length,
        skus: store.skus.slice(0, TITLE_CAP).map((sku) => ({
          id: sku.id,
          title: sku.title,
          price: sku.price,
          quantity: sku.quantity,
        })),
      };
    });
}

export function renderRegistryJson(
  stores: StoreRecord[],
  origin: string,
  extras?: {
    nextCursor?: string | null;
    limit?: number;
    indexed?: boolean;
    facets?: boolean;
  },
) {
  const listed = buildRegistryStores(stores, origin);
  return {
    protocol: "borneo-agentic-storefront",
    version: "1.1",
    description:
      "Borneo fashion-focused network registry. Agents: start here, then open each store llms.txt. Do not scrape HTML. Use ?cursor=&limit= for pagination.",
    currency: config.tokenSymbol,
    vertical: "fashion",
    market: `${origin}/market`,
    endpoints: {
      llmsTxt: `${origin}/llms.txt`,
      registry: `${origin}/registry.json`,
      search: `${origin}/api/search`,
      marketApi: `${origin}/api/market`,
    },
    pagination: {
      limit: extras?.limit ?? listed.length,
      nextCursor: extras?.nextCursor ?? null,
      indexed: extras?.indexed ?? false,
    },
    storeCount: listed.length,
    stores: listed,
  };
}

/** Registry page from slim index entries (full SKU lists still on catalog.json). */
export function renderRegistryJsonFromIndex(
  entries: import("@/lib/protocol/registry-index").RegistryIndexEntry[],
  origin: string,
  extras: {
    nextCursor: string | null;
    limit: number;
    totalHint?: number | null;
    /** payTo address → on-ledger verification. */
    verification?: Map<string, SellerVerification>;
    /** Verifier block (issuer, credential type, how to check yourself). */
    verifier?: unknown;
    /** Only return stores whose seller is verified on the ledger. */
    verifiedOnly?: boolean;
  },
) {
  const rows = extras.verifiedOnly
    ? entries.filter(
        (e) => extras.verification?.get(e.merchantAddress)?.onLedger === true,
      )
    : entries;
  const stores = rows.map((e) => {
    const base = `${origin}/s/${e.slug}`;
    const v = extras.verification?.get(e.merchantAddress);
    return {
      slug: e.slug,
      name: e.name,
      llmsTxt: `${base}/llms.txt`,
      agentCard: `${base}/agent.json`,
      catalog: `${base}/catalog.json`,
      reviews: `${base}/reviews.json`,
      buyX402: `${base}/buy`,
      checkoutStraitsX: `${base}/checkout`,
      skuCount: e.skuCount,
      inStockCount: e.inStockCount,
      priceMin: e.priceMin,
      priceMax: e.priceMax,
      updatedAt: e.updatedAt,
      catalogComplete: false as const,
      payTo: e.merchantAddress,
      sellerVerification: v ? toSellerBadge(v) : null,
      ratingAvg: e.ratingAvg,
      ratingCount: e.ratingCount,
      fashion: {
        subcategories: e.subcategories,
        colors: e.colors,
        sizes: e.sizes,
        materials: e.materials,
      },
      skus: e.sampleTitles.slice(0, TITLE_CAP).map((title, i) => ({
        id: `sample-${i + 1}`,
        title,
        price: String(e.priceMin || "0"),
        quantity: 0,
      })),
    };
  });
  return {
    protocol: "borneo-agentic-storefront",
    version: "1.2",
    description:
      "Borneo fashion registry index. Sample SKUs only (catalogComplete:false) — always GET catalog.json for full inventory. Prefer /api/search for intent. Paginate with ?cursor=&limit=. Crawl map: /agent-sitemap.json. sellerVerification is read from the XRPL ledger (XLS-70 credential on payTo) — re-check it yourself via the verifier block; ?verified=1 keeps only verified sellers (filters within the page).",
    currency: config.tokenSymbol,
    vertical: "fashion",
    market: `${origin}/market`,
    endpoints: {
      llmsTxt: `${origin}/llms.txt`,
      registry: `${origin}/registry.json`,
      search: `${origin}/api/search`,
      marketApi: `${origin}/api/market`,
      agentSitemap: `${origin}/agent-sitemap.json`,
    },
    pagination: {
      limit: extras.limit,
      nextCursor: extras.nextCursor,
      totalHint: extras.totalHint ?? null,
      indexed: true,
    },
    filters: { verifiedOnly: extras.verifiedOnly === true },
    sellerVerification: extras.verifier ?? null,
    storeCount: stores.length,
    stores,
  };
}

export function renderRootLlmsTxt(stores: StoreRecord[], origin: string) {
  const listed = buildRegistryStores(stores, origin);
  const lines: string[] = [
    `# Borneo — agent storefront network`,
    ``,
    `> Generative discovery for agents on the Agentic Storefront Protocol.`,
    `> Humans browse ${origin}/market. Agents read this file and ${origin}/registry.json.`,
    `> Do not scrape HTML. Do not invent checkout pages.`,
    ``,
    `## How to buy`,
    `1. Prefer intent search: GET ${origin}/api/search?q=your+need (ranked by relevance + stock + reviews + on-ledger seller verification; add &verified=1 to require it).`,
    `2. Or crawl ${origin}/agent-sitemap.json / scan ${origin}/registry.json.`,
    `3. GET that store's llms.txt and catalog.json (full SKUs — registry samples are incomplete).`,
    `4. POST /buy (expect HTTP 402) or StraitsX /checkout.`,
    ``,
    `## Network index (${listed.length} store${listed.length === 1 ? "" : "s"})`,
    ``,
  ];

  if (listed.length === 0) {
    lines.push(`(empty — merchants publish via ${origin}/onboard)`);
  } else {
    for (const store of listed) {
      const titles = store.skus.map((s) => s.title).join("; ");
      lines.push(`### ${store.name}`);
      lines.push(`- Slug: ${store.slug}`);
      lines.push(`- Instructions: ${store.llmsTxt}`);
      lines.push(`- Catalog: ${store.catalog}`);
      lines.push(`- Agent card: ${store.agentCard}`);
      lines.push(
        `- SKUs (${store.skuCount}): ${titles || "(none)"}${store.skuCount > TITLE_CAP ? "…" : ""}`,
      );
      lines.push(``);
    }
  }

  lines.push(`## Machine index`);
  lines.push(`- JSON registry: ${origin}/registry.json`);
  lines.push(`- Agent sitemap: ${origin}/agent-sitemap.json`);
  lines.push(`- Semantic search: ${origin}/api/search?q=`);
  lines.push(`- Keyword market API: ${origin}/api/market?q=`);
  lines.push(`- Human marketplace: ${origin}/market`);
  lines.push(``);
  lines.push(`## Verified sellers (XRPL)`);
  lines.push(
    `- Borneo issues an XLS-70 credential "BorneoVerifiedSeller" to each vetted merchant payTo address; the merchant accepts it and sets an XLS-40 DID pointing at ${origin}/sellers/{payTo}/did.json.`,
  );
  lines.push(
    `- Do not trust this file for it: verify on any XRPL node. Issuer + exact ledger_entry request: ${origin}/api/seller-verification`,
  );
  lines.push(``);
  lines.push(`## Currency`);
  lines.push(`- Token: ${config.tokenSymbol}`);
  lines.push(`- Network docs live on each store llms.txt`);
  lines.push(``);

  return lines.join("\n");
}

export function flattenMarketProducts(
  stores: StoreRecord[],
  verification?: Map<string, SellerVerification>,
): MarketProduct[] {
  const products: MarketProduct[] = [];
  for (const store of stores) {
    const v = verification?.get(store.merchantAddress);
    const sellerVerification = v ? toSellerBadge(v) : undefined;
    for (const sku of store.skus) {
      products.push({
        id: sku.id,
        title: sku.title,
        description: sku.description,
        price: sku.price,
        quantity: sku.quantity,
        storeSlug: store.slug,
        storeName: store.name,
        merchantDisplayName: store.merchantDisplayName,
        merchantAddress: store.merchantAddress,
        visaReceiveLabel: store.visaReceive?.accountLabel,
        visaReceiveId: store.visaReceive?.receiveId,
        imageUrl: imageForProduct(sku.title, sku.description, sku.id),
        attrs: sku.attrs,
        sellerVerification,
      });
    }
  }
  return products.sort((a, b) => a.title.localeCompare(b.title));
}

export function filterMarketProducts(
  products: MarketProduct[],
  query?: string | null,
): MarketProduct[] {
  const q = query?.trim().toLowerCase();
  if (!q) return products;
  const tokens = q.split(/\s+/).filter((t) => t.length > 1);
  return products.filter((p) => {
    const a = p.attrs;
    const hay = [
      p.title,
      p.description || "",
      p.id,
      a?.subcategory,
      a?.color,
      a?.size,
      a?.material,
      ...(a?.tags ?? []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (hay.includes(q)) return true;
    // Token overlap on product fields only — never match storeSlug
    // (e.g. q="shirt" must not pull every SKU from "hackathon-shirts").
    if (tokens.length === 0) return false;
    return tokens.some((t) => hay.includes(t));
  });
}
