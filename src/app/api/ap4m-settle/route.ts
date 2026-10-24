import { settleAp4mPurchase } from "@/lib/ap4m/settle";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      price?: string;
      amount?: string;
      storeSlug?: string;
      skuId?: string;
      title?: string;
      operation?: string;
    };

    const amountRlusd = String(body.amount || body.price || "").trim();
    if (!amountRlusd) {
      return Response.json(
        {
          steps: [{ type: "error", text: "price required" }],
          error: "price required",
        },
        { status: 400 },
      );
    }

    const skuId = body.skuId?.trim() || "sku";
    const storeSlug = body.storeSlug?.trim() || "store";
    const operation =
      body.operation?.trim() ||
      `borneo-${storeSlug}-${skuId}-${Date.now()}`
        .toLowerCase()
        .replace(/[^a-z0-9._:-]+/g, "-")
        .slice(0, 64);

    const steps: Array<{ type: string; text: string }> = [
      {
        type: "info",
        text: `Mastercard AP4M · redeem voucher for ${amountRlusd} RLUSD on open Channel`,
      },
    ];

    const result = await settleAp4mPurchase({
      amountRlusd,
      operation,
      storeSlug,
      skuId,
    });

    steps.push({
      type: "success",
      text: `Settled ${result.amountRlusd} RLUSD · claim ${result.claimId ?? "n/a"}`,
    });
    steps.push({ type: "success", text: result.explorerUrl });

    return Response.json({
      steps,
      rail: "ap4m",
      receipt: {
        orderId: operation,
        txHash: result.txHash,
        explorerUrl: result.explorerUrl,
        claimId: result.claimId,
        channelId: result.channelId,
        amountRlusd: result.amountRlusd,
        title: body.title,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Mastercard AP4M settle failed";
    return Response.json(
      { steps: [{ type: "error", text: message }], error: message },
      { status: 500 },
    );
  }
}
