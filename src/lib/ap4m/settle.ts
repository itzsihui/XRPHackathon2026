import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ethers } from "ethers";

const require = createRequire(import.meta.url);
const sdk = require("../../../lib/ap4m/ap4m-hackathon-sdk.cjs") as {
  getChannelState: (
    provider: ethers.Provider,
    ledgerAddress: string,
    channelId: string,
  ) => Promise<{
    cap: bigint;
    redeemed: bigint;
    validBefore: bigint;
    status: number;
  }>;
  redeemVoucher: (
    wallet: ethers.Wallet,
    ledgerAddress: string,
    rpcUrl: string,
    channelId: string,
    cumulativeAmount: bigint,
  ) => Promise<{ claimId: string | null; txHash: string }>;
};

const API = () => process.env.AP4M_API_URL || "https://hackathon.ap4m.build";
const RPC = () => process.env.AP4M_RPC_URL || "https://rpc.testnet.xrplevm.org";
const EXPLORER =
  process.env.AP4M_EXPLORER_BASE || "https://explorer.testnet.xrplevm.org";

type PublicConfig = {
  contracts?: { paymentLedger?: string };
  network?: { rpcUrl?: string; explorerUrl?: string };
};

async function loadLedgerAddress(): Promise<{
  ledger: string;
  rpcUrl: string;
  explorerUrl: string;
}> {
  const resp = await fetch(`${API()}/public/config`, {
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await resp.json()) as PublicConfig;
  if (!resp.ok) {
    throw new Error(`AP4M config unavailable (${resp.status})`);
  }
  const ledger = data.contracts?.paymentLedger;
  if (!ledger) throw new Error("AP4M paymentLedger missing from public config");
  return {
    ledger,
    rpcUrl: data.network?.rpcUrl || RPC(),
    explorerUrl: data.network?.explorerUrl || EXPLORER,
  };
}

function agentKey(): string {
  const key =
    process.env.AP4M_AGENT_PRIVATE_KEY?.trim() ||
    process.env.AGENT_PRIVATE_KEY?.trim();
  if (!key) {
    throw new Error(
      "AP4M_AGENT_PRIVATE_KEY missing — Mastercard channel rail needs the agent wallet key",
    );
  }
  return key.startsWith("0x") ? key : `0x${key}`;
}

function channelId(): string {
  const id = process.env.AP4M_CHANNEL_ID?.trim();
  if (!id || !/^0x[0-9a-fA-F]{64}$/.test(id)) {
    throw new Error(
      "AP4M_CHANNEL_ID missing — run npm run ap4m:channel after portal setup",
    );
  }
  return id.toLowerCase();
}

/** Persist last known cumulative for idempotent retries of the same operation. */
function settleDir() {
  const dir = join(process.cwd(), ".ap4m", "borneo-settle");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function statePath() {
  return join(settleDir(), "last.json");
}

export type Ap4mSettleResult = {
  ok: true;
  claimId: string | null;
  txHash: string;
  explorerUrl: string;
  cumulativeRlusd: string;
  amountRlusd: string;
  channelId: string;
  operation: string;
};

/**
 * Settle one Borneo purchase on the open Mastercard AP4M payment Channel
 * by redeeming a cumulative RLUSD voucher (XRPL EVM Testnet).
 */
export async function settleAp4mPurchase(args: {
  amountRlusd: string;
  operation: string;
  storeSlug?: string;
  skuId?: string;
}): Promise<Ap4mSettleResult> {
  const amount = Number(args.amountRlusd);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("amount must be a positive RLUSD value");
  }
  if (!/^[a-z0-9][a-z0-9._:-]{0,80}$/i.test(args.operation)) {
    throw new Error("invalid settle operation name");
  }

  const { ledger, rpcUrl, explorerUrl } = await loadLedgerAddress();
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(agentKey(), provider);
  const ch = channelId();

  const archived = join(settleDir(), `op-${args.operation}.json`);
  try {
    const prior = JSON.parse(readFileSync(archived, "utf8")) as Ap4mSettleResult;
    if (prior?.ok && prior.txHash) return prior;
  } catch {
    /* first attempt */
  }

  const onChain = await sdk.getChannelState(provider, ledger, ch);
  if (onChain.status !== 1) {
    throw new Error(`AP4M channel is not open (status=${onChain.status})`);
  }

  const delta = ethers.parseUnits(String(args.amountRlusd), 18);
  const cumulative = onChain.redeemed + delta;
  if (cumulative > onChain.cap) {
    const remaining = ethers.formatUnits(onChain.cap - onChain.redeemed, 18);
    throw new Error(
      `Channel cap exceeded: need ${args.amountRlusd} RLUSD but only ${remaining} remaining (cap ${ethers.formatUnits(onChain.cap, 18)}). Raise AP4M_CHANNEL_CAP_RLUSD and reopen, or buy a cheaper SKU.`,
    );
  }

  const { claimId, txHash } = await sdk.redeemVoucher(
    wallet,
    ledger,
    rpcUrl,
    ch,
    cumulative,
  );

  const result: Ap4mSettleResult = {
    ok: true,
    claimId,
    txHash,
    explorerUrl: `${explorerUrl.replace(/\/$/, "")}/tx/${txHash}`,
    cumulativeRlusd: ethers.formatUnits(cumulative, 18),
    amountRlusd: String(args.amountRlusd),
    channelId: ch,
    operation: args.operation,
  };

  writeFileSync(archived, `${JSON.stringify(result)}\n`, { mode: 0o600 });
  writeFileSync(statePath(), `${JSON.stringify({ ...result, at: new Date().toISOString() })}\n`, {
    mode: 0o600,
  });
  return result;
}
