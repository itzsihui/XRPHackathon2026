export type ChainNetwork = "xrpl:1" | "xrpl:0" | "xrpl:2";

/** Testnet RLUSD currency code (40-hex) and issuer. */
export const RLUSD_CURRENCY =
  "524C555344000000000000000000000000000000";
export const RLUSD_TESTNET_ISSUER = "rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV";
export const XRPL_SOURCE_TAG = 804681468;

function env(name: string, fallback: string) {
  return process.env[name] || fallback;
}

export const config = {
  rpcUrl: env("XRPL_RPC_URL", "https://s.altnet.rippletest.net:51234/"),
  wsUrl: env("XRPL_WS_URL", "wss://s.altnet.rippletest.net:51233"),
  network: env("XRPL_NETWORK", "xrpl:1") as ChainNetwork,
  facilitatorUrl: env(
    "XRPL_FACILITATOR_URL",
    "https://xrpl-facilitator-testnet.t54.ai",
  ),
  /** @deprecated Use network; retained for any leftover chainId reads. */
  chainId: 1,
  tokenAddress: env("TOKEN_ADDRESS", RLUSD_CURRENCY),
  tokenIssuer: env("TOKEN_ISSUER", RLUSD_TESTNET_ISSUER),
  tokenSymbol: env("TOKEN_SYMBOL", "RLUSD"),
  tokenDecimals: Number(env("TOKEN_DECIMALS", "6")),
  /** Demo unit price in RLUSD on XRPL Testnet. */
  demoUnitPriceXsgd: "0.01",
  /**
   * Shared demo settle address (classic r…). Required for crypto rails.
   * Empty default — never fall back to a random genesis account.
   */
  merchantAddress: env("MERCHANT_ADDRESS", ""),
  /** Buyer wallet seed for server-side x402 settle (family seed / secret). */
  get buyerSeed() {
    const raw =
      process.env.XRPL_BUYER_SEED?.trim().replace(/^["']|["']$/g, "") ||
      process.env.BUYER_SEED?.trim().replace(/^["']|["']$/g, "");
    return raw || undefined;
  },
  /** @deprecated Prefer buyerSeed — kept so legacy card MCP helpers compile. */
  get buyerPrivateKey() {
    return undefined as `0x${string}` | undefined;
  },
  explorerBase: env("EXPLORER_BASE", "https://testnet.xrpl.org"),
  /** Optional legacy Card MCP URL — unused when empty; Mastercard rail uses local mandate. */
  straitsxMcpUrl: env("STRAITSX_MCP_URL", ""),
  get straitsxMcpToken() {
    return (
      process.env.STRAITSX_MCP_TOKEN?.trim() ||
      process.env.STRAITSX_API_KEY?.trim() ||
      undefined
    );
  },
  bedrockRegion: env("AWS_REGION", "ap-southeast-1"),
  bedrockModel: env(
    "BEDROCK_MODEL_ID",
    "anthropic.claude-3-haiku-20240307-v1:0",
  ),
  /** When set, buyer/card agents hit API Gateway instead of the Next origin. */
  get protocolBaseUrl() {
    return (
      process.env.PROTOCOL_BASE_URL?.trim() ||
      process.env.NEXT_PUBLIC_PROTOCOL_BASE_URL?.trim() ||
      undefined
    );
  },
};

export function explorerTx(hash: string) {
  return `${config.explorerBase}/transactions/${hash}`;
}

/**
 * Demo: all stores settle to MERCHANT_ADDRESS when set.
 * Prefer env over persisted store.merchantAddress so .env updates
 * (and fixes for stale catalog rows) apply without republishing.
 */
export function storePayTo(store: {
  merchantAddress?: string | null;
}): string {
  const shared = config.merchantAddress.trim();
  if (shared) return shared;
  return (store.merchantAddress || "").trim();
}

/** Decimal RLUSD amount string for XRPL IOU Payment / x402 `amount`. */
export function toPaymentAmount(price: string, quantity = 1) {
  const n = Number(price) * quantity;
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid price: ${price}`);
  }
  return n.toFixed(config.tokenDecimals).replace(/\.?0+$/, "") || n.toFixed(2);
}

/** Integer micro-units for order storage / display helpers. */
export function toAtomic(price: string) {
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid price: ${price}`);
  }
  return BigInt(Math.round(n * 10 ** config.tokenDecimals)).toString();
}

export function fromAtomic(atomic: string) {
  if (atomic.includes(".")) {
    return Number(atomic).toFixed(2);
  }
  const v = Number(atomic) / 10 ** config.tokenDecimals;
  return v.toFixed(2);
}
