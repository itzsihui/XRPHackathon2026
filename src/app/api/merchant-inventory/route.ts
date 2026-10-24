import { saveDraftToLiveStore } from "@/lib/agents/tools-merchant";
import {
  normalizeDraft,
  type MerchantDraft,
} from "@/lib/inventory/parse";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      slug?: string;
      draft?: MerchantDraft | null;
      prices?: string[];
      quantities?: string[];
      merchantAuth?: import("@/lib/wallet/ethereum").MerchantAuthProof | null;
      ownerUid?: string;
      merchantDisplayName?: string;
      visaReceive?: {
        accountLabel: string;
        receiveId?: string;
        settlementNote?: string;
      };
      boundWalletAddress?: string | null;
      listOnMarket?: boolean;
      acceptRlusd?: boolean;
      acceptXrp?: boolean;
      acceptVisa?: boolean;
    };

    const slug = String(body.slug || "").trim();
    const draft = normalizeDraft(body.draft);
    if (!slug || !draft) {
      return Response.json({
        status: "clarify",
        reply: "Need a live store slug and inventory draft to save.",
        store: null,
        draft: null,
      });
    }

    const result = await saveDraftToLiveStore({
      slug,
      draft,
      prices: body.prices || [],
      quantities: body.quantities || [],
      merchantAuth: body.merchantAuth,
      ownerUid: body.ownerUid,
      merchantDisplayName: body.merchantDisplayName,
      visaReceive: body.visaReceive,
      boundWalletAddress: body.boundWalletAddress,
      listOnMarket: body.listOnMarket,
      acceptRlusd: body.acceptRlusd,
      acceptXrp: body.acceptXrp,
      acceptVisa: body.acceptVisa,
    });

    return Response.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not save inventory";
    return Response.json(
      {
        status: "clarify",
        reply: message,
        store: null,
        draft: null,
      },
      { status: 200 },
    );
  }
}
