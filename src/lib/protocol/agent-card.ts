import { config, storePayTo } from "@/lib/config";
import type { StoreRecord } from "@/lib/store/types";

/** AI-readable store business card for agent discovery. */
export function renderAgentCard(store: StoreRecord, origin: string) {
  const base = `${origin}/s/${store.slug}`;
  return {
    name: store.name,
    slug: store.slug,
    protocol: "borneo-agentic-storefront",
    version: "1.0",
    protocols: ["llms.txt", "acp", "x402", "visa-card"],
    description:
      "AI-native storefront. Agents discover inventory and pay without a human checkout UI.",
    currency: {
      symbol: config.tokenSymbol,
      decimals: config.tokenDecimals,
      asset: config.tokenAddress,
      issuer: config.tokenIssuer,
      network: config.network,
    },
    payTo: storePayTo(store),
    endpoints: {
      llmsTxt: `${base}/llms.txt`,
      agentCard: `${base}/agent.json`,
      catalog: `${base}/catalog.json`,
      reviews: `${base}/reviews.json`,
      buyX402: `${base}/buy`,
      checkoutVisa: `${base}/checkout`,
      orders: `${base}/orders/{orderId}`,
    },
    skus: store.skus.map((sku) => ({
      id: sku.id,
      title: sku.title,
      quantity: sku.quantity,
      price: sku.price,
    })),
    createdAt: store.createdAt,
  };
}
