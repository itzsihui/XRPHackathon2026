/**
 * Server-side: Borneo verified-seller credentials (XLS-70) + merchant DID (XLS-40).
 *
 * Flow
 *  1. Borneo (issuer, BORNEO_ISSUER_SEED) submits CredentialCreate → merchant payTo.
 *  2. Merchant signs CredentialAccept + DIDSet in the browser (seed never leaves it);
 *     Borneo only relays the signed blobs after checking they are exactly those txs.
 *  3. Anyone verifies with two `ledger_entry` calls against any XRPL node.
 *
 * Reads use plain JSON-RPC (config.rpcUrl) so they work from serverless handlers;
 * writes use the xrpl.js websocket Client (config.wsUrl).
 */
import {
  Client,
  Wallet,
  convertHexToString,
  convertStringToHex,
  decode,
  isValidClassicAddress,
  isoTimeToRippleTime,
  rippleTimeToISOTime,
  type CredentialAccept,
  type CredentialCreate,
  type CredentialDelete,
  type DIDSet,
  type TxResponse,
} from "xrpl";
import { config, explorerTx } from "@/lib/config";
import {
  LSF_CREDENTIAL_ACCEPTED,
  SELLER_CREDENTIAL_TYPE,
  SELLER_DID_DATA,
  sellerDidDocPath,
  type SellerVerification,
} from "@/lib/xrpl/seller-verification-types";

const CACHE_TTL_MS = 30_000;
const CREDENTIAL_TTL_DAYS = 365;
/** Ledgers of slack so the merchant has time to sign in the browser (~4–5 min). */
const MERCHANT_SIGN_WINDOW_LEDGERS = 75;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export function credentialTypeHex() {
  return convertStringToHex(SELLER_CREDENTIAL_TYPE).toUpperCase();
}

function issuerWallet(): Wallet | null {
  const raw = process.env.BORNEO_ISSUER_SEED?.trim().replace(/^["']|["']$/g, "");
  if (!raw) return null;
  try {
    return Wallet.fromSeed(raw);
  } catch {
    return null;
  }
}

/**
 * Borneo issuer classic address. BORNEO_ISSUER_ADDRESS lets read-only
 * deployments verify without holding the issuer seed.
 */
export function issuerAddress(): string | null {
  const explicit = process.env.BORNEO_ISSUER_ADDRESS?.trim();
  if (explicit && isValidClassicAddress(explicit)) return explicit;
  return issuerWallet()?.classicAddress ?? null;
}

export function issuerConfigured() {
  return issuerAddress() !== null;
}

/** "xrpl:1" → "1" (used in did:xrpl:{id}:{address}). */
function networkId() {
  return config.network.split(":")[1] ?? "1";
}

export function didFor(address: string) {
  return `did:xrpl:${networkId()}:${address}`;
}

// ---------------------------------------------------------------------------
// JSON-RPC reads
// ---------------------------------------------------------------------------

type RpcResult<T> = T & { error?: string; error_message?: string; status?: string };

async function rpc<T>(method: string, params: Record<string, unknown>) {
  const res = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, params: [params] }),
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`XRPL ${method} HTTP ${res.status}`);
  const body = (await res.json()) as { result?: RpcResult<T> };
  if (!body.result) throw new Error(`XRPL ${method}: empty result`);
  return body.result;
}

async function ledgerEntry<T>(params: Record<string, unknown>) {
  const result = await rpc<{ node?: T; index?: string }>("ledger_entry", {
    ...params,
    ledger_index: "validated",
  });
  if (result.error === "entryNotFound") return null;
  if (result.error) {
    throw new Error(`ledger_entry: ${result.error_message || result.error}`);
  }
  return result.node ? { node: result.node, index: result.index } : null;
}

type CredentialNode = {
  Flags: number;
  Subject: string;
  Issuer: string;
  CredentialType: string;
  Expiration?: number;
  URI?: string;
};

type DidNode = { Account: string; URI?: string; Data?: string };

function hexToText(hex?: string | null) {
  if (!hex) return null;
  try {
    return convertHexToString(hex);
  } catch {
    return null;
  }
}

/** Does the account hold a trust line for the configured RLUSD issuer/currency? */
export async function hasRlusdTrustLine(address: string): Promise<boolean> {
  if (!isValidClassicAddress(address)) return false;
  try {
    const result = await rpc<{ lines?: { currency: string }[] }>("account_lines", {
      account: address,
      peer: config.tokenIssuer,
      ledger_index: "validated",
    });
    if (result.error) return false;
    const want = config.tokenAddress.toUpperCase();
    return (result.lines ?? []).some(
      (l) => l.currency.toUpperCase() === want || l.currency === config.tokenSymbol,
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Verification (public, cached)
// ---------------------------------------------------------------------------

const cache = new Map<string, { at: number; value: SellerVerification }>();

function invalidate(address: string) {
  cache.delete(address);
}

function base(address: string): SellerVerification {
  return {
    address,
    status: "unverified",
    onLedger: false,
    issuer: issuerAddress(),
    credentialType: SELLER_CREDENTIAL_TYPE,
    credentialTypeHex: credentialTypeHex(),
    did: null,
    didLinked: false,
    network: config.network,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Read the merchant's Borneo credential + DID straight from the validated ledger.
 * Never throws — ledger errors come back as status "unverified" with a reason.
 */
export async function verifySellerOnLedger(
  address: string,
  opts?: { fresh?: boolean },
): Promise<SellerVerification> {
  const hit = cache.get(address);
  if (!opts?.fresh && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const out = base(address);
  if (!isValidClassicAddress(address)) {
    return { ...out, reason: "invalid_address" };
  }

  try {
    const issuer = out.issuer;
    const [cred, did] = await Promise.all([
      issuer
        ? ledgerEntry<CredentialNode>({
            credential: {
              subject: address,
              issuer,
              credential_type: out.credentialTypeHex,
            },
          })
        : Promise.resolve(null),
      ledgerEntry<DidNode>({ did: address }),
    ]);

    if (did) {
      const uri = hexToText(did.node.URI);
      out.did = { id: didFor(address), uri, data: hexToText(did.node.Data) };
      out.didLinked = Boolean(uri?.endsWith(sellerDidDocPath(address)));
    }

    if (!issuer) {
      out.reason = "issuer_not_configured";
    } else if (!cred) {
      out.reason = "no_credential";
    } else {
      out.credentialIndex = cred.index;
      out.expiresAt = cred.node.Expiration
        ? rippleTimeToISOTime(cred.node.Expiration)
        : null;
      const accepted = (cred.node.Flags & LSF_CREDENTIAL_ACCEPTED) !== 0;
      const expired =
        out.expiresAt != null && Date.parse(out.expiresAt) <= Date.now();
      if (expired) {
        out.status = "expired";
        out.reason = "credential_expired";
      } else if (!accepted) {
        out.status = "pending_accept";
        out.reason = "merchant_has_not_accepted";
      } else {
        out.status = "verified";
        out.onLedger = true;
      }
    }

    cache.set(address, { at: Date.now(), value: out });
    return out;
  } catch (error) {
    // Do not cache ledger failures — next request retries.
    const msg = error instanceof Error ? error.message : String(error);
    return { ...out, reason: `ledger_unreachable: ${msg}` };
  }
}

/** Batch verify (deduped, parallel, cached). */
export async function verifySellers(addresses: string[]) {
  const unique = [...new Set(addresses.filter(Boolean))];
  const rows = await Promise.all(unique.map((a) => verifySellerOnLedger(a)));
  return new Map(rows.map((r) => [r.address, r]));
}

/** Instructions any agent can follow to verify without trusting Borneo. */
export function verifierInfo() {
  const issuer = issuerAddress();
  return {
    standard: "XLS-70 Credentials + XLS-40 DID",
    network: config.network,
    rpcUrl: config.rpcUrl,
    issuer,
    issuerConfigured: issuer !== null,
    credentialType: SELLER_CREDENTIAL_TYPE,
    credentialTypeHex: credentialTypeHex(),
    acceptedFlag: `lsfAccepted (0x${LSF_CREDENTIAL_ACCEPTED.toString(16).padStart(8, "0")})`,
    howToVerify: [
      "Take the store's payTo address from agent.json (the address you will pay).",
      "POST ledger_entry to any XRPL node with credential {subject: payTo, issuer, credential_type: credentialTypeHex}.",
      "Verified = entry exists AND (Flags & 0x00010000) != 0 AND (no Expiration OR Expiration in the future).",
      "Optional: ledger_entry {did: payTo} — URI (hex) should resolve to /sellers/{payTo}/did.json listing this store.",
    ],
    exampleRequest: {
      method: "ledger_entry",
      params: [
        {
          credential: {
            subject: "<payTo>",
            issuer: issuer ?? "<borneo issuer>",
            credential_type: credentialTypeHex(),
          },
          ledger_index: "validated",
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client(config.wsUrl, { connectionTimeout: 10_000 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.disconnect().catch(() => undefined);
  }
}

function txResult(res: TxResponse) {
  const meta = res.result.meta;
  return typeof meta === "object" && meta && "TransactionResult" in meta
    ? String(meta.TransactionResult)
    : "unknown";
}

export type LedgerTxReceipt = {
  type: string;
  hash: string;
  result: string;
  explorerUrl: string;
};

/**
 * Borneo issues (or re-issues after expiry) the verified-seller credential.
 * Idempotent: returns early when one already exists and is live or pending.
 */
export async function issueSellerCredential(
  subject: string,
  origin: string,
): Promise<{ receipts: LedgerTxReceipt[]; verification: SellerVerification }> {
  const wallet = issuerWallet();
  if (!wallet) {
    throw new Error(
      "BORNEO_ISSUER_SEED is not set — run `node scripts/borneo-issuer-setup.mjs` and add it to .env.",
    );
  }
  if (!isValidClassicAddress(subject)) throw new Error("Invalid subject address");
  if (subject === wallet.classicAddress) {
    throw new Error("Issuer cannot verify itself");
  }

  const current = await verifySellerOnLedger(subject, { fresh: true });
  if (current.reason?.startsWith("ledger_unreachable")) {
    throw new Error(current.reason);
  }
  if (current.status === "verified" || current.status === "pending_accept") {
    return { receipts: [], verification: current };
  }

  const receipts: LedgerTxReceipt[] = [];
  await withClient(async (client) => {
    if (current.status === "expired") {
      const del: CredentialDelete = {
        TransactionType: "CredentialDelete",
        Account: wallet.classicAddress,
        Subject: subject,
        CredentialType: credentialTypeHex(),
      };
      const res = await client.submitAndWait(del, { wallet, autofill: true });
      receipts.push(receipt("CredentialDelete", res));
    }

    const uri = `${origin}/api/seller-verification?address=${subject}`;
    const create: CredentialCreate = {
      TransactionType: "CredentialCreate",
      Account: wallet.classicAddress,
      Subject: subject,
      CredentialType: credentialTypeHex(),
      Expiration: isoTimeToRippleTime(
        new Date(Date.now() + CREDENTIAL_TTL_DAYS * 86_400_000).toISOString(),
      ),
      ...(uri.length <= 256 ? { URI: convertStringToHex(uri) } : {}),
    };
    const res = await client.submitAndWait(create, { wallet, autofill: true });
    const r = receipt("CredentialCreate", res);
    receipts.push(r);
    if (r.result !== "tesSUCCESS") {
      throw new Error(`CredentialCreate failed: ${r.result}`);
    }
  });

  invalidate(subject);
  return {
    receipts,
    verification: await verifySellerOnLedger(subject, { fresh: true }),
  };
}

function receipt(type: string, res: TxResponse): LedgerTxReceipt {
  return {
    type,
    hash: res.result.hash,
    result: txResult(res),
    explorerUrl: explorerTx(res.result.hash),
  };
}

export type MerchantTx = CredentialAccept | DIDSet;

/**
 * Autofilled, unsigned txs the merchant must sign in the browser:
 * CredentialAccept (if pending) and DIDSet (if DID not linked yet).
 */
export async function prepareMerchantTxs(
  subject: string,
  origin: string,
): Promise<{ txs: MerchantTx[]; verification: SellerVerification }> {
  const issuer = issuerAddress();
  if (!issuer) throw new Error("Borneo issuer is not configured");
  const current = await verifySellerOnLedger(subject, { fresh: true });
  if (current.reason?.startsWith("ledger_unreachable")) {
    throw new Error(current.reason);
  }
  if (current.status === "unverified" || current.status === "expired") {
    throw new Error("Borneo has not issued a live credential to this address yet");
  }

  const drafts: MerchantTx[] = [];
  if (current.status === "pending_accept") {
    drafts.push({
      TransactionType: "CredentialAccept",
      Account: subject,
      Issuer: issuer,
      CredentialType: credentialTypeHex(),
    });
  }
  if (!current.didLinked) {
    drafts.push({
      TransactionType: "DIDSet",
      Account: subject,
      URI: convertStringToHex(`${origin}${sellerDidDocPath(subject)}`),
      Data: convertStringToHex(SELLER_DID_DATA),
    });
  }
  if (drafts.length === 0) return { txs: [], verification: current };

  const txs = await withClient(async (client) => {
    const filled: MerchantTx[] = [];
    for (const draft of drafts) {
      filled.push((await client.autofill(draft)) as MerchantTx);
    }
    // autofill reads the same account Sequence for each — chain them.
    const firstSeq = filled[0]!.Sequence!;
    const lastLedger =
      (await client.getLedgerIndex()) + MERCHANT_SIGN_WINDOW_LEDGERS;
    filled.forEach((tx, i) => {
      tx.Sequence = firstSeq + i;
      tx.LastLedgerSequence = lastLedger;
    });
    return filled;
  });

  return { txs, verification: current };
}

/**
 * Relay merchant-signed blobs. Only CredentialAccept (for our issuer + type)
 * and DIDSet (pointing at this merchant's Borneo seller doc) are accepted —
 * this endpoint is not an open transaction relay.
 */
export async function submitMerchantBlobs(
  subject: string,
  blobs: string[],
): Promise<{ receipts: LedgerTxReceipt[]; verification: SellerVerification }> {
  const issuer = issuerAddress();
  if (!issuer) throw new Error("Borneo issuer is not configured");
  if (!Array.isArray(blobs) || blobs.length === 0 || blobs.length > 2) {
    throw new Error("Expected 1–2 signed transaction blobs");
  }

  for (const blob of blobs) {
    let tx: Record<string, unknown>;
    try {
      tx = decode(blob) as Record<string, unknown>;
    } catch {
      throw new Error("Malformed tx blob");
    }
    if (tx.Account !== subject) throw new Error("Blob is not signed by this merchant");
    if (!tx.TxnSignature && !tx.Signers) throw new Error("Blob is not signed");
    if (tx.TransactionType === "CredentialAccept") {
      if (tx.Issuer !== issuer || String(tx.CredentialType).toUpperCase() !== credentialTypeHex()) {
        throw new Error("CredentialAccept must target the Borneo seller credential");
      }
    } else if (tx.TransactionType === "DIDSet") {
      const uri = hexToText(tx.URI as string | undefined);
      if (!uri?.endsWith(sellerDidDocPath(subject))) {
        throw new Error("DIDSet URI must point at this merchant's Borneo seller doc");
      }
    } else {
      throw new Error(`Transaction type ${String(tx.TransactionType)} is not allowed here`);
    }
  }

  const receipts = await withClient(async (client) => {
    const out: LedgerTxReceipt[] = [];
    for (const blob of blobs) {
      const type = String((decode(blob) as { TransactionType: string }).TransactionType);
      const res = await client.submitAndWait(blob);
      const r = receipt(type, res);
      out.push(r);
      if (r.result !== "tesSUCCESS") {
        throw new Error(`${type} failed: ${r.result}`);
      }
    }
    return out;
  });

  invalidate(subject);
  return {
    receipts,
    verification: await verifySellerOnLedger(subject, { fresh: true }),
  };
}
