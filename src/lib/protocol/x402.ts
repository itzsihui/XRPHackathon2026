import {
  FacilitatorClient,
  encodePaymentRequiredHeader,
  decodePaymentSignatureHeader,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
} from "x402-xrpl";
import {
  config,
  explorerTx,
  storePayTo,
  toAtomic,
  toPaymentAmount,
  XRPL_SOURCE_TAG,
} from "@/lib/config";
import type { Sku, StoreRecord } from "@/lib/store/types";

export type { PaymentRequired, PaymentRequirements, PaymentPayload };

export function buildPaymentRequired(
  store: StoreRecord,
  sku: Sku,
  origin: string,
  orderId: string,
  quantity: number,
): PaymentRequired {
  const amount = toPaymentAmount(sku.price, quantity);
  const invoiceId = `INV-${orderId}`;
  const accept: PaymentRequirements = {
    scheme: "exact",
    network: config.network,
    amount,
    asset: config.tokenAddress,
    payTo: storePayTo(store),
    maxTimeoutSeconds: 600,
    extra: {
      name: config.tokenSymbol,
      decimals: config.tokenDecimals,
      orderId,
      invoiceId,
      sourceTag: XRPL_SOURCE_TAG,
      issuer: config.tokenIssuer,
    },
  };
  return {
    x402Version: 2,
    resource: {
      url: `${origin}/s/${store.slug}/buy`,
      description: `${sku.title} x${quantity}`,
      mimeType: "application/json",
    },
    accepts: [accept],
  };
}

/** Atomic amount for order records (micro-units). */
export function paymentAmountAtomic(
  store: StoreRecord,
  sku: Sku,
  quantity: number,
): string {
  return (
    BigInt(toAtomic(sku.price)) * BigInt(quantity)
  ).toString();
}

export function parsePaymentSignature(header: string): PaymentPayload | null {
  const raw = header.trim();
  if (!raw) return null;
  try {
    return decodePaymentSignatureHeader(raw);
  } catch {
    try {
      const decoded = JSON.parse(
        Buffer.from(raw, "base64").toString("utf8"),
      ) as PaymentPayload;
      if (decoded?.x402Version && decoded?.payload && decoded?.accepted) {
        return decoded;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function facilitator() {
  return new FacilitatorClient({ baseUrl: config.facilitatorUrl });
}

/**
 * Verify + settle a presigned XRPL Payment via the hosted facilitator.
 */
export async function verifyAndSettle(args: {
  paymentHeader: string;
  paymentRequirements: PaymentRequirements;
}) {
  try {
    const client = facilitator();
    const verified = await client.verify({
      paymentHeader: args.paymentHeader,
      paymentRequirements: args.paymentRequirements,
    });
    if (!verified.isValid) {
      return {
        ok: false as const,
        reason: verified.invalidReason || "Facilitator rejected payment",
      };
    }

    const settled = await client.settle({
      paymentHeader: args.paymentHeader,
      paymentRequirements: args.paymentRequirements,
    });
    if (!settled.success || !settled.transaction) {
      return {
        ok: false as const,
        reason: settled.errorReason || "Facilitator settle failed",
      };
    }

    return {
      ok: true as const,
      txHash: settled.transaction,
      explorerUrl: explorerTx(settled.transaction),
      payer: settled.payer || undefined,
    };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "verifyAndSettle failed";
    return { ok: false as const, reason };
  }
}

/** @deprecated Use verifyAndSettle — kept name alias for call-site clarity. */
export async function verifyTransfer(args: {
  paymentHeader: string;
  paymentRequirements: PaymentRequirements;
}) {
  return verifyAndSettle(args);
}

export function paymentRequiredHeaders(body: PaymentRequired) {
  return {
    "content-type": "application/json",
    "PAYMENT-REQUIRED": encodePaymentRequiredHeader(body),
    "cache-control": "no-store",
  };
}
