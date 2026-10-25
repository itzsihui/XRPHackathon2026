import { config } from "@/lib/config";
import { resolveBuyerTarget } from "@/lib/agents/discover";
import { emit } from "@/lib/protocol/events";
import { issueScopedCard } from "@/lib/straitsx/mcp";
import { repo } from "@/lib/store/repo";

export type CardStep = {
  type: "info" | "http" | "card" | "error" | "success";
  text: string;
};

/**
 * Mastercard / scoped-card checkout.
 * Pass slug + skuId (+ optional price) to skip rediscovery + llms/catalog fetches
 * when the buyer UI already selected a product.
 */
export async function runCardAgent(args: {
  origin: string;
  message?: string;
  slug?: string;
  skuId?: string;
  price?: string;
  title?: string;
  /** Override mandate spendCap (defaults to item price). */
  spendCap?: string;
  buyerUid?: string;
}): Promise<{ steps: CardStep[]; receipt?: unknown; mandate?: unknown }> {
  const steps: CardStep[] = [];

  let slug = args.slug?.trim() || "";
  let skuId = args.skuId?.trim() || "";
  let price = args.price?.trim() || "";
  let title = args.title?.trim() || "";

  // Fast path: product already chosen in the buyer UI
  if (slug && skuId) {
    if (!price || !title) {
      const store = await repo.getStore(slug);
      const sku = store?.skus.find((s) => s.id === skuId) ?? store?.skus[0];
      if (!sku) {
        steps.push({
          type: "error",
          text: `SKU ${skuId} not found in /s/${slug}`,
        });
        return { steps };
      }
      skuId = sku.id;
      price = price || sku.price;
      title = title || sku.title;
    }
  } else {
    const resolved = await resolveBuyerTarget({
      slug: args.slug,
      message: args.message,
    });

    if (!resolved.ok) {
      steps.push({
        type: "error",
        text: resolved.available
          ? `${resolved.reason} Available: ${resolved.available}.`
          : resolved.reason,
      });
      return { steps };
    }

    slug = resolved.slug;
    skuId = resolved.sku.id;
    title = resolved.sku.title;
    const store = await repo.getStore(slug);
    price =
      store?.skus.find((s) => s.id === skuId)?.price ??
      store?.skus[0]?.price ??
      "0.01";
  }

  const base = `${args.origin}/s/${slug}`;
  const spendCap =
    args.spendCap?.trim() && Number(args.spendCap) > 0
      ? args.spendCap.trim()
      : price;

  steps.push({
    type: "card",
    text: `Issuing scoped Mastercard mandate · cap ≥${spendCap} · merchant ${slug}`,
  });
  const mandate = await issueScopedCard({
    spendCap,
    merchant: slug,
    ttlMinutes: 15,
  });
  steps.push({
    type: "card",
    text: `Mandate ${mandate.cardOpaqueId} pan ${mandate.truncatedPan} source ${mandate.source}`,
  });

  const orderId = crypto.randomUUID();
  steps.push({
    type: "info",
    text: `POST ${base}/checkout · ${title}`,
  });
  const checkout = await fetch(`${base}/checkout`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      skuId,
      quantity: 1,
      orderId,
      buyerUid: args.buyerUid?.trim() || undefined,
      mandate,
    }),
  });
  const checkoutText = await checkout.text();
  let receipt: unknown;
  try {
    receipt = JSON.parse(checkoutText);
  } catch {
    emit({
      status: checkout.status,
      method: "POST",
      path: `/s/${slug}/checkout`,
      store: slug,
      orderId,
      rail: "straitsx-card",
      message: `checkout non-JSON: ${checkoutText.slice(0, 120)}`,
    });
    steps.push({
      type: "error",
      text: `HTTP ${checkout.status} non-JSON from /checkout`,
    });
    return { steps, mandate };
  }

  emit({
    status: checkout.status,
    method: "POST",
    path: `/s/${slug}/checkout`,
    store: slug,
    orderId,
    rail: "straitsx-card",
    message: checkout.ok
      ? `card mandate accepted, burn ${mandate.cardOpaqueId}`
      : `checkout failed: ${JSON.stringify(receipt).slice(0, 160)}`,
  });

  if (!checkout.ok) {
    steps.push({
      type: "error",
      text: `HTTP ${checkout.status} ${JSON.stringify(receipt)}`,
    });
    return { steps, mandate, receipt };
  }

  const paid = receipt as { amount?: string; orderId?: string };
  steps.push({
    type: "success",
    text: `Checkout OK · ${paid.amount ?? price} ${config.tokenSymbol} · order ${paid.orderId ?? orderId}`,
  });
  return { steps, mandate, receipt };
}
