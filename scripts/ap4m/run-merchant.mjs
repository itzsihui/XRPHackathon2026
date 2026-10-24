#!/usr/bin/env node
/**
 * Local AP4M x402 Merchant (fixed price). Needs Merchant ID + payout from the portal,
 * plus a submitter key with XRP gas to redeem vouchers on-chain.
 *
 * Usage:
 *   node --env-file=.env.local scripts/ap4m/run-merchant.mjs
 *   # then: node --env-file=.env.local scripts/ap4m/buy-resource.mjs --url http://127.0.0.1:8787/resource
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ethers } from 'ethers';
import { loadX402Context, createX402Merchant } from '../../lib/ap4m/ap4m-x402.mjs';

const API = process.env.AP4M_API_URL || 'https://hackathon.ap4m.build';
const RPC = process.env.AP4M_RPC_URL || 'https://rpc.testnet.xrplevm.org';
const PORT = Number(process.env.AP4M_MERCHANT_PORT || 8787);
const RESOURCE_URL = process.env.AP4M_RESOURCE_URL || `http://127.0.0.1:${PORT}/resource`;
const MERCHANT_ID = process.env.AP4M_MERCHANT_ID;
const PAYOUT = process.env.AP4M_MERCHANT_PAYOUT;
const SUBMITTER_KEY = process.env.AP4M_MERCHANT_SUBMITTER_KEY || process.env.AP4M_AGENT_PRIVATE_KEY || process.env.AGENT_PRIVATE_KEY;
const PRICE_RLUSD = process.env.AP4M_RESOURCE_PRICE_RLUSD || '0.1';

async function main() {
  if (!MERCHANT_ID || MERCHANT_ID === 'Pending') {
    throw new Error('Set AP4M_MERCHANT_ID from the portal (finish Merchant payout first)');
  }
  if (!PAYOUT) throw new Error('Set AP4M_MERCHANT_PAYOUT (pool or your payout wallet from the portal)');
  if (!SUBMITTER_KEY) throw new Error('Set AP4M_MERCHANT_SUBMITTER_KEY (funded wallet that pays gas for redemptions)');

  const provider = new ethers.JsonRpcProvider(RPC);
  const submitter = new ethers.Wallet(SUBMITTER_KEY, provider);
  const context = await loadX402Context(API);
  const amount = ethers.parseUnits(PRICE_RLUSD, 18).toString();
  const stateDirectory = join(process.cwd(), '.ap4m', 'merchant-state');
  mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });

  const { server, close } = createX402Merchant({
    context,
    provider,
    submitter,
    stateDirectory,
    resourceUrl: RESOURCE_URL,
    merchantParticipantId: MERCHANT_ID,
    payout: PAYOUT,
    amount,
    content: {
      sku: 'borneo-ap4m-demo',
      title: 'Borneo demo resource',
      priceRlusd: PRICE_RLUSD,
      paidAt: new Date().toISOString(),
    },
  });

  await new Promise((resolve, reject) => {
    server.listen(PORT, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  console.log(`Merchant listening: ${RESOURCE_URL}`);
  console.log(`Price: ${PRICE_RLUSD} RLUSD · merchant ${MERCHANT_ID} · payout ${PAYOUT}`);
  console.log('Submitter:', submitter.address);

  const shutdown = async () => {
    console.log('\nClosing merchant…');
    await close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
