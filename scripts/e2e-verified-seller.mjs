#!/usr/bin/env node
/**
 * End-to-end: fund merchant → RLUSD trust → publish → issue → accept → DID → verify.
 * Prints addresses/hashes only — never the seed.
 *
 *   node --env-file=.env.local scripts/e2e-verified-seller.mjs
 */
import xrpl from "xrpl";
import { sign as signHex } from "ripple-keypairs";

const { Client, Wallet } = xrpl;

const ORIGIN = process.env.E2E_ORIGIN || "http://localhost:3000";
const WS = process.env.XRPL_WS_URL || "wss://s.altnet.rippletest.net:51233";
const NETWORK = process.env.XRPL_NETWORK || "xrpl:1";
const TOKEN_ISSUER =
  process.env.TOKEN_ISSUER || "rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV";
const TOKEN_ADDRESS =
  process.env.TOKEN_ADDRESS || "524C555344000000000000000000000000000000";
const ISSUER_ADDR = process.env.BORNEO_ISSUER_ADDRESS;

function messageToHex(message) {
  return Buffer.from(message, "utf8").toString("hex").toUpperCase();
}

function authProof(wallet) {
  const address = wallet.classicAddress;
  const message = [
    "Borneo — merchant wallet authentication",
    "",
    "Sign this message to prove you control the payout address for XRPL x402.",
    "This does not move funds or submit a ledger transaction.",
    "",
    `Address: ${address}`,
    `Network: ${NETWORK} (XRPL Testnet)`,
    `Issued at: ${new Date().toISOString()}`,
  ].join("\n");
  return {
    address,
    publicKey: wallet.publicKey,
    message,
    signature: signHex(messageToHex(message), wallet.privateKey),
    network: NETWORK,
    authenticatedAt: new Date().toISOString(),
  };
}

async function api(path, init) {
  const res = await fetch(`${ORIGIN}${path}`, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `${path} → HTTP ${res.status}: ${data.error || JSON.stringify(data)}`,
    );
  }
  return data;
}

const client = new Client(WS);
await client.connect();
const wallet = Wallet.generate();
console.log(`Merchant address: ${wallet.classicAddress}`);
console.log("Funding from testnet faucet…");
const { balance } = await client.fundWallet(wallet);
console.log(`Funded: ${balance} XRP`);

console.log("Setting RLUSD trust line…");
const trust = await client.autofill({
  TransactionType: "TrustSet",
  Account: wallet.classicAddress,
  LimitAmount: {
    currency: TOKEN_ADDRESS,
    issuer: TOKEN_ISSUER,
    value: "1000000",
  },
});
const signedTrust = wallet.sign(trust);
const trustRes = await client.submitAndWait(signedTrust.tx_blob);
const trustCode =
  typeof trustRes.result.meta === "object" &&
  trustRes.result.meta &&
  "TransactionResult" in trustRes.result.meta
    ? trustRes.result.meta.TransactionResult
    : "unknown";
if (trustCode !== "tesSUCCESS") {
  throw new Error(`TrustSet failed: ${trustCode}`);
}
console.log(`TrustSet OK: ${trustRes.result.hash}`);
await client.disconnect();

const ownership = {
  merchantAuth: authProof(wallet),
  boundWalletAddress: wallet.classicAddress,
  ownerUid: `e2e-${wallet.classicAddress.slice(0, 8)}`,
  merchantDisplayName: "E2E Verified Seller",
  visaReceive: { accountLabel: "E2E Demo Visa Account" },
  listOnMarket: true,
};

console.log("Loading inventory CSV…");
const loaded = await api("/api/merchant-agent", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    ...ownership,
    csv: [
      "title,description,quantity,price,subcategory,style,color,size,fit,material",
      "Navy Tee,Plain navy cotton tee for e2e verified seller,3,5,tops,Tee,Navy,M,Regular,Cotton",
    ].join("\n"),
  }),
});
if (!loaded.draft?.lines?.length) {
  throw new Error(
    `CSV load failed: ${loaded.status} — ${loaded.reply || JSON.stringify(loaded)}`,
  );
}
const draft = {
  ...loaded.draft,
  lines: loaded.draft.lines.map((l) => ({ ...l, price: l.price || "5" })),
};
console.log(`Publishing ${draft.lines.length} priced line(s)…`);
const published = await api("/api/merchant-agent", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ ...ownership, draft }),
});
if (published.status !== "published" || !published.store) {
  throw new Error(
    `Publish failed: ${published.status} — ${published.reply || JSON.stringify(published)}`,
  );
}
console.log(
  `Published /s/${published.store.slug} payTo=${published.store.merchantAddress}`,
);
if (published.store.merchantAddress !== wallet.classicAddress) {
  throw new Error(
    `Expected payTo to be bound wallet; got ${published.store.merchantAddress}`,
  );
}

console.log("Issuing credential…");
const issued = await api("/api/seller-verification", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ action: "issue", proof: authProof(wallet) }),
});
console.log(
  `Issue status=${issued.verification?.status} receipts=${issued.receipts?.length ?? 0}`,
);
for (const r of issued.receipts ?? []) {
  console.log(`  ${r.type} ${r.result} ${r.hash}`);
}

console.log("Preparing + signing merchant txs…");
const prepared = await api("/api/seller-verification", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    action: "prepare",
    address: wallet.classicAddress,
  }),
});
console.log(`Prepared ${prepared.txs?.length ?? 0} tx(s)`);
if ((prepared.txs?.length ?? 0) > 0) {
  const txBlobs = prepared.txs.map((tx) => wallet.sign(tx).tx_blob);
  const submitted = await api("/api/seller-verification", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "submit",
      address: wallet.classicAddress,
      txBlobs,
    }),
  });
  console.log(`Submit status=${submitted.verification?.status}`);
  for (const r of submitted.receipts ?? []) {
    console.log(`  ${r.type} ${r.result} ${r.hash}`);
  }
}

const check = await api(
  `/api/seller-verification?address=${wallet.classicAddress}&fresh=1`,
);
console.log(
  `Final API status=${check.verification?.status} onLedger=${check.verification?.onLedger} didLinked=${check.verification?.didLinked}`,
);

if (!ISSUER_ADDR) {
  console.warn("BORNEO_ISSUER_ADDRESS missing — skip verify-seller.mjs");
  process.exit(check.verification?.status === "verified" ? 0 : 1);
}

const { spawnSync } = await import("node:child_process");
const v = spawnSync(
  "node",
  ["scripts/verify-seller.mjs", wallet.classicAddress, ISSUER_ADDR],
  { encoding: "utf8", env: process.env },
);
process.stdout.write(v.stdout || "");
process.stderr.write(v.stderr || "");
process.exit(v.status ?? 1);
