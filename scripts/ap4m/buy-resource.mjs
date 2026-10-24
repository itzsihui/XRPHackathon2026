#!/usr/bin/env node
/**
 * Buy one x402 resource over an open AP4M Channel.
 *
 * Usage:
 *   node --env-file=.env.local scripts/ap4m/buy-resource.mjs \
 *     --url http://127.0.0.1:8787/resource \
 *     --op demo-1 \
 *     --max 1
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ethers } from 'ethers';
import { loadX402Context, buyResource } from '../../lib/ap4m/ap4m-x402.mjs';

const API = process.env.AP4M_API_URL || 'https://hackathon.ap4m.build';
const AGENT_KEY = process.env.AP4M_AGENT_PRIVATE_KEY || process.env.AGENT_PRIVATE_KEY;
const CHANNEL_ID = process.env.AP4M_CHANNEL_ID;
const RPC = process.env.AP4M_RPC_URL || 'https://rpc.testnet.xrplevm.org';

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  if (!AGENT_KEY) throw new Error('Set AP4M_AGENT_PRIVATE_KEY');
  if (!CHANNEL_ID) throw new Error('Set AP4M_CHANNEL_ID (run scripts/ap4m/open-channel.mjs first)');

  const resourceUrl = argValue('--url', process.env.AP4M_RESOURCE_URL);
  if (!resourceUrl) throw new Error('Pass --url <merchant /resource URL> or set AP4M_RESOURCE_URL');

  const operation = argValue('--op', `buy-${Date.now()}`);
  const maxRlusd = argValue('--max', '1');
  const maximumAmount = ethers.parseUnits(maxRlusd, 18).toString();

  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(AGENT_KEY, provider);
  const context = await loadX402Context(API);
  const stateDirectory = join(process.cwd(), '.ap4m', 'agent-state');
  mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });

  console.log('Buying', resourceUrl, 'op=', operation, 'max=', maxRlusd, 'RLUSD');
  const result = await buyResource({
    context,
    provider,
    wallet,
    stateDirectory,
    resourceUrl,
    channelId: CHANNEL_ID,
    maximumAmount,
    operation,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
