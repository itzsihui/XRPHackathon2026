import { storePayTo } from "@/lib/config";
import {
  filterMarketProducts,
  flattenMarketProducts,
} from "@/lib/protocol/registry";
import { repo } from "@/lib/store/repo";
import type { StoreRecord } from "@/lib/store/types";
import { verifySellers } from "@/lib/xrpl/seller-credential";

export const runtime = "nodejs";

/** Stores opted into marketplace discovery (default true). */
function marketStores(stores: StoreRecord[]) {
  return stores.filter((s) => s.listOnMarket !== false);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  const listed = marketStores(await repo.listStores());
  const payTos = listed.map((s) => storePayTo(s));
  const verification = await verifySellers(payTos);
  const products = filterMarketProducts(
    flattenMarketProducts(listed, verification),
    q,
  );
  return Response.json(
    {
      storeCount: listed.length,
      productCount: products.length,
      query: q || null,
      stores: listed.map((s) => {
        const payTo = storePayTo(s);
        return {
          slug: s.slug,
          name: s.name,
          skuCount: s.skus.length,
          merchantDisplayName: s.merchantDisplayName,
          merchantAddress: payTo,
          sellerVerified: verification.get(payTo)?.onLedger === true,
          visaReceive: s.visaReceive,
          listOnMarket: s.listOnMarket !== false,
        };
      }),
      products,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
