import { config, storePayTo, toPaymentAmount } from "@/lib/config";
import { payRlusdWithXrp } from "@/lib/protocol/cross-currency";
import { emit } from "@/lib/protocol/events";
import { paymentAmountAtomic } from "@/lib/protocol/x402";
import { repo } from "@/lib/store/repo";
import type { Order } from "@/lib/store/types";

export const runtime = "nodejs";

type Body = {
  storeSlug?: string;
  skuId?: string;
  quantity?: number;
  orderId?: string;
  buyerUid?: string;
};

/**
 * POST /api/fx-settle — pay SKU price in XRP; merchant receives exact RLUSD.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const slug = body.storeSlug?.trim();
    if (!slug) {
      return Response.json(
        { steps: [{ type: "error", text: "storeSlug required" }], error: "storeSlug required" },
        { status: 400 },
      );
    }

    const store = await repo.getStore(slug);
    if (!store) {
      return Response.json(
        { steps: [{ type: "error", text: "store not found" }], error: "store not found" },
        { status: 404 },
      );
    }

    const sku =
      store.skus.find((item) => item.id === body.skuId) ?? store.skus[0];
    if (!sku) {
      return Response.json(
        { steps: [{ type: "error", text: "no SKUs" }], error: "no SKUs" },
        { status: 400 },
      );
    }

    const quantity = Math.max(1, Number(body.quantity) || 1);
    const orderId = body.orderId || crypto.randomUUID();
    const amountAtomic = paymentAmountAtomic(store, sku, quantity);
    const deliverRlusd = toPaymentAmount(sku.price, quantity);

    const steps: Array<{ type: string; text: string }> = [
      {
        type: "chain",
        text: `XRP→${config.tokenSymbol} terminal · deliver ${deliverRlusd} ${config.tokenSymbol} to ${storePayTo(store)}`,
      },
    ];

    const existing = await repo.getOrder(orderId);
    if (existing?.status === "paid") {
      steps.push({ type: "success", text: "idempotent receipt" });
      if (existing.explorerUrl) {
        steps.push({ type: "success", text: existing.explorerUrl });
      }
      return Response.json({
        steps,
        receipt: {
          type: "borneo.receipt",
          orderId: existing.id,
          store: existing.slug,
          skuId: existing.skuId,
          quantity: existing.quantity,
          amount: `${deliverRlusd} ${config.tokenSymbol}`,
          rail: existing.rail,
          status: existing.status,
          txHash: existing.txHash,
          explorerUrl: existing.explorerUrl,
          sentXrp: existing.sentXrp,
          deliveredRlusd: existing.deliveredRlusd,
          paidAt: existing.paidAt,
        },
      });
    }

    if (!config.buyerSeed) {
      steps.push({
        type: "error",
        text: "XRPL_BUYER_SEED missing — cannot sign XRP→RLUSD Payment",
      });
      return Response.json(
        { steps, error: "XRPL_BUYER_SEED missing" },
        { status: 402 },
      );
    }

    await repo.putOrder({
      id: orderId,
      slug,
      skuId: sku.id,
      quantity,
      amountAtomic,
      status: "pending",
      rail: "xrpl-xrp",
      buyerUid: body.buyerUid?.trim() || undefined,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    });

    const settled = await payRlusdWithXrp({
      seed: config.buyerSeed,
      destination: storePayTo(store),
      deliverRlusd,
    });

    if (!settled.ok) {
      emit({
        status: 402,
        method: "POST",
        path: "/api/fx-settle",
        store: slug,
        orderId,
        rail: "xrpl-xrp",
        message: `XRP settle failed: ${settled.reason}`,
      });
      steps.push({ type: "error", text: settled.reason });
      return Response.json({ steps, error: settled.reason }, { status: 402 });
    }

    const paid: Order = {
      id: orderId,
      slug,
      skuId: sku.id,
      quantity,
      amountAtomic,
      status: "paid",
      rail: "xrpl-xrp",
      txHash: settled.txHash,
      explorerUrl: settled.explorerUrl,
      sentXrp: settled.sentXrp,
      deliveredRlusd: settled.deliveredRlusd,
      buyerUid: body.buyerUid?.trim() || existing?.buyerUid || undefined,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      paidAt: new Date().toISOString(),
    };
    await repo.putOrder(paid);

    const skuRef = store.skus.find((item) => item.id === sku.id);
    if (skuRef) {
      skuRef.quantity = Math.max(0, skuRef.quantity - quantity);
      await repo.putStore(store);
    }

    emit({
      status: 200,
      method: "POST",
      path: "/api/fx-settle",
      store: slug,
      orderId,
      rail: "xrpl-xrp",
      message: `spent ${settled.sentXrp} XRP · delivered ${settled.deliveredRlusd} ${config.tokenSymbol} · ${settled.txHash}`,
    });

    steps.push({
      type: "success",
      text: `Paid · spent ${settled.sentXrp} XRP · merchant received ${settled.deliveredRlusd} ${config.tokenSymbol}`,
    });
    steps.push({ type: "success", text: settled.explorerUrl });

    return Response.json({
      steps,
      receipt: {
        type: "borneo.receipt",
        orderId: paid.id,
        store: paid.slug,
        skuId: paid.skuId,
        quantity: paid.quantity,
        amount: `${deliverRlusd} ${config.tokenSymbol}`,
        rail: paid.rail,
        status: paid.status,
        txHash: paid.txHash,
        explorerUrl: paid.explorerUrl,
        sentXrp: paid.sentXrp,
        deliveredRlusd: paid.deliveredRlusd,
        paidAt: paid.paidAt,
        merchant: {
          displayName: store.merchantDisplayName,
          cryptoReceive: storePayTo(store),
        },
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "fx-settle failed";
    return Response.json(
      { steps: [{ type: "error", text: message }], error: message },
      { status: 500 },
    );
  }
}
