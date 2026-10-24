# XRPL Testnet + RLUSD setup (Borneo)

Borneo settles the crypto rail with **RLUSD on XRPL Testnet** via x402.

Preferred tooling: **[t54-labs rlusd-cli](https://github.com/t54-labs/rlusd-cli)** (`@rlusd/cli`).  
`rlusd faucet fund --chain xrpl` provisions XRP (and points you at RLUSD funding);  
`rlusd xrpl trustline setup` submits the TrustSet on-chain.

---

## Fast path (rlusd-cli)

### 1. Install

`@rlusd/cli` is **not on the npm registry yet** (`npm install -g @rlusd/cli` → 404). Install from GitHub:

```bash
# Recommended — clone, build, link into your Node (nvm) PATH
git clone https://github.com/t54-labs/rlusd-cli.git ~/rlusd-cli
cd ~/rlusd-cli
npm install && npm run build && npm link
which rlusd   # should print …/bin/rlusd

# Alternate — one-shot global from GitHub (needs a successful publishable build)
npm install -g github:t54-labs/rlusd-cli
```

If `rlusd` is still “not found”, your shell may be using a different Node. Prefer the nvm binary:

```bash
export PATH="$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node | tail -1)/bin:$PATH"
hash -r
which rlusd
```

### 2. Testnet + wallet

```bash
rlusd config set --network testnet

export RLUSD_WALLET_PASSWORD='choose-a-local-password'

# Buyer wallet (Borneo server settles with this account's seed)
rlusd wallet generate --chain xrpl --name borneo-buyer
rlusd wallet use borneo-buyer --chain xrpl

# Optional second wallet for merchant receive
rlusd wallet generate --chain xrpl --name borneo-merchant
```

### 3. Fund XRP + TrustSet + RLUSD

```bash
# Activates account with Testnet XRP (repeat / follow prompts for RLUSD faucet)
rlusd faucet fund --chain xrpl

# Required before receiving RLUSD (on-chain TrustSet)
rlusd xrpl trustline setup

# If account already has XRP, faucet fund again may open the official RLUSD claim flow
rlusd faucet fund --chain xrpl

rlusd balance --chain xrpl
rlusd xrpl trustline status
```

Do the same trustline on the **merchant** wallet (switch with `rlusd wallet use borneo-merchant --chain xrpl`) so it can receive RLUSD.

### 4. Wire Borneo `.env.local`

```bash
rlusd wallet address --chain xrpl          # classic r… of active wallet
rlusd wallet list --output json            # confirm names / addresses
```

Set:

```bash
XRPL_NETWORK=xrpl:1
XRPL_RPC_URL=https://s.altnet.rippletest.net:51234/
XRPL_WS_URL=wss://s.altnet.rippletest.net:51233
XRPL_FACILITATOR_URL=https://xrpl-facilitator-testnet.t54.ai
TOKEN_SYMBOL=RLUSD
TOKEN_DECIMALS=6
TOKEN_ISSUER=rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV
TOKEN_ADDRESS=524C555344000000000000000000000000000000
EXPLORER_BASE=https://testnet.xrpl.org

# Merchant payTo — classic r… (borneo-merchant address, or Xaman address)
MERCHANT_ADDRESS=r...

# Buyer settle seed — import into rlusd OR paste the s… secret from faucet / wallet generate
# If you generated via rlusd-cli, import that same secret here:
XRPL_BUYER_SEED=sEd...
```

**Seed tip:** when you generate/import with rlusd-cli, keep the `s…` secret somewhere safe once; Borneo needs it in `XRPL_BUYER_SEED` (server-side settle).  
You can also import an existing faucet secret:

```bash
rlusd wallet import --chain xrpl --secret 'sEd...' --name borneo-buyer
```

### 5. Smoke test

1. `npm run dev`
2. Merchant Settings → bind XRPL seed / classic address → publish
3. Buyer authorize → RLUSD x402 → receipt on `https://testnet.xrpl.org`

---

## Fallback (no rlusd-cli)

### Create + fund XRP

```bash
curl -X POST https://faucet.altnet.rippletest.net/accounts
# or refill: curl -X POST https://faucet.altnet.rippletest.net/accounts \
#   -H 'content-type: application/json' -d '{"destination":"r..."}'
```

Or use the [XRPL Testnet faucet UI](https://xrpl.org/resources/dev-tools/xrp-faucets) (Secret → `XRPL_BUYER_SEED`, Address → buyer classic).

### TrustSet

```bash
# Use tsx — plain `node` hits ERR_REQUIRE_ESM with xrpl@5
npx tsx scripts/xrpl-trustset.mjs --seed "$XRPL_BUYER_SEED"
# or: npm run trustset -- --seed "$XRPL_BUYER_SEED"
```

### Claim RLUSD

[tryrlusd.com](https://tryrlusd.com/) → **XRPL Testnet** → Connect → Trustline → Claim  
(If Xaman WebSocket signing fails, prefer `rlusd xrpl trustline setup` above.)

---

## Constants (already defaulted in `src/lib/config.ts`)

| Item | Value |
|------|--------|
| Network | `xrpl:1` (Testnet) |
| Issuer | `rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV` |
| Currency | `524C555344000000000000000000000000000000` (RLUSD) |
| Facilitator | `https://xrpl-facilitator-testnet.t54.ai` |
