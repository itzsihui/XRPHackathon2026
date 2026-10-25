# Borneo x Mastercard: Conversational Commerce Agents

Source of truth for this prototype. Landing copy, demo script, and product decisions should map here. Do not invent a fifth pillar.

**Design read:** cinematic product landing for Mastercard hackathon judges, trust-first commerce language, existing Borneo system (Syne + IBM Plex, jade / ember / ink, metalHuman stage).

**Dials:** `DESIGN_VARIANCE: 6` · `MOTION_INTENSITY: 5` · `VISUAL_DENSITY: 4`

Preserve brand tokens. Overhaul landing IA and copy so judges can score the brief without a walkthrough.

---

## Problem

Online shopping is fragmented. People browse, compare, decide, and pay across multiple interfaces. Most merchants, especially SMEs, cannot build an AI commerce experience with trusted payments.

The opportunity: one conversation for discovery, decision, and payment, on Mastercard's payment stack, that any merchant can deploy.

**Challenge question:** How might we enable merchants of any size to deploy pre-built, category-trained AI commerce agents on their platforms, allowing customers to discover, decide, and pay through a single conversation, powered by Mastercard's payment stack?

---

## Expected submissions (map 1:1)

| Pillar | What judges asked | What Borneo ships | Live surface |
|---|---|---|---|
| **AI Agent Layer** | Chatbot or voice assistant trained for one category. Handles discovery, recommendations, comparison, purchase decision. | Fashion buyer agent. Chat clarifies intent, ranks live apparel, compares SKUs, then hands off to pay. | `/buyer` |
| **Merchant access** | No-code / low-code go-live (upload catalog, connect APIs). Works for a single-location SME and a multi-location retailer. | Merchant chat: type inventory, drop CSV, or paste a store URL. Same flow for one shop or many locations. | `/onboard` |
| **Seamless payment** | Simulated Mastercard payment. Checkout completes inside the conversation. No redirects. | Mastercard-style scoped virtual card issued in-chat, spend-capped, then burned. Optional USDC x402 on Base Sepolia as a second rail. Both stay in `/buyer`. | `/buyer` checkout |
| **Trust, consent, transparency** | Users authorize agent-driven actions. Safeguards: transaction previews, identity verification, confirmation before the agent transacts. | Consent modal with item, merchant, amount, rail, spend cap. Agent does not pay until **Authorize purchase**. Merchant wallet proof on onboard. | `/buyer` modal, `/onboard` wallet |

Do not claim voice unless we ship it. Category is **fashion / apparel** (hackathon shirts and caps), not a general mall bot.

---

## Expected output

- Working prototype: this Next.js app (chat + merchant onboard + in-conversation pay)
- Demo path: discover → decide → pay (see below)
- Architecture, merchant onboarding, and trust/security explained on the landing page and in this file

### Demo path (judges)

1. `/` landing: four pillars, two doors (shopper vs merchant)
2. `/onboard`: talk a catalog live, publish
3. `/buyer`: "I want a t-shirt" → compare → pick Mastercard → review preview → authorize
4. `/dashboard` if asked about rails / ops

Fail-soft: no buyer key still shows the Mastercard mandate or the HTTP 402 challenge. No Bedrock still runs deterministic tools.

---

## Judging rubrics (write to these)

- **Innovation:** agent shops a live catalog and pays in-chat, not a wrapped checkout page
- **User experience:** one conversation, short turns, obvious next action
- **Technical feasibility:** Bedrock (or fallback) + Mastercard-style scoped card + x402 USDC
- **Scalability:** same merchant chat for SME and multi-location; protocol storefront per slug
- **Trust and safety:** preview, confirm, scoped spend, identity on merchant publish

---

## Architecture (short)

- **Buyer agent:** category-trained fashion chat (`/buyer`, `/api/buyer-chat`). Discovers via `/llms.txt` + registry JSON, not HTML scraping.
- **Merchant agent:** conversational onboard (`/onboard`, `/api/merchant-agent`). Inventory → priced draft → published store.
- **Mastercard rail (hackathon):** simulated agent-authorized virtual card. Spend cap, merchant scope, short TTL, burn after use. Checkout never leaves the chat.
- **Stablecoin rail:** HTTP 402 → USDC on Base Sepolia → receipt. Also in-chat.
- **AWS:** Bedrock for agents when enabled; protocol slice on API Gateway, Lambda, DynamoDB, CloudWatch.

---

## Trust model

1. Buyer sees a **transaction preview** (item, merchant, qty, amount, rail).
2. Buyer **confirms** (`Authorize purchase`). No confirm, no charge.
3. Mastercard rail: mandate is **spend-capped** and merchant-scoped, then burned.
4. Merchant publish: **wallet identity** (MetaMask proof) before the store is live.
5. Protocol log is visible so the handshake is inspectable, not hidden.

---

## Landing page contract

The homepage must make the four pillars obvious without requiring the demo first.

**Doors (two intents, two labels, used everywhere):**

- Shopper: `Shop fashion` → `/buyer`
- Merchant: `Open a store` → `/onboard`

**Hero:** discover / decide / pay in one conversation. Buyer is primary.

**Banned on the landing:** "agents only, no human checkout" as the whole story, protocol-only handshake as the first narrative, numbered section eyebrows, scroll cues, filler verbs (unleash, elevate, next-gen).

**Voice:** concrete. Name fashion, Mastercard in-chat, confirm-before-pay. Judges should be able to tick the rubric from the page.

---

## Why this matters

This sits at AI, fintech, and commerce infrastructure. Mastercard's focus is agentic commerce with trusted payments. Borneo is the plug-and-play agent a merchant of any size can deploy, and the conversation a shopper can finish without leaving chat.
