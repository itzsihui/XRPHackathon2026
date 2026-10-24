#!/usr/bin/env node
/**
 * Sign in + open an AP4M payment Channel (Mastercard XRPL Hackathon).
 *
 * Prerequisites (participant portal https://hackathon.ap4m.build/participant):
 *   - Agent wallet registered
 *   - Merchant payout chosen (pool wallet OK) → Merchant ID not Pending
 *   - Budget deposited (organizer)
 *   - Agent funded with XRP gas (https://faucet.xrplevm.org — Testnet)
 *
 * Usage:
 *   node --env-file=.env.local scripts/ap4m/open-channel.mjs
 *   node --env-file=.env.local scripts/ap4m/open-channel.mjs --cap 5
 */
import sdk from '../../lib/ap4m/ap4m-hackathon-sdk.cjs';
import { ethers } from 'ethers';

const API = process.env.AP4M_API_URL || 'https://hackathon.ap4m.build';
const TEAM = process.env.AP4M_TEAM_NAME;
const AGENT_KEY = process.env.AP4M_AGENT_PRIVATE_KEY || process.env.AGENT_PRIVATE_KEY;
const MERCHANT_ID = process.env.AP4M_MERCHANT_ID || undefined;
const RPC = process.env.AP4M_RPC_URL || 'https://rpc.testnet.xrplevm.org';

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  if (!TEAM) throw new Error('Set AP4M_TEAM_NAME in .env.local (exact portal team name)');
  if (!AGENT_KEY) throw new Error('Set AP4M_AGENT_PRIVATE_KEY (Agent wallet private key — never commit it)');

  const capRlusd = argValue('--cap', process.env.AP4M_CHANNEL_CAP_RLUSD || '5');
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(AGENT_KEY, provider);

  console.log('API:', API);
  console.log('Team:', TEAM);
  console.log('Agent:', wallet.address);
  console.log('Cap:', capRlusd, 'RLUSD');
  if (MERCHANT_ID) console.log('Merchant:', MERCHANT_ID);

  const balance = await provider.getBalance(wallet.address);
  console.log('Agent XRP (gas):', ethers.formatEther(balance));
  if (balance === 0n) {
    throw new Error(
      `Agent has no XRP for gas. Fund ${wallet.address} on XRPL EVM Testnet:\n`
        + `  • https://faucet.xrplevm.org (pick Testnet, paste 0x address)\n`
        + `  • Telegram @XrplEvmFaucetBot → /faucet ${wallet.address}\n`
        + `  • (AP4M's listed faucet.testevm.ripple.com is currently offline)`,
    );
  }

  console.log('Signing in…');
  const session = await sdk.signIn(API, TEAM, wallet);
  console.log('Session OK (expires in', session.expiresInSeconds, 's)');

  const existing = await sdk.listChannels(API, session.token);
  const open = existing.find((c) => c.channel_status === 'open');
  if (open) {
    console.log('Reusing open channel:', open.channel_id);
    console.log(JSON.stringify(open, null, 2));
    return;
  }

  console.log('Requesting channel…');
  const channel = await sdk.requestChannel(API, session.token, wallet, {
    capRlusd,
    merchantId: MERCHANT_ID,
    rpcUrl: RPC,
  });
  console.log('Channel open:');
  console.log(JSON.stringify(channel, null, 2));
  console.log('\nAdd to .env.local:');
  console.log(`AP4M_CHANNEL_ID=${channel.channel_id}`);
  if (channel.merchant_id) console.log(`AP4M_MERCHANT_ID=${channel.merchant_id}`);
  if (channel.payout) console.log(`AP4M_MERCHANT_PAYOUT=${channel.payout}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
