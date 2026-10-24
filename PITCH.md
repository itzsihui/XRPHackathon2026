# 90-second live demo script

Open `/demo` or `/buyer`. Narrate the multi-currency terminal.

## Clock

| Time | Say | Show |
|---|---|---|
| 0:00–0:15 | “Borneo is the open merchant protocol for AI agents — publish once, any HTTP agent can shop.” | Landing / buyer chat |
| 0:15–0:30 | “Merchant prices inventory in **RLUSD**. Agents read `llms.txt` and `/api/search` — never scrape HTML.” | Merchant publish / registry |
| 0:30–0:55 | “**Multi-currency terminal**: buyer pays **XRP** or **RLUSD** (or Visa). Merchant always receives RLUSD — like a tourist POS / Revolut.” | Pay modal: tap **XRP** → FX strip |
| 0:55–1:15 | “XRP→RLUSD is a native XRPL cross-currency Payment via AMM/DEX. Receipt: spent XRP · merchant received RLUSD.” | Authorize → explorer tx |
| 1:15–1:30 | “Same SKU still settles exact RLUSD via **x402**, or Visa scoped card. Open protocol. Same settle home currency.” | Optional second rail |

## Demo checklist

1. Merchant wallet has an **RLUSD trust line** on XRPL Testnet.
2. `XRPL_BUYER_SEED` is funded with **XRP** (reserves + send amount).
3. Tap **XRP** in the pay modal — quote must show ≈ XRP / deliver RLUSD.
4. Authorize → explorer shows Payment with `Amount` RLUSD and `SendMax` XRP.

## Fail-soft

- No buyer seed → XRP/RLUSD settle errors clearly; 402 challenge still works for x402.
- No AMM path → XRP chip shows “unavailable”; RLUSD and Visa remain.
- No Bedrock / OpenAI → deterministic buyer tools; protocol endpoints unchanged.
