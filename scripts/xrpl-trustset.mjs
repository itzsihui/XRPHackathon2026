#!/usr/bin/env node
/**
 * One-shot TrustSet for testnet RLUSD.
 *
 * Plain `node` breaks on xrpl's ESM deps (ERR_REQUIRE_ESM). Use tsx:
 *
 *   npx tsx scripts/xrpl-trustset.mjs --seed sEd...
 *   npm run trustset -- --seed sEd...
 */
import { Client, Wallet } from "xrpl";

const RLUSD = "524C555344000000000000000000000000000000";
const ISSUER = process.env.TOKEN_ISSUER || "rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV";
const WS = process.env.XRPL_WS_URL || "wss://s.altnet.rippletest.net:51233";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const seed = arg("--seed") || process.env.XRPL_BUYER_SEED;
if (!seed) {
  console.error("Pass --seed s... or set XRPL_BUYER_SEED");
  process.exit(1);
}

const wallet = Wallet.fromSeed(seed.trim());
console.log("TrustSet RLUSD for", wallet.classicAddress);

const client = new Client(WS);
await client.connect();
try {
  const prepared = await client.autofill({
    TransactionType: "TrustSet",
    Account: wallet.classicAddress,
    LimitAmount: {
      currency: RLUSD,
      issuer: ISSUER,
      value: "1000000",
    },
  });
  const signed = wallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);
  const meta = result.result.meta;
  const code =
    meta && typeof meta === "object" && "TransactionResult" in meta
      ? meta.TransactionResult
      : "unknown";
  console.log(code);
  console.log("hash", result.result.hash);
  console.log("explorer", `https://testnet.xrpl.org/transactions/${result.result.hash}`);
  if (code !== "tesSUCCESS") process.exit(1);
} finally {
  await client.disconnect();
}
