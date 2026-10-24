import { runMerchantAgent } from "@/lib/agents/merchant";
import {
  normalizeDraft,
  type MerchantDraft,
  type MerchantDraftLine,
} from "@/lib/inventory/parse";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      message?: string;
      csv?: string;
      url?: string;
      draft?:
        | MerchantDraft
        | {
            quantity: number;
            title: string;
            name?: string;
            lines?: MerchantDraftLine[];
          }
        | null;
      prices?: Array<string | number | null | undefined>;
      merchantAuth?: import("@/lib/wallet/ethereum").MerchantAuthProof | null;
      ownerUid?: string;
      merchantDisplayName?: string;
      visaReceive?: {
        accountLabel: string;
        receiveId?: string;
        settlementNote?: string;
      };
      existingSlug?: string | null;
      boundWalletAddress?: string | null;
      listOnMarket?: boolean;
      acceptRlusd?: boolean;
      acceptXrp?: boolean;
      acceptVisa?: boolean;
    };
    const result = await runMerchantAgent({
      message: body.message,
      csv: body.csv,
      url: body.url,
      draft: normalizeDraft(body.draft),
      prices: body.prices,
      merchantAuth: body.merchantAuth,
      ownerUid: body.ownerUid,
      merchantDisplayName: body.merchantDisplayName,
      visaReceive: body.visaReceive,
      existingSlug: body.existingSlug,
      boundWalletAddress: body.boundWalletAddress,
      listOnMarket: body.listOnMarket,
      acceptRlusd: body.acceptRlusd,
      acceptXrp: body.acceptXrp,
      acceptVisa: body.acceptVisa,
    });
    return Response.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Merchant agent failed";
    console.error("[merchant-agent]", message);
    return Response.json(
      {
        store: null,
        status: "clarify",
        reply:
          message.includes("security token") ||
          message.includes("credentials") ||
          message.includes("AccessDenied") ||
          message.includes("not authorized")
            ? `Could not publish store (storage/credentials): ${message}. With AISLE_TABLE unset, stores use in-memory on this Next server. For Dynamo, AWS_ACCESS_KEY_ID must be AKIA…/ASIA… (not the secret).`
            : message.includes("NaN")
              ? `Could not publish store: a quantity/price became NaN (usually an unquoted comma in a CSV description). Re-upload samples/clothing-boutique.csv from this repo, or quote fields like "White cotton oxford, slim fit".`
              : `Could not publish store: ${message}`,
        draft: null,
        llm: "deterministic",
      },
      { status: 200 },
    );
  }
}
