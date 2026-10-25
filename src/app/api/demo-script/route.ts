import { runBuyerAgent } from "@/lib/agents/buyer";
import { runCardAgent } from "@/lib/agents/card";
import { runMerchantAgent } from "@/lib/agents/merchant";
import { config } from "@/lib/config";

export const runtime = "nodejs";

/**
 * One-click AgentiX lifecycle for judges:
 * onboard → XRPL x402 → Mastercard rail.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    merchantMessage?: string;
    buyerMessage?: string;
    rails?: Array<"x402" | "card">;
  };
  const origin = config.protocolBaseUrl || new URL(request.url).origin;
  const rails = body.rails?.length ? body.rails : (["x402", "card"] as const);
  const merchantMessage =
    body.merchantMessage ||
    "Create a store. I'm selling 50 Mastercard Hackathon Shirts for 0.01 XSGD each.";
  const buyerMessage =
    body.buyerMessage ||
    "Agent, go to /s/hackathon-shirts and buy a hackathon shirt.";

  const log: Array<{ phase: string; text: string }> = [];

  log.push({ phase: "merchant", text: merchantMessage });
  const merchant = await runMerchantAgent({ message: merchantMessage });
  log.push({
    phase: "merchant",
    text: `${merchant.reply} [${merchant.llm}]`,
  });

  if (merchant.status !== "published" || !merchant.store) {
    return Response.json({
      ok: false,
      error: "Merchant did not publish — price or inventory incomplete",
      merchant,
      log,
    }, { status: 400 });
  }

  let x402: Awaited<ReturnType<typeof runBuyerAgent>> | undefined;
  let card: Awaited<ReturnType<typeof runCardAgent>> | undefined;

  if (rails.includes("x402")) {
    log.push({ phase: "x402", text: buyerMessage });
    x402 = await runBuyerAgent({ origin, message: buyerMessage });
    for (const step of x402.steps) {
      log.push({ phase: "x402", text: step.text });
    }
  }

  if (rails.includes("card")) {
    log.push({
      phase: "straitsx",
      text: "Issuing scoped Mastercard virtual card → /checkout → burn",
    });
    card = await runCardAgent({
      origin,
      message: buyerMessage,
      slug: merchant.store.slug,
    });
    for (const step of card.steps) {
      log.push({ phase: "straitsx", text: step.text });
    }
  }

  return Response.json({
    ok: true,
    pitch: {
      avalanche: "HTTP 402 → RLUSD on XRPL Testnet → PAYMENT-SIGNATURE → 200",
      xrpl: "HTTP 402 → RLUSD on XRPL Testnet → facilitator settle → 200",
      straitsx: "Scoped virtual card mandate → checkout → burn",
      aws: "Bedrock agents + API Gateway/Lambda/DynamoDB protocol slice",
    },
    merchant,
    x402,
    card,
    log,
    snowtrace: x402?.receipt?.explorerUrl ?? null,
    explorerUrl: x402?.receipt?.explorerUrl ?? null,
  });
}
