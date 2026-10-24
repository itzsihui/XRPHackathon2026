import { originFromRequest } from "@/lib/protocol/llms-txt";
import { shortlistRegistrySlugs } from "@/lib/protocol/registry-index";
import { loadRegistryIndexForSearch } from "@/lib/protocol/registry-index-load";
import { flattenMarketProducts } from "@/lib/protocol/registry";
import { renderReviews } from "@/lib/protocol/reviews";
import {
  semanticSearchMarket,
  type ReviewSignal,
} from "@/lib/protocol/semantic-search";
import { repo } from "@/lib/store/repo";
import type { StoreRecord } from "@/lib/store/types";
import { verifierInfo, verifySellers } from "@/lib/xrpl/seller-credential";

export const runtime = "nodejs";

/**
 * Fashion-aware agent search.
 * 1) Shortlist stores via registry_index facets/titles
 * 2) Load those catalogs + review aggregates
 * 3) Keyword → embed → commerce re-rank (stock + verified reviews)
 *
 * GET /api/search?q=breathable+linen+shirt&limit=8
 * Optional: &subcategory=tops&color=navy&verified=1
 *
 * Hits include scoreBreakdown: { semantic, stock, reviews, trust, verified, injection, final }.
 * trust/verified come from the seller's XLS-70 credential read off the XRPL ledger.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const limitRaw = Number(url.searchParams.get("limit") || "8");
  const limit = Number.isFinite(limitRaw) ? limitRaw : 8;
  const subcategory = url.searchParams.get("subcategory")?.trim().toLowerCase();
  const color = url.searchParams.get("color")?.trim().toLowerCase();
  const verifiedOnly = url.searchParams.get("verified") === "1";

  const origin = originFromRequest(request);
  const queries = url.searchParams
    .getAll("q")
    .map((s) => s.trim())
    .filter(Boolean);
  const qList = queries.length ? queries : q ? [q] : [];
  if (qList.length === 0 && !subcategory && !color) {
    return Response.json(
      {
        error: "missing_query",
        hint: "GET /api/search?q=linen+shirt+for+humid+weather&subcategory=tops",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const index = await loadRegistryIndexForSearch(1000);
  let candidates = index;
  if (subcategory) {
    candidates = candidates.filter((e) =>
      e.subcategories.some((s) => s.toLowerCase() === subcategory),
    );
  }
  if (color) {
    candidates = candidates.filter((e) =>
      e.colors.some((c) => c.toLowerCase().includes(color)),
    );
  }

  const queryText =
    qList.join(" · ") || [subcategory, color].filter(Boolean).join(" ");
  const slugs = shortlistRegistrySlugs(candidates, queryText || "fashion", 40);

  const stores: StoreRecord[] = [];
  for (const slug of slugs) {
    const store = await repo.getStore(slug);
    if (store && store.listOnMarket !== false) stores.push(store);
  }

  if (stores.length === 0) {
    const all = (await repo.listStores()).filter(
      (s) => s.listOnMarket !== false,
    );
    stores.push(...all.slice(0, 40));
  }

  const reviewMap = new Map<string, ReviewSignal>();
  await Promise.all(
    stores.map(async (store) => {
      const reviews = await repo.listReviews(store.slug);
      const agg = renderReviews(store.slug, reviews).aggregate.bySku;
      for (const [skuId, v] of Object.entries(agg)) {
        reviewMap.set(`${store.slug}:${skuId}`, { avg: v.avg, n: v.n });
      }
    }),
  );

  const verification = await verifySellers(
    stores.map((s) => s.merchantAddress),
  );
  const allProducts = flattenMarketProducts(stores, verification);
  const products = verifiedOnly
    ? allProducts.filter((p) => p.sellerVerification?.onLedger)
    : allProducts;
  const result = await semanticSearchMarket({
    products,
    query: queryText,
    queries: qList.length ? qList : [queryText],
    origin,
    limit,
    embedCap: 200,
    reviews: reviewMap,
  });

  return Response.json(
    {
      protocol: "borneo-agentic-storefront",
      vertical: "fashion",
      ranking: {
        relevance: "semantic_or_keyword",
        stock: "out_of_stock_demoted",
        reviews: "verified_purchase_wilson_boost",
        trust: "xrpl_seller_credential_boost_unverified_demoted",
        injection: "quarantine_flagged_demoted",
      },
      sellerVerification: verifierInfo(),
      ...result,
      storeCount: stores.length,
      indexStoreCount: index.length,
      shortlistedStores: slugs,
      filters: {
        subcategory: subcategory || null,
        color: color || null,
        verifiedOnly,
      },
      endpoints: {
        registry: `${origin}/registry.json`,
        agentSitemap: `${origin}/agent-sitemap.json`,
        market: `${origin}/api/market`,
        search: `${origin}/api/search`,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
