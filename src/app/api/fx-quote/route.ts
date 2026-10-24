import { Wallet } from "xrpl";
import { config } from "@/lib/config";
import { quoteXrpForRlusd } from "@/lib/protocol/cross-currency";

export const runtime = "nodejs";

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
 * GET /api/fx-quote?amount=12&to=rMerchant…
 * Quotes XRP needed to deliver `amount` RLUSD to merchant via AMM/DEX.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const amount = url.searchParams.get("amount")?.trim() || "";
  const to =
    url.searchParams.get("to")?.trim() ||
    config.merchantAddress.trim();
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
        "cache-control": "public, max-age=10, stale-while-revalidate=5",
      },
    },
  );
}
