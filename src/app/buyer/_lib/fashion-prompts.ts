/** Fashion-focused buyer copy — discovery ranks via GET /api/search. */

export const FASHION_HEADLINE = "Fashion buyer agent";

export const FASHION_SUBCOPY =
  "Chat with your personal salesperson to clarify what you want. When ready, the agent ranks apparel via GET /api/search over the live market (same endpoint external agents use). You choose Mastercard AP4M, RLUSD, or XRP and authorize before anything pays. Catalog text cannot change payee, amount, or skip authorize.";

export const FASHION_WELCOME =
  "I'm your fashion buyer agent — tell me what you're looking for.";

export const FASHION_STARTERS = [
  "I want a t-shirt",
  "Looking for a cap",
  "Show me the IGNORE BUYER tee",
] as const;

/** @deprecated Prefer locked PurchaseQuote — do not embed product titles in settle prompts. */
export function purchaseMessage(args: {
  storeSlug: string;
  productTitle: string;
}) {
  const product = args.productTitle.trim().toLowerCase();
  const article = /^[aeiou]/i.test(product) ? "an" : "a";
  return `Agent, go to /s/${args.storeSlug} and buy ${article} ${product}.`;
}
