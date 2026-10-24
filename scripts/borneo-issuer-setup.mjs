#!/usr/bin/env node
/**
 * Create + fund the Borneo credential issuer wallet on XRPL Testnet.
 *
 *   node scripts/borneo-issuer-setup.mjs
 *
 * Prints BORNEO_ISSUER_SEED / BORNEO_ISSUER_ADDRESS for .env.
 * Reuses an existing BORNEO_ISSUER_SEED (just tops up / checks) when set.
 */
import { Client, Wallet } from "xrpl";

const WS = process.env.XRPL_WS_URL || "wss://s.altnet.rippletest.net:51233";

const client = new Client(WS);
await client.connect();
try {
  const existing = process.env.BORNEO_ISSUER_SEED?.trim();
  const wallet = existing ? Wallet.fromSeed(existing) : Wallet.generate();
  console.log(`Funding ${wallet.classicAddress} from the testnet faucet…`);
  const { balance } = await client.fundWallet(wallet);
  console.log(`Balance: ${balance} XRP\n`);
  console.log("Add to .env (never commit real seeds):\n");
  if (!existing) console.log(`BORNEO_ISSUER_SEED=${wallet.seed}`);
  console.log(`BORNEO_ISSUER_ADDRESS=${wallet.classicAddress}`);
} finally {
  await client.disconnect();
}
