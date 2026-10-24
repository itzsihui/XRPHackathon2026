import { config, explorerTx, fromAtomic, toAtomic } from "@/lib/config";
import { renderAgentCard } from "@/lib/protocol/agent-card";
import { renderCatalog } from "@/lib/protocol/catalog";
import { emit } from "@/lib/protocol/events";
import { originFromRequest, renderLlmsTxt } from "@/lib/protocol/llms-txt";
import { renderReviews } from "@/lib/protocol/reviews";
import {
  buildPaymentRequired,
  parsePaymentSignature,
  paymentAmountAtomic,
  paymentRequiredHeaders,
  verifyAndSettle,
} from "@/lib/protocol/x402";
import { assertMandateAllows } from "@/lib/straitsx/mcp";
import { repo } from "@/lib/store/repo";
import type { CardMandate, Order, StoreRecord } from "@/lib/store/types";
import { verifierInfo, verifySellerOnLedger } from "@/lib/xrpl/seller-credential";

function json(data: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export async function handleLlmsTxt(slug: string, request: Request) {
  const store = await repo.getStore(slug);
  if (!store) return json({ error: "store not found" }, 404);
  const verification = await verifySellerOnLedger(store.merchantAddress);
  const body = renderLlmsTxt(store, originFromRequest(request), verification);
  emit({
    status: 200,
    method: "GET",
    path: `/s/${slug}/llms.txt`,
    store: slug,
    message: "llms.txt served",
  });
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export async function handleAgentJson(slug: string, request: Request) {
  const store = await repo.getStore(slug);
  if (!store) return json({ error: "store not found" }, 404);
  const verification = await verifySellerOnLedger(store.merchantAddress);
  const card = renderAgentCard(
    store,
    originFromRequest(request),
    verification,
    verifierInfo(),
  );
  emit({
    status: 200,
    method: "GET",
    path: `/s/${slug}/agent.json`,
    store: slug,
    message: "agent.json served",
  });
  return json(card);
}

export async function handleCatalog(slug: string, request: Request) {
  const store = await repo.getStore(slug);
  if (!store) return json({ error: "store not found" }, 404);
  emit({
    status: 200,
    method: "GET",
    path: `/s/${slug}/catalog.json`,
    store: slug,
    message: `catalog ${store.skus.length} SKUs`,
  });
  return json(renderCatalog(store, originFromRequest(request)));
}

export async function handleReviews(slug: string, request: Request) {
  const store = await repo.getStore(slug);
  if (!store) return json({ error: "store not found" }, 404);
  const reviews = await repo.listReviews(slug);
  emit({
    status: 200,
    method: "GET",
    path: `/s/${slug}/reviews.json`,
    store: slug,
    message: `reviews ${reviews.length}`,
  });
  return json(renderReviews(slug, reviews));
}

export async function handleBuy(slug: string, request: Request) {
  const store = await repo.getStore(slug);
  if (!store) return json({ error: "store not found" }, 404);

  const body = (await request.json().catch(() => ({}))) as {
    skuId?: string;
    quantity?: number;
    orderId?: string;
    buyerUid?: string;
  };
  const sku =
    store.skus.find((item) => item.id === body.skuId) ?? store.skus[0];
  if (!sku) return json({ error: "no SKUs" }, 400);
  const quantity = Math.max(1, Number(body.quantity) || 1);
  const orderId = body.orderId || crypto.randomUUID();
  const origin = originFromRequest(request);
  const requirements = buildPaymentRequired(
    store,
    sku,
    origin,
    orderId,
    quantity,
  );
  const amountAtomic = paymentAmountAtomic(store, sku, quantity);

  const existing = await repo.getOrder(orderId);
  if (existing?.status === "paid") {
    emit({
      status: 200,
      method: "POST",
      path: `/s/${slug}/buy`,
      store: slug,
      orderId,
      rail: "x402",
      message: "idempotent 200 receipt",
    });
    return json(receipt(existing, store));
  }

  const signature =
    request.headers.get("PAYMENT-SIGNATURE") ||
    request.headers.get("payment-signature");

  if (!signature) {
    await repo.putOrder({
      id: orderId,
      slug,
      skuId: sku.id,
      quantity,
      amountAtomic,
      status: "pending",
      rail: "x402",
      buyerUid: body.buyerUid?.trim() || undefined,
      createdAt: new Date().toISOString(),
    });
    emit({
      status: 402,
      method: "POST",
      path: `/s/${slug}/buy`,
      store: slug,
      orderId,
      rail: "x402",
      message: `HTTP 402 ${fromAtomic(amountAtomic)} ${config.tokenSymbol} to ${store.merchantAddress}`,
    });
    return new Response(JSON.stringify(requirements, null, 2), {
      status: 402,
      headers: paymentRequiredHeaders(requirements),
    });
  }

  const payload = parsePaymentSignature(signature);
  if (!payload) {
    requirements.error = "Invalid PAYMENT-SIGNATURE";
    emit({
      status: 402,
      method: "POST",
      path: `/s/${slug}/buy`,
      store: slug,
      orderId,
      rail: "x402",
      message: "402 invalid PAYMENT-SIGNATURE",
    });
    return new Response(JSON.stringify(requirements, null, 2), {
      status: 402,
      headers: paymentRequiredHeaders(requirements),
    });
  }

  const verified = await verifyAndSettle({
    paymentHeader: signature.trim(),
    paymentRequirements: requirements.accepts[0],
  });
  if (!verified.ok) {
    requirements.error = verified.reason;
    emit({
      status: 402,
      method: "POST",
      path: `/s/${slug}/buy`,
      store: slug,
      orderId,
      rail: "x402",
      message: `402 verify failed: ${verified.reason}`,
    });
    return new Response(JSON.stringify(requirements, null, 2), {
      status: 402,
      headers: paymentRequiredHeaders(requirements),
    });
  }

  const txHash = verified.txHash;
  const paid: Order = {
    id: orderId,
    slug,
    skuId: sku.id,
    quantity,
    amountAtomic,
    status: "paid",
    rail: "x402",
    txHash,
    explorerUrl: verified.explorerUrl,
    buyerUid:
      body.buyerUid?.trim() || existing?.buyerUid || undefined,
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
    path: `/s/${slug}/buy`,
    store: slug,
    orderId,
    rail: "x402",
    message: `HTTP 200 receipt ${txHash}`,
  });
  return json(receipt(paid, store));
}

export async function handleCheckout(slug: string, request: Request) {
  const store = await repo.getStore(slug);
  if (!store) return json({ error: "store not found" }, 404);
  const body = (await request.json().catch(() => ({}))) as {
    skuId?: string;
    quantity?: number;
    orderId?: string;
    buyerUid?: string;
    mandate?: CardMandate;
  };
  const sku =
    store.skus.find((item) => item.id === body.skuId) ?? store.skus[0];
  if (!sku) return json({ error: "no SKUs" }, 400);
  const quantity = Math.max(1, Number(body.quantity) || 1);
  const orderId = body.orderId || crypto.randomUUID();
  const existing = await repo.getOrder(orderId);
  if (existing?.status === "paid") return json(receipt(existing, store));

  const mandate = body.mandate;
  if (!mandate) {
    emit({
      status: 400,
      method: "POST",
      path: `/s/${slug}/checkout`,
      store: slug,
      message: "missing StraitsX mandate",
    });
    return json({ error: "mandate required" }, 400);
  }

  const allowed = await assertMandateAllows({
    mandate,
    storeSlug: store.slug,
    merchantAddress: store.merchantAddress,
    amount: sku.price,
    quantity,
  });
  if (!allowed.ok) {
    emit({
      status: 402,
      method: "POST",
      path: `/s/${slug}/checkout`,
      store: slug,
      orderId,
      rail: "straitsx-card",
      message: `mandate rejected: ${allowed.reason}`,
    });
    return json({ error: "mandate rejected", reason: allowed.reason }, 402);
  }

  const expected = toAtomic(sku.price);
  const burned = mandate.cardOpaqueId
    ? await repo.burnMandate(mandate.cardOpaqueId)
    : null;
  const paidMandate: CardMandate = burned ?? {
    ...mandate,
    status: "burned",
    burnedAt: new Date().toISOString(),
  };

  const paid: Order = {
    id: orderId,
    slug,
    skuId: sku.id,
    quantity,
    amountAtomic: (BigInt(expected) * BigInt(quantity)).toString(),
    status: "paid",
    rail: "straitsx-card",
    mandate: paidMandate,
    buyerUid:
      body.buyerUid?.trim() || existing?.buyerUid || undefined,
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
    path: `/s/${slug}/checkout`,
    store: slug,
    orderId,
    rail: "straitsx-card",
    message: `card mandate accepted → Visa receive ${store.visaReceive?.accountLabel ?? store.slug}${store.visaReceive?.receiveId ? ` (${store.visaReceive.receiveId})` : ""}, burn ${paidMandate.cardOpaqueId ?? "card"}`,
  });
  return json(receipt(paid, store));
}

export async function handleOrder(slug: string, id: string) {
  const order = await repo.getOrder(id);
  if (!order || order.slug !== slug) {
    return json({ error: "order not found" }, 404);
  }
  const store = await repo.getStore(slug);
  return json(receipt(order, store));
}

function receipt(order: Order, store?: StoreRecord | null) {
  return {
    type: "borneo.receipt",
    orderId: order.id,
    store: order.slug,
    skuId: order.skuId,
    quantity: order.quantity,
    amount: `${fromAtomic(order.amountAtomic)} ${config.tokenSymbol}`,
    rail: order.rail,
    status: order.status,
    txHash: order.txHash,
    explorerUrl:
      order.explorerUrl ?? (order.txHash ? explorerTx(order.txHash) : undefined),
    mandate: order.mandate,
    paidAt: order.paidAt,
    merchant: store
      ? {
          displayName: store.merchantDisplayName,
          cryptoReceive: store.merchantAddress,
          visaReceive: store.visaReceive,
        }
      : undefined,
  };
}
