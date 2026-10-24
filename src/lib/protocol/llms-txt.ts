import { config, storePayTo } from "@/lib/config";
import type { StoreRecord } from "@/lib/store/types";
import {
  SELLER_CREDENTIAL_TYPE,
  sellerDidDocPath,
  type SellerVerification,
} from "@/lib/xrpl/seller-verification-types";

export function originFromRequest(request: Request) {
  const url = new URL(request.url);
  return process.env.PROTOCOL_ORIGIN || url.origin;
}

function sellerSection(
  store: StoreRecord,
  origin: string,
  v?: SellerVerification | null,
) {
  const status = v
    ? v.onLedger
      ? `VERIFIED on XRPL — credential "${SELLER_CREDENTIAL_TYPE}" from ${v.issuer} accepted by ${store.merchantAddress}`
      : `NOT VERIFIED (${v.status}${v.reason ? `: ${v.reason}` : ""})`
    : "unknown";
  return `## Seller verification (XRPL XLS-70 + XLS-40)
- Status: ${status}
- payTo: ${store.merchantAddress}
- DID: ${v?.did?.id ?? "none"}${v?.didLinked ? ` → ${origin}${sellerDidDocPath(store.merchantAddress)}` : ""}
- Do not trust this line: verify on any XRPL node with ledger_entry {credential:{subject: payTo, issuer, credential_type}}.
- Exact request + issuer: ${origin}/api/seller-verification?address=${store.merchantAddress}
`;
}

export function renderLlmsTxt(
  store: StoreRecord,
  origin: string,
  verification?: SellerVerification | null,
) {
  const base = `${origin}/s/${store.slug}`;
  return `# ${store.name}

> AI-native storefront on the Agentic Storefront Protocol (Borneo).
> Humans use a GUI. Agents use this file.

This store sells in ${config.tokenSymbol} on XRPL (${config.network}).
Do not scrape HTML. Do not open a checkout page.

## For agents
1. Read the agent card: ${base}/agent.json
2. Load machine catalog: ${base}/catalog.json
3. Read verified-purchase reviews: ${base}/reviews.json
4. Pay via x402 POST ${base}/buy (expect HTTP 402) or Visa-style POST ${base}/checkout
5. Fetch receipts at ${base}/orders/{orderId}

## Discovery
- Agent card (JSON): ${base}/agent.json
- Catalog (ACP JSON): ${base}/catalog.json
- Reviews (verified purchase): ${base}/reviews.json
- These instructions: ${base}/llms.txt

${sellerSection(store, origin, verification)}
## Checkout rails
- Rail A x402: POST ${base}/buy
  - Expect HTTP 402 Payment Required with PAYMENT-REQUIRED.
  - Pay exact amount in ${config.tokenSymbol} on XRPL Testnet to the merchant classic address, then retry with PAYMENT-SIGNATURE (presigned Payment blob).
- Rail B Visa (agent-authorized card): POST ${base}/checkout
  - Issue a one-time scoped virtual card (spend cap, merchant whitelist, expiry).
  - Burn the card after success.

## Receipts
- GET ${base}/orders/{orderId}

## Currency
- Token: ${config.tokenSymbol}
- Decimals: ${config.tokenDecimals}
- Asset: ${config.tokenAddress}
- Issuer: ${config.tokenIssuer}
- Network: ${config.network}
- Merchant payTo: ${storePayTo(store)}
`;
}
