#!/usr/bin/env node
/**
 * AP4M connection check — no private key required.
 * Usage: node --env-file=.env.local scripts/ap4m/status.mjs
 */
import sdk from '../../lib/ap4m/ap4m-hackathon-sdk.cjs';

const API = process.env.AP4M_API_URL || 'https://hackathon.ap4m.build';

async function main() {
  console.log('AP4M API:', API);

  const configResp = await fetch(`${API}/public/config`);
  const config = await configResp.json();
  if (!configResp.ok) throw new Error(`config failed: ${JSON.stringify(config)}`);
  console.log('Network:', config.network?.name, `(chain ${config.network?.chainId})`);
  console.log('RPC:', config.network?.rpcUrl);
  console.log('Ledger:', config.contracts?.paymentLedger);
  console.log('RLUSD:', config.contracts?.rlusdToken);
  console.log('Faucet:', config.network?.faucetUrl);

  const x402Resp = await fetch(`${API}/public/x402-context`);
  const x402 = await x402Resp.json();
  if (!x402Resp.ok) throw new Error(`x402-context failed: ${JSON.stringify(x402)}`);
  console.log('x402 network:', x402.network);

  const merchantsResp = await fetch(`${API}/public/merchants`);
  const merchants = await merchantsResp.json();
  if (!merchantsResp.ok) throw new Error(`merchants failed: ${JSON.stringify(merchants)}`);
  console.log('Public merchants:', merchants.merchants?.length ?? 0);
  for (const m of merchants.merchants ?? []) {
    console.log(`  - ${m.team_name} · merchant ${m.merchant_id} · payout ${m.payout}`);
  }

  const teamName = process.env.AP4M_TEAM_NAME;
  const agentKey = process.env.AP4M_AGENT_PRIVATE_KEY || process.env.AGENT_PRIVATE_KEY;
  if (!teamName || !agentKey) {
    console.log('\nSkipping authenticated channel list (set AP4M_TEAM_NAME + AP4M_AGENT_PRIVATE_KEY).');
    console.log('Portal blockers until then:');
    console.log('  1. Participant portal → choose Merchant payout (hackathon pool is fine)');
    console.log('  2. Wait for MERCHANT ID (not Pending)');
    console.log('  3. Put Agent wallet private key in AP4M_AGENT_PRIVATE_KEY');
    console.log('  4. Fund Agent with XRP gas: https://faucet.xrplevm.org (Testnet)');
    console.log('     (AP4M lists', config.network?.faucetUrl || 'faucet.testevm.ripple.com', '— that host is currently down)');
    console.log('  5. node --env-file=.env.local scripts/ap4m/open-channel.mjs');
    return;
  }

  const { ethers } = await import('ethers');
  const wallet = new ethers.Wallet(agentKey);
  console.log('\nAgent address:', wallet.address);
  const session = await sdk.signIn(API, teamName, wallet);
  const channels = await sdk.listChannels(API, session.token);
  console.log('Channels:', channels.length || 'none');
  for (const c of channels) {
    console.log(`  - ${c.channel_id} · ${c.channel_status} · merchant ${c.merchant_id}`);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
