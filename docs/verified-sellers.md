# Verified sellers on XRPL (XLS-70 Credentials + XLS-40 DID)

Buyer agents should not have to trust Borneo's server to know a seller is legit.
So the "verified seller" signal lives **on the XRP Ledger**, on the exact address the agent pays.

## What is on the ledger

| Object | Owner / signer | Meaning |
|---|---|---|
| `Credential` `BorneoVerifiedSeller` | Issued by the Borneo issuer, **accepted** by the merchant | Borneo vetted this payout address |
| `DID` on the merchant account | Signed by the merchant | `URI` → `/sellers/{payTo}/did.json`, listing the merchant's storefronts |

Verified means: credential exists, `lsfAccepted` (0x00010000) set, not expired (365-day TTL).

## Flow

1. Merchant publishes a store. Payouts go to the bound Settings wallet when it has an RLUSD trust line, otherwise to the shared `MERCHANT_ADDRESS`.
2. In **Settings → 4. Verified seller on XRPL**, the merchant pastes the payout seed. It is used only in the browser.
3. `POST /api/seller-verification {action:"issue", proof}`: Borneo checks the signed wallet proof, that a published store pays this address, and that no listing is injection-flagged. Then it submits `CredentialCreate`.
4. `prepare` returns autofilled `CredentialAccept` + `DIDSet`. The browser signs them, and `submit` relays them. The relay accepts only these two transaction types, signed by that merchant, targeting the Borneo credential and seller doc.

## Where agents see it

- `/registry.json`: `stores[].sellerVerification`, top-level `sellerVerification` (issuer and the exact `ledger_entry` request). `?verified=1` filters within the page.
- `/api/search`: `scoreBreakdown.trust` (unverified ×0.85), `.verified` (+0.06), `.injection` (flagged ×0.1, boosts withheld). `&verified=1` filters.
- `/s/{slug}/agent.json` and `/s/{slug}/llms.txt`: seller verification block.
- `/sellers/{payTo}/did.json`: DID document the on-ledger DID points to.
- `/market`: "✓ Verified on XRPL" badge.

## Verify without Borneo

```bash
node scripts/verify-seller.mjs <payTo> <borneoIssuer>   # zero deps, plain JSON-RPC
```

## Setup

```bash
node scripts/borneo-issuer-setup.mjs   # prints BORNEO_ISSUER_SEED / BORNEO_ISSUER_ADDRESS
```

Without the issuer env, everything still runs and every seller reads `unverified`, so ranking is unchanged relative to before.
Ledger reads fail soft: a timeout returns `unverified` with `reason: ledger_unreachable…` and is not cached.
