import { privateKeyToAccount } from "viem/accounts";
import { config } from "@/lib/config";
import { emit } from "@/lib/protocol/events";
import { repo } from "@/lib/store/repo";
import type { CardMandate } from "@/lib/store/types";
import { buildEip3009PaymentSignature, type CardApiAccept } from "@/lib/straitsx/eip3009";
import { callCardMcpTool } from "@/lib/straitsx/mcp-client";

export type CardMandateResult = CardMandate & {
  source: "straitsx-mcp" | "local-mandate";
  note?: string;
  settlementTx?: string;
  cardHtml?: string;
};

type McpIssuePlan = {
  action?: string;
  url: string;
  method?: string;
  body: {
    amount_sgd: number;
    cardholder_name: string;
    wallet_address: string;
  };
  environment?: { chain?: string; chain_id?: number; note?: string };
};

type CardApiPaymentRequired = {
  x402Version: number;
  accepts: CardApiAccept[];
  error?: string;
};

type IssuedCard = {
  card_opaque_id?: string;
  cardOpaqueId?: string;
  truncated_card_number?: string;
  truncatedPan?: string;
  settlement_tx?: string;
  settlementTx?: string;
  card_html?: string;
  cardHtml?: string;
};

export async function issueScopedCard(args: {
  spendCap: string;
  merchant: string;
  ttlMinutes?: number;
  cardholderName?: string;
}): Promise<CardMandateResult> {
  const expiresAt = new Date(
    Date.now() + (args.ttlMinutes ?? 15) * 60_000,
  ).toISOString();

  try {
    if (config.straitsxMcpUrl) {
      const live = await issueViaCardMcp(args);
      if (live) {
        const { settlementTx, cardHtml, ...mandateFields } = live;
        const mandate = await repo.putMandate(mandateFields);
        emit({
          status: 200,
          method: "POST",
          path: "straitsx-mandate",
          store: args.merchant,
          rail: "straitsx-card",
          message: `live Card MCP ${mandate.cardOpaqueId} cap ${mandate.spendCap}`,
        });
        return {
          ...mandate,
          source: "straitsx-mcp",
          settlementTx,
          cardHtml,
        };
      }
    }
  } catch (error) {
    const note = error instanceof Error ? error.message : "Card MCP failed";
    emit({
      status: 503,
      method: "POST",
      path: "straitsx-mcp",
      store: args.merchant,
      rail: "straitsx-card",
      message: `Card MCP fallback: ${note}`,
    });
  }

  const mandate = await repo.putMandate({
    spendCap: Number(args.spendCap).toFixed(2),
    merchant: args.merchant,
    expiresAt,
    cardOpaqueId: `sx_${crypto.randomUUID().slice(0, 8)}`,
    truncatedPan: "4665********7928",
    status: "active",
    source: "local-mandate",
  });

  emit({
    status: 200,
    method: "POST",
    path: "straitsx-mandate",
    store: args.merchant,
    rail: "straitsx-card",
    message: `sandbox-shaped mandate ${mandate.cardOpaqueId} cap ${mandate.spendCap} merchant ${mandate.merchant}`,
  });

  return {
    ...mandate,
    source: "local-mandate",
    note:
      "Mastercard rail uses a local scoped-card mandate (no StraitsX MCP). Stablecoin settlement is RLUSD on XRPL Testnet via x402.",
  };
}

async function issueViaCardMcp(args: {
  spendCap: string;
  merchant: string;
  ttlMinutes?: number;
  cardholderName?: string;
}): Promise<(CardMandate & { settlementTx?: string; cardHtml?: string }) | null> {
  const key = config.buyerPrivateKey;
  if (!key) {
    emit({
      status: 503,
      method: "GET",
      path: "straitsx-mcp",
      store: args.merchant,
      rail: "straitsx-card",
      message: "Card MCP: BUYER_PRIVATE_KEY required to settle Fuji EIP-3009",
    });
    return null;
  }

  const account = privateKeyToAccount(key);
  // Sandbox tool requires amount_sgd between 5 and 30.
  const amountSgd = Math.min(30, Math.max(5, Math.ceil(Number(args.spendCap) || 5)));
  const cardholderName = (args.cardholderName || "Borneo Agent").replace(
    /[^a-zA-Z ]/g,
    "",
  ).slice(0, 26);

  const isProduction = config.straitsxMcpUrl.includes("/production/");
  const toolName = isProduction ? "get_card" : "get_card_sandbox";

  const plan = await callCardMcpTool<McpIssuePlan>({
    mcpSseUrl: config.straitsxMcpUrl,
    toolName,
    toolArgs: {
      wallet_address: account.address,
      cardholder_name: cardholderName || "Borneo Agent",
      amount_sgd: amountSgd,
    },
  });

  if (!plan?.url) {
    throw new Error("Card MCP did not return cardapi URL");
  }

  emit({
    status: 200,
    method: "POST",
    path: "straitsx-mcp",
    store: args.merchant,
    rail: "straitsx-card",
    message: `MCP plan → ${plan.url} (${amountSgd} SGD on Fuji)`,
  });

  const body = {
    amount_sgd: amountSgd,
    cardholder_name: cardholderName || "Borneo Agent",
    wallet_address: account.address,
  };

  const first = await fetch(plan.url, {
    method: plan.method || "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const challenge = (await first.json()) as CardApiPaymentRequired;
  emit({
    status: first.status,
    method: "POST",
    path: "straitsx-cardapi",
    store: args.merchant,
    rail: "straitsx-card",
    message:
      first.status === 402
        ? `HTTP 402 cardapi ${challenge.accepts?.[0]?.amount} testnet XSGD EIP-3009`
        : `cardapi unexpected ${first.status}`,
  });

  if (first.status !== 402 || !challenge.accepts?.[0]) {
    throw new Error(`Expected cardapi 402, got ${first.status}`);
  }

  const payment = await buildEip3009PaymentSignature({
    privateKey: key,
    accept: challenge.accepts[0],
    x402Version: challenge.x402Version ?? 1,
  });

  const second = await fetch(plan.url, {
    method: plan.method || "POST",
    headers: {
      "content-type": "application/json",
      "PAYMENT-SIGNATURE": payment.header,
    },
    body: JSON.stringify(body),
  });
  const secondText = await second.text();
  let issued: IssuedCard & { error?: string };
  try {
    issued = JSON.parse(secondText) as IssuedCard & { error?: string };
  } catch {
    emit({
      status: second.status,
      method: "POST",
      path: "straitsx-cardapi",
      store: args.merchant,
      rail: "straitsx-card",
      message: `cardapi settle non-JSON ${second.status}: ${secondText.slice(0, 120)}`,
    });
    throw new Error(
      second.ok
        ? `cardapi returned non-JSON after EIP-3009 settle: ${secondText.slice(0, 80)}`
        : `cardapi settle HTTP ${second.status}: ${secondText.slice(0, 120)}`,
    );
  }
  emit({
    status: second.status,
    method: "POST",
    path: "straitsx-cardapi",
    store: args.merchant,
    rail: "straitsx-card",
    message:
      second.ok
        ? `HTTP 200 card issued ${issued.card_opaque_id || issued.cardOpaqueId}`
        : `cardapi settle failed ${second.status}: ${issued.error || JSON.stringify(issued).slice(0, 120)}`,
  });

  if (!second.ok) {
    throw new Error(
      issued.error ||
        `cardapi settle HTTP ${second.status} — fund Fuji wallet with testnet XSGD (asset ${challenge.accepts[0].asset})`,
    );
  }

  const cardOpaqueId = issued.card_opaque_id || issued.cardOpaqueId;
  if (!cardOpaqueId) {
    throw new Error("cardapi returned no card_opaque_id");
  }

  const expiresAt = new Date(
    Date.now() + (args.ttlMinutes ?? 15) * 60_000,
  ).toISOString();

  return {
    spendCap: amountSgd.toFixed(2),
    merchant: args.merchant,
    expiresAt,
    cardOpaqueId,
    truncatedPan:
      issued.truncated_card_number || issued.truncatedPan || "4665************",
    status: "active",
    source: "straitsx-mcp",
    settlementTx: issued.settlement_tx || issued.settlementTx,
    cardHtml: issued.card_html || issued.cardHtml,
  };
}

export async function assertMandateAllows(args: {
  mandate: CardMandate;
  storeSlug: string;
  merchantAddress: string;
  amount: string;
  quantity: number;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const stored = args.mandate.cardOpaqueId
    ? await repo.getMandate(args.mandate.cardOpaqueId)
    : null;
  if (!stored) {
    return { ok: false, reason: "unknown card — issue via StraitsX mandate first" };
  }
  const mandate = stored;

  if (mandate.status === "burned") {
    return { ok: false, reason: "card already burned" };
  }
  if (new Date(mandate.expiresAt).getTime() <= Date.now()) {
    return { ok: false, reason: "mandate expired" };
  }
  const merchantOk =
    mandate.merchant === args.storeSlug ||
    mandate.merchant.toLowerCase() === args.merchantAddress.toLowerCase();
  if (!merchantOk) {
    return { ok: false, reason: "merchant not on whitelist" };
  }
  const due = Number(args.amount) * args.quantity;
  if (Number(mandate.spendCap) + 1e-9 < due) {
    return {
      ok: false,
      reason: `spend cap ${mandate.spendCap} < due ${due.toFixed(2)}`,
    };
  }
  return { ok: true };
}
