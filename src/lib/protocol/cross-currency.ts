import {
  Client,
  dropsToXrp,
  isValidClassicAddress,
  Wallet,
  xrpToDrops,
  type Payment,
  type Path,
  type TransactionMetadata,
} from "xrpl";
import {
  config,
  explorerTx,
  toPaymentAmount,
  XRPL_SOURCE_TAG,
} from "@/lib/config";

const SEND_MAX_BUFFER = 1.02; // 2% slippage headroom over quote
const QUOTE_TTL_MS = 15_000;

export type XrpRlusdQuote = {
  ok: true;
  deliverRlusd: string;
  destination: string;
  dropsToSend: string;
  /** Human XRP amount from quote (before buffer). */
  xrpDisplay: string;
  /** SendMax drops including buffer. */
  sendMaxDrops: string;
  sendMaxXrpDisplay: string;
  paths: Path[];
  expiresAt: number;
  /** path_find | amm — which quoting path produced this. */
  source: "path_find" | "amm";
};

export type XrpRlusdQuoteFail = {
  ok: false;
  reason: string;
};

export type CrossCurrencyReceipt = {
  ok: true;
  txHash: string;
  explorerUrl: string;
  deliveredRlusd: string;
  sentXrp: string;
  payer: string;
};

export type CrossCurrencyFail = {
  ok: false;
  reason: string;
};

function rlusdAmount(value: string) {
  return {
    currency: config.tokenAddress,
    issuer: config.tokenIssuer,
    value,
  };
}

/** Minimal path step: trade XRP into destination IOU via DEX/AMM. */
function defaultAmmPaths(): Path[] {
  return [
    [
      {
        currency: config.tokenAddress,
        issuer: config.tokenIssuer,
      },
    ],
  ];
}

function dropsToDisplay(drops: string | number | bigint): string {
  try {
    const n = Number(dropsToXrp(String(drops)));
    if (!Number.isFinite(n)) return String(drops);
    return n.toFixed(6).replace(/\.?0+$/, "") || n.toFixed(2);
  } catch {
    return String(drops);
  }
}

function applyBuffer(drops: string): string {
  const n = BigInt(drops);
  const buffered = (n * 102n) / 100n; // 2%
  return buffered < n + 1n ? (n + 1n).toString() : buffered.toString();
}

function buildQuote(args: {
  deliver: string;
  destination: string;
  drops: string;
  paths: Path[];
  source: "path_find" | "amm";
}): XrpRlusdQuote {
  const sendMaxDrops = applyBuffer(args.drops);
  return {
    ok: true,
    deliverRlusd: args.deliver,
    destination: args.destination,
    dropsToSend: args.drops,
    xrpDisplay: dropsToDisplay(args.drops),
    sendMaxDrops,
    sendMaxXrpDisplay: dropsToDisplay(sendMaxDrops),
    paths: args.paths,
    expiresAt: Date.now() + QUOTE_TTL_MS,
    source: args.source,
  };
}

async function destinationCanHoldRlusd(
  client: Client,
  destination: string,
): Promise<boolean> {
  try {
    const lines = await client.request({
      command: "account_lines",
      account: destination,
      peer: config.tokenIssuer,
      ledger_index: "validated",
    });
    return (lines.result.lines ?? []).some(
      (line) =>
        line.currency === config.tokenAddress &&
        Number(line.limit) > 0,
    );
  } catch {
    return false;
  }
}

/**
 * Exact-out AMM quote: XRP in to deliver `deliverRlusd` RLUSD out.
 * trading_fee is in 1/100_000 units (501 ≈ 0.501%).
 */
function xrpDropsForExactRlusd(args: {
  poolXrpDrops: bigint;
  poolRlusd: number;
  tradingFee: number;
  deliverRlusd: number;
}): string | null {
  const { poolXrpDrops, poolRlusd, tradingFee, deliverRlusd } = args;
  if (
    !(poolRlusd > deliverRlusd) ||
    !(deliverRlusd > 0) ||
    poolXrpDrops <= 0n
  ) {
    return null;
  }
  const feeFactor = (100_000 - tradingFee) / 100_000;
  if (!(feeFactor > 0)) return null;

  const rIn = Number(poolXrpDrops);
  const xrpInDrops =
    (deliverRlusd * rIn) / (feeFactor * (poolRlusd - deliverRlusd));
  if (!Number.isFinite(xrpInDrops) || xrpInDrops <= 0) return null;

  // Round up to whole drops
  const drops = BigInt(Math.ceil(xrpInDrops));
  return drops < 1n ? "1" : drops.toString();
}

async function quoteViaAmm(
  client: Client,
  deliver: string,
  destination: string,
): Promise<XrpRlusdQuote | XrpRlusdQuoteFail> {
  let amm;
  try {
    amm = await client.request({
      command: "amm_info",
      asset: { currency: "XRP" },
      asset2: {
        currency: config.tokenAddress,
        issuer: config.tokenIssuer,
      },
    });
  } catch {
    return {
      ok: false,
      reason: "No XRP/RLUSD AMM on this network",
    };
  }

  const pool = amm.result.amm;
  const amount = pool?.amount;
  const amount2 = pool?.amount2;
  if (typeof amount !== "string" || !amount2 || typeof amount2 !== "object") {
    return { ok: false, reason: "Malformed AMM pool" };
  }

  const poolXrpDrops = BigInt(amount);
  const poolRlusd = Number(
    "value" in amount2 ? String(amount2.value) : NaN,
  );
  const tradingFee =
    typeof pool.trading_fee === "number" ? pool.trading_fee : 0;
  const deliverN = Number(deliver);
  const drops = xrpDropsForExactRlusd({
    poolXrpDrops,
    poolRlusd,
    tradingFee,
    deliverRlusd: deliverN,
  });

  if (!drops) {
    return {
      ok: false,
      reason: "AMM liquidity too thin for this RLUSD amount",
    };
  }

  return buildQuote({
    deliver,
    destination,
    drops,
    paths: defaultAmmPaths(),
    source: "amm",
  });
}

async function quoteViaPathFind(
  client: Client,
  deliver: string,
  destination: string,
  source: string,
): Promise<XrpRlusdQuote | null> {
  try {
    const result = await client.request({
      command: "ripple_path_find",
      source_account: source,
      destination_account: destination,
      destination_amount: rlusdAmount(deliver),
      source_currencies: [{ currency: "XRP" }],
    });

    const alt = result.result.alternatives?.[0];
    if (!alt?.source_amount) return null;

    const sourceAmount = alt.source_amount;
    const drops =
      typeof sourceAmount === "string"
        ? sourceAmount
        : xrpToDrops(
            typeof sourceAmount === "object" &&
              sourceAmount &&
              "value" in sourceAmount
              ? String((sourceAmount as { value: string }).value)
              : "0",
          );

    if (!drops || drops === "0") return null;

    const paths = (alt.paths_computed ?? []) as Path[];
    return buildQuote({
      deliver,
      destination,
      drops: String(drops),
      paths: paths.length > 0 ? paths : defaultAmmPaths(),
      source: "path_find",
    });
  } catch {
    return null;
  }
}

/**
 * Quote XRP needed to deliver an exact RLUSD amount to destination via DEX/AMM.
 *
 * Prefer `ripple_path_find`, but fall back to AMM pool math when path_find
 * returns empty — common when the probe source account holds less XRP than
 * the quote needs (path_find filters on source balance).
 */
export async function quoteXrpForRlusd(args: {
  deliverRlusd: string;
  destination: string;
  /** Optional source for path_find; defaults to destination. */
  sourceAccount?: string;
}): Promise<XrpRlusdQuote | XrpRlusdQuoteFail> {
  const destination = args.destination.trim();
  if (!isValidClassicAddress(destination)) {
    return { ok: false, reason: "Invalid merchant address" };
  }

  let deliver: string;
  try {
    deliver = toPaymentAmount(args.deliverRlusd, 1);
  } catch {
    return { ok: false, reason: "Invalid RLUSD amount" };
  }

  const source =
    args.sourceAccount?.trim() && isValidClassicAddress(args.sourceAccount.trim())
      ? args.sourceAccount.trim()
      : destination;

  const client = new Client(config.wsUrl);
  try {
    await client.connect();

    const canHold = await destinationCanHoldRlusd(client, destination);
    if (!canHold) {
      return {
        ok: false,
        reason: "Merchant needs an RLUSD trust line (TrustSet)",
      };
    }

    const fromPath = await quoteViaPathFind(
      client,
      deliver,
      destination,
      source,
    );
    if (fromPath) return fromPath;

    // path_find often empty when source XRP < quote size; AMM still works.
    return await quoteViaAmm(client, deliver, destination);
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "quote failed";
    return { ok: false, reason };
  } finally {
    await client.disconnect().catch(() => undefined);
  }
}

function extractDeliveredRlusd(
  meta: TransactionMetadata | undefined,
  fallback: string,
): string {
  if (!meta || typeof meta !== "object") return fallback;
  const delivered = (meta as { delivered_amount?: unknown }).delivered_amount;
  if (
    delivered &&
    typeof delivered === "object" &&
    "value" in delivered &&
    "currency" in delivered
  ) {
    return String((delivered as { value: string }).value);
  }
  return fallback;
}

function extractSentXrp(
  meta: TransactionMetadata | undefined,
  account: string,
  fallbackDrops: string,
): string {
  if (!meta || typeof meta !== "object") {
    return dropsToDisplay(fallbackDrops);
  }
  const nodes = (meta as { AffectedNodes?: unknown[] }).AffectedNodes;
  if (!Array.isArray(nodes)) return dropsToDisplay(fallbackDrops);

  for (const raw of nodes) {
    if (!raw || typeof raw !== "object") continue;
    const mod =
      (raw as { ModifiedNode?: Record<string, unknown> }).ModifiedNode ||
      (raw as { DeletedNode?: Record<string, unknown> }).DeletedNode;
    if (!mod || mod.LedgerEntryType !== "AccountRoot") continue;
    const finalFields = mod.FinalFields as
      | { Account?: string; Balance?: string }
      | undefined;
    const prevFields = mod.PreviousFields as { Balance?: string } | undefined;
    if (finalFields?.Account !== account) continue;
    if (finalFields.Balance != null && prevFields?.Balance != null) {
      const before = BigInt(prevFields.Balance);
      const after = BigInt(finalFields.Balance);
      if (before > after) {
        return dropsToDisplay((before - after).toString());
      }
    }
  }
  return dropsToDisplay(fallbackDrops);
}

/**
 * Pay exact RLUSD to destination by spending XRP (cross-currency via AMM/DEX).
 */
export async function payRlusdWithXrp(args: {
  seed: string;
  destination: string;
  deliverRlusd: string;
  /** Optional precomputed quote; refreshed if missing/expired. */
  quote?: XrpRlusdQuote;
}): Promise<CrossCurrencyReceipt | CrossCurrencyFail> {
  const destination = args.destination.trim();
  if (!isValidClassicAddress(destination)) {
    return { ok: false, reason: "Invalid merchant address" };
  }

  let wallet: Wallet;
  try {
    wallet = Wallet.fromSeed(args.seed.trim());
  } catch {
    return { ok: false, reason: "Invalid XRPL_BUYER_SEED" };
  }

  let quote = args.quote;
  if (
    !quote ||
    quote.expiresAt < Date.now() ||
    quote.destination !== destination
  ) {
    const fresh = await quoteXrpForRlusd({
      deliverRlusd: args.deliverRlusd,
      destination,
      sourceAccount: wallet.classicAddress,
    });
    if (!fresh.ok) return fresh;
    quote = fresh;
  }

  const client = new Client(config.wsUrl);
  try {
    await client.connect();

    const paths =
      quote.paths.length > 0 ? quote.paths : defaultAmmPaths();

    const tx: Payment = {
      TransactionType: "Payment",
      Account: wallet.classicAddress,
      Destination: destination,
      Amount: rlusdAmount(quote.deliverRlusd),
      SendMax: quote.sendMaxDrops,
      Paths: paths,
      SourceTag: XRPL_SOURCE_TAG,
    };

    const prepared = await client.autofill(tx);
    const signed = wallet.sign(prepared);
    const submitted = await client.submitAndWait(signed.tx_blob);

    const meta = submitted.result.meta as TransactionMetadata | undefined;
    const code =
      meta && typeof meta === "object" && "TransactionResult" in meta
        ? String(meta.TransactionResult)
        : "unknown";

    if (code !== "tesSUCCESS") {
      return {
        ok: false,
        reason: `Cross-currency Payment failed: ${code}`,
      };
    }

    const txHash = submitted.result.hash;
    const deliveredRlusd = extractDeliveredRlusd(meta, quote.deliverRlusd);
    const sentXrp = extractSentXrp(
      meta,
      wallet.classicAddress,
      quote.dropsToSend,
    );

    return {
      ok: true,
      txHash,
      explorerUrl: explorerTx(txHash),
      deliveredRlusd,
      sentXrp,
      payer: wallet.classicAddress,
    };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "cross-currency settle failed";
    return { ok: false, reason };
  } finally {
    await client.disconnect().catch(() => undefined);
  }
}

/** @internal exported for tests / buffering docs */
export const CROSS_CURRENCY_SEND_MAX_BUFFER = SEND_MAX_BUFFER;
