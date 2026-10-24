import { originFromRequest } from "@/lib/protocol/llms-txt";
import { repo } from "@/lib/store/repo";
import {
  didFor,
  verifierInfo,
  verifySellerOnLedger,
} from "@/lib/xrpl/seller-credential";
import { toSellerBadge } from "@/lib/xrpl/seller-verification-types";

export const runtime = "nodejs";

/**
 * Merchant-level DID document. The merchant's on-ledger DID (XLS-40) URI points
 * here, so the link "this XRPL account ↔ these Borneo storefronts" is asserted
 * by the merchant's own key, not by Borneo.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ address: string }> },
) {
  const { address } = await context.params;
  const origin = originFromRequest(request);
  const stores = (await repo.listStores()).filter(
    (s) => s.merchantAddress === address && s.listOnMarket !== false,
  );
  if (stores.length === 0) {
    return Response.json({ error: "no stores for this address" }, { status: 404 });
  }
  const verification = await verifySellerOnLedger(address);
  const id = didFor(address);

  return Response.json(
    {
      "@context": ["https://www.w3.org/ns/did/v1"],
      id,
      controller: id,
      alsoKnownAs: [`xrpl:${address}`],
      service: stores.map((store) => {
        const base = `${origin}/s/${store.slug}`;
        return {
          id: `${id}#${store.slug}`,
          type: "AgentStorefront",
          serviceEndpoint: {
            name: store.name,
            llmsTxt: `${base}/llms.txt`,
            agentCard: `${base}/agent.json`,
            catalog: `${base}/catalog.json`,
            payTo: store.merchantAddress,
          },
        };
      }),
      borneo: {
        sellerVerification: toSellerBadge(verification),
        verifier: verifierInfo(),
      },
    },
    { headers: { "cache-control": "public, max-age=30" } },
  );
}
