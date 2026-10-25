import { runCardAgent } from "@/lib/agents/card";
import { config } from "@/lib/config";
import { issueScopedCard } from "@/lib/straitsx/mcp";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      spendCap?: string;
      merchant?: string;
      message?: string;
      checkout?: boolean;
      skuId?: string;
      price?: string;
      title?: string;
      buyerUid?: string;
    };
    const origin = config.protocolBaseUrl || new URL(request.url).origin;

    // Full agent path: mandate → checkout (fast when skuId provided)
    if (body.checkout !== false && (body.message || body.checkout === true || body.skuId)) {
      const result = await runCardAgent({
        origin,
        message: body.message,
        slug: body.merchant,
        skuId: body.skuId,
        price: body.price,
        title: body.title,
        spendCap: body.spendCap,
        buyerUid: body.buyerUid,
      });
      return Response.json(result);
    }

    const mandate = await issueScopedCard({
      spendCap: body.spendCap || "0.01",
      merchant: body.merchant || "hackathon-shirts",
    });
    return Response.json(mandate);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Mastercard rail failed";
    return Response.json(
      { steps: [{ type: "error", text: message }], error: message },
      { status: 500 },
    );
  }
}
