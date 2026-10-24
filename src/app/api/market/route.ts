import { storePayTo } from "@/lib/config";
import {
  filterMarketProducts,
  flattenMarketProducts,
} from "@/lib/protocol/registry";
import { repo } from "@/lib/store/repo";
import type { StoreRecord } from "@/lib/store/types";

export const runtime = "nodejs";

/** Stores opted into marketplace discovery (default true). */
function marketStores(stores: StoreRecord[]) {
  return stores.filter((s) => s.listOnMarket !== false);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  const listed = marketStores(await repo.listStores());
  const products = filterMarketProducts(flattenMarketProducts(listed), q);
  return Response.json(
    {
      storeCount: listed.length,
      productCount: products.length,
      query: q || null,
      stores: listed.map((s) => ({
        slug: s.slug,
        name: s.name,
        skuCount: s.skus.length,
        merchantDisplayName: s.merchantDisplayName,
        merchantAddress: storePayTo(s),
        visaReceive: s.visaReceive,
        listOnMarket: s.listOnMarket !== false,
      })),
      products,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
