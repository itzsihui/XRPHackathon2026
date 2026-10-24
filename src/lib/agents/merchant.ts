import { createStoreTool, importStoreFromUrl } from "@/lib/agents/tools-merchant";
import { runMerchantOpenAI } from "@/lib/agents/merchant-llm";
import {
  draftNeedsFashionVariants,
  enrichDraftWithFashion,
} from "@/lib/inventory/fashion";
import {
  normalizeDraft,
  type MerchantDraft,
} from "@/lib/inventory/parse";
import type { StoreRecord } from "@/lib/store/types";
import type { MerchantAuthProof } from "@/lib/wallet/ethereum";

export type { MerchantDraft };

export type MerchantAgentStatus =
  | "published"
  | "need_price"
  | "need_variants"
  | "need_wallet"
  | "clarify";

export async function runMerchantAgent(args: {
  message?: string;
  csv?: string;
  url?: string;
  draft?: MerchantDraft | null;
  prices?: Array<string | number | null | undefined>;
  merchantAuth?: MerchantAuthProof | null;
  ownerUid?: string;
  merchantDisplayName?: string;
  visaReceive?: StoreRecord["visaReceive"];
  existingSlug?: string | null;
  boundWalletAddress?: string | null;
  listOnMarket?: boolean;
  acceptRlusd?: boolean;
  acceptXrp?: boolean;
  acceptVisa?: boolean;
}): Promise<{
  store: StoreRecord | null;
  reply: string;
  status: MerchantAgentStatus;
  draft?: MerchantDraft | null;
  llm?: "openai" | "deterministic";
}> {
  const draft = normalizeDraft(args.draft);
  const merchantAuth = args.merchantAuth;
  const ownership = {
    ownerUid: args.ownerUid,
    merchantDisplayName: args.merchantDisplayName,
    visaReceive: args.visaReceive,
    existingSlug: args.existingSlug,
    boundWalletAddress: args.boundWalletAddress,
    listOnMarket: args.listOnMarket,
    acceptRlusd: args.acceptRlusd,
    acceptXrp: args.acceptXrp,
    acceptVisa: args.acceptVisa,
  };

  if (draft && args.prices && args.prices.length > 0) {
    const priced = await createStoreTool({
      draft,
      prices: args.prices,
      merchantAuth,
      ...ownership,
    });
    return {
      store: priced.store,
      status: priced.status,
      reply: priced.reply,
      draft: priced.draft,
      llm: "deterministic",
    };
  }

  if (args.url?.trim()) {
    const imported = await importStoreFromUrl(args.url.trim());
    return {
      store: imported.store,
      status: imported.status,
      reply: imported.reply,
      draft: imported.draft,
      llm: "deterministic",
    };
  }

  // Priced catalog ready — publish (payTo = shared MERCHANT_ADDRESS env)
  if (
    draft &&
    draft.lines.every((l) => l.price) &&
    !args.message?.trim() &&
    !args.csv?.trim() &&
    !args.url?.trim()
  ) {
    const priced = await createStoreTool({
      draft,
      prices: draft.lines.map((l) => l.price),
      merchantAuth,
      ...ownership,
    });
    return {
      store: priced.store,
      status: priced.status,
      reply: priced.reply,
      draft: priced.draft,
      llm: "deterministic",
    };
  }

  if (args.csv?.trim()) {
    const csvResult = await createStoreTool({
      csv: args.csv,
      draft,
      merchantAuth,
      ...ownership,
    });
    return {
      store: csvResult.store,
      status: csvResult.status,
      reply: csvResult.reply,
      draft: csvResult.draft,
      llm: "deterministic",
    };
  }

  const message = args.message?.trim();
  if (message) {
    const llm = await runMerchantOpenAI({ message, draft });
    if (llm) {
      if (llm.items.length > 0) {
        const result = await createStoreTool({
          items: llm.items.map((i) => ({
            quantity: i.quantity,
            title: i.title,
            price: i.price,
          })),
          draft,
          merchantAuth,
          ...ownership,
        });
        return {
          store: result.store,
          status: result.status,
          reply: llm.reply || result.reply,
          draft: result.draft,
          llm: "openai",
        };
      }

      // Advice / clarify — keep the open draft so the sheet stays intact
      if (draft) {
        const enriched = enrichDraftWithFashion(draft);
        const status = draftNeedsFashionVariants(enriched.lines)
          ? "need_variants"
          : "need_price";
        return {
          store: null,
          status,
          reply: llm.reply,
          draft: enriched,
          llm: "openai",
        };
      }

      return {
        store: null,
        status: "clarify",
        reply: llm.reply,
        draft: null,
        llm: "openai",
      };
    }

    // Deterministic fallback when OpenAI is unset / failed
    const followUp = await createStoreTool({
      message,
      draft,
      merchantAuth,
      ...ownership,
    });
    return {
      store: followUp.store,
      status: followUp.status,
      reply: followUp.reply,
      draft: followUp.draft,
      llm: "deterministic",
    };
  }

  const result = await createStoreTool({
    message: args.message,
    csv: args.csv,
    draft,
    merchantAuth,
    ...ownership,
  });
  return {
    store: result.store,
    status: result.status,
    reply: result.reply,
    draft: result.draft,
    llm: "deterministic",
  };
}
