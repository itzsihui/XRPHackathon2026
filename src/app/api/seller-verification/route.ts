import { scanCatalogProduct } from "@/app/buyer/_lib/catalog-quarantine";
import { emit } from "@/lib/protocol/events";
import { originFromRequest } from "@/lib/protocol/llms-txt";
import { repo } from "@/lib/store/repo";
import { verifyMerchantAuth, type MerchantAuthProof } from "@/lib/wallet/xrpl";
import {
  issueSellerCredential,
  prepareMerchantTxs,
  submitMerchantBlobs,
  verifierInfo,
  verifySellerOnLedger,
} from "@/lib/xrpl/seller-credential";

export const runtime = "nodejs";

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

/**
 * GET /api/seller-verification?address=r…   (or ?slug=store-slug)
 * Public: reads the Borneo seller credential + DID from the validated ledger.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  let address = url.searchParams.get("address")?.trim() || "";
  const slug = url.searchParams.get("slug")?.trim();
  if (!address && slug) {
    const store = await repo.getStore(slug);
    if (!store) return json({ error: "store not found" }, 404);
    address = store.merchantAddress;
  }
  if (!address) {
    return json({ verifier: verifierInfo(), hint: "?address=r… or ?slug=…" });
  }
  const verification = await verifySellerOnLedger(address, {
    fresh: url.searchParams.get("fresh") === "1",
  });
  return json({ verification, verifier: verifierInfo() });
}

type Body =
  | { action: "issue"; proof: MerchantAuthProof }
  | { action: "prepare"; address: string }
  | { action: "submit"; address: string; txBlobs: string[] };

/**
 * POST /api/seller-verification
 *  - issue:   { proof }               Borneo vets the merchant, submits CredentialCreate.
 *  - prepare: { address }             Autofilled CredentialAccept / DIDSet to sign client-side.
 *  - submit:  { address, txBlobs }    Relay the merchant-signed blobs (strictly validated).
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body?.action) return json({ error: "missing action" }, 400);
  const origin = originFromRequest(request);

  try {
    if (body.action === "issue") {
      const address = await verifyMerchantAuth(body.proof);
      if (!address) {
        return json({ error: "Wallet proof invalid or older than 24h" }, 401);
      }

      // Vetting: Borneo only vouches for live stores that pay this address
      // and whose listings pass the injection quarantine.
      const stores = (await repo.listStores()).filter(
        (s) => s.merchantAddress === address,
      );
      if (stores.length === 0) {
        return json(
          {
            error:
              "No published store pays out to this address yet. Publish inventory first, then verify.",
          },
          409,
        );
      }
      const flagged = stores.flatMap((store) =>
        store.skus
          .map((sku) =>
            scanCatalogProduct({
              id: sku.id,
              title: sku.title,
              description: sku.description,
              price: sku.price,
              storeSlug: store.slug,
            }),
          )
          .filter((q) => !q.safeForFashionRank),
      );
      if (flagged.length > 0) {
        return json(
          {
            error: "Listings contain injection-shaped copy — Borneo will not verify this seller.",
            flagged: flagged.map((f) => ({
              store: f.storeSlug,
              sku: f.id,
              flags: f.injectionFlags,
            })),
          },
          422,
        );
      }

      const result = await issueSellerCredential(address, origin);
      emit({
        status: 200,
        method: "POST",
        path: "/api/seller-verification",
        message: result.receipts.length
          ? `CredentialCreate → ${address} ${result.receipts.at(-1)?.hash}`
          : `credential already ${result.verification.status} for ${address}`,
      });
      return json({ ...result, stores: stores.map((s) => s.slug) });
    }

    if (body.action === "prepare") {
      return json(await prepareMerchantTxs(body.address, origin));
    }

    if (body.action === "submit") {
      const result = await submitMerchantBlobs(body.address, body.txBlobs);
      emit({
        status: 200,
        method: "POST",
        path: "/api/seller-verification",
        message: `${result.receipts.map((r) => r.type).join(" + ")} by ${body.address} → ${result.verification.status}`,
      });
      return json(result);
    }

    return json({ error: "unknown action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "verification failed";
    return json({ error: message }, 502);
  }
}
