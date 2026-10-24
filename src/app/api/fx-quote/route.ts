import { Wallet } from "xrpl";
import { config } from "@/lib/config";
import { quoteXrpForRlusd } from "@/lib/protocol/cross-currency";

export const runtime = "nodejs";

/** Legacy seed default that cannot hold RLUSD — never quote to this. */
const DEAD_PAYTO = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";

function buyerClassicAddress(): string | undefined {
  const seed = config.buyerSeed;
  if (!seed) return undefined;
  try {
    return Wallet.fromSeed(seed).classicAddress;
  } catch {
    return undefined;
  }
}

/**
 * Demo settle address: MERCHANT_ADDRESS always wins when set.
 * Ignores stale catalog / localStorage payTos (e.g. old rHb9… rows).
 */
function resolveQuoteDestination(requested: string | undefined): string {
  const shared = config.merchantAddress.trim();
  if (shared) return shared;
  const to = (requested || "").trim();
  if (to && to !== DEAD_PAYTO) return to;
  return "";
}

/**
 * GET /api/fx-quote?amount=12&to=rMerchant…
 * Quotes XRP needed to deliver `amount` RLUSD to merchant via AMM/DEX.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const amount = url.searchParams.get("amount")?.trim() || "";
  const to = resolveQuoteDestination(url.searchParams.get("to") || undefined);
  const from =
    url.searchParams.get("from")?.trim() ||
    buyerClassicAddress() ||
    undefined;

  if (!amount) {
    return Response.json(
      { ok: false, reason: "amount (RLUSD) required" },
      { status: 400 },
    );
  }

  if (!to) {
    return Response.json(
      {
        ok: false,
        reason: "MERCHANT_ADDRESS missing — set classic r… in .env.local",
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  }

  const quote = await quoteXrpForRlusd({
    deliverRlusd: amount,
    destination: to,
    sourceAccount: from,
  });

  if (!quote.ok) {
    return Response.json(quote, {
      status: 200,
      headers: { "cache-control": "no-store" },
    });
  }

  return Response.json(
    {
      ok: true,
      deliverRlusd: quote.deliverRlusd,
      destination: quote.destination,
      xrpDisplay: quote.xrpDisplay,
      sendMaxXrpDisplay: quote.sendMaxXrpDisplay,
      dropsToSend: quote.dropsToSend,
      sendMaxDrops: quote.sendMaxDrops,
      expiresAt: quote.expiresAt,
      tokenSymbol: config.tokenSymbol,
      quoteSource: quote.source,
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
