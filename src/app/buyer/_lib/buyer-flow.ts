import type { ChainStep } from "@/components/agent/chain-of-thought";

export type BuyerPhase =
  | "chat"
  | "thinking"
  | "pick"
  | "rail"
  | "consent"
  | "settle"
  | "done";

export type PaymentRail = "visa" | "stablecoin" | "xrp";

export type {
  ChainStep,
  ChainStepStatus,
} from "@/components/agent/chain-of-thought";

export type MarketProductPick = {
  id: string;
  title: string;
  description?: string;
  price: string;
  quantity: number;
  storeSlug: string;
  storeName: string;
  merchantDisplayName?: string;
  merchantAddress?: string;
  visaReceiveLabel?: string;
  visaReceiveId?: string;
  imageUrl: string;
  score: number;
  /** Terminal rails from merchant governance (default allow). */
  acceptRlusd?: boolean;
  acceptXrp?: boolean;
  acceptVisa?: boolean;
  /** CaMeL quarantine flags — present when catalog copy looked like injection. */
  injectionFlags?: string[];
  quarantined?: boolean;
};

/**
 * Locked settle quote — merchant catalog text never enters this object.
 * Pay tools may only settle to these fields (CaMeL-shaped control-flow lock).
 */
export type PurchaseQuote = {
  storeSlug: string;
  skuId: string;
  price: string;
  merchantAddress?: string;
  rail: PaymentRail;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  /** Catalog hits attached after a real network search — never invent these. */
  products?: MarketProductPick[];
  /** Optional outbound links (e.g. XRPL explorer receipt). */
  links?: Array<{ label: string; href: string }>;
  /** Expandable thought process for this turn (stays after search completes). */
  steps?: ChainStep[];
};

export type FashionProfile = {
  category?: string;
  item?: string;
  items?: string[];
  style?: string;
  color?: string;
  budget?: string;
  occasion?: string;
};

export type BuyerFlowState = {
  phase: BuyerPhase;
  intent: string;
  messages: ChatMessage[];
  suggestions: string[];
  profile: FashionProfile | null;
  steps: ChainStep[];
  picks: MarketProductPick[];
  /** Multi-item cart for in-chat checkout. */
  cart: MarketProductPick[];
  cartQty: Record<string, number>;
  /** Last discovery quarantine hits (for report / similar search). */
  flaggedSkus?: Array<{
    id: string;
    storeSlug: string;
    flags: string[];
  }>;
  lastSearchQueries?: string[];
  selectedId: string | null;
  rail: PaymentRail | null;
  detailOpen: boolean;
  cartCheckoutOpen: boolean;
  busy: boolean;
  chatBusy: boolean;
  snowtrace: string | null;
  error: string | null;
};

export const INITIAL_STEPS: ChainStep[] = [
  {
    id: "parse",
    title: "Parse fashion intent",
    status: "pending",
    description: "Waiting for your request…",
    capability: "privileged",
  },
  {
    id: "decompose",
    title: "Decompose constraints",
    status: "pending",
    capability: "privileged",
  },
  {
    id: "search",
    title: "Search Borneo network",
    status: "pending",
    description: "Catalog titles are data only — not instructions",
    capability: "untrusted",
  },
  {
    id: "quarantine",
    title: "Quarantine catalog",
    status: "pending",
    description: "Q-reader: typed extract only — no tools",
    capability: "untrusted",
  },
  {
    id: "rank",
    title: "Rank catalog matches",
    status: "pending",
    description: "SKU copy cannot change payee, amount, or skip authorize",
    capability: "untrusted",
  },
];

export const SUGGEST_REPORT = "Report this listing";
export const SUGGEST_SIMILAR = "Find a similar clean product";

export const WELCOME_MESSAGE: ChatMessage = {
  role: "assistant",
  content:
    "Hey — I'm your fashion buyer agent. Tell me what you're looking to wear and I'll narrow it down like a personal salesperson.",
};

export function createInitialState(): BuyerFlowState {
  return {
    phase: "chat",
    intent: "",
    messages: [WELCOME_MESSAGE],
    suggestions: [
      "I want a t-shirt",
      "Looking for a cap",
      "Show me the IGNORE BUYER tee",
    ],
    profile: null,
    steps: INITIAL_STEPS.map((s) => ({ ...s })),
    picks: [],
    cart: [],
    cartQty: {},
    flaggedSkus: [],
    lastSearchQueries: [],
    selectedId: null,
    rail: null,
    detailOpen: false,
    cartCheckoutOpen: false,
    busy: false,
    chatBusy: false,
    snowtrace: null,
    error: null,
  };
}

export function selectedPick(
  state: BuyerFlowState,
): MarketProductPick | null {
  if (!state.selectedId) return null;
  return state.picks.find((p) => p.id === state.selectedId) ?? null;
}

export function updateStep(
  steps: ChainStep[],
  id: string,
  patch: Partial<ChainStep>,
): ChainStep[] {
  return steps.map((s) => (s.id === id ? { ...s, ...patch } : s));
}

export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function profileBullets(profile: FashionProfile | null): string[] {
  if (!profile) return ["Category: apparel / fashion"];
  const out: string[] = ["Category: apparel / fashion"];
  if (profile.occasion) out.push(`Occasion: ${profile.occasion}`);
  if (profile.item) out.push(`Item: ${profile.item}`);
  if (profile.items?.length) out.push(`Set: ${profile.items.join(" + ")}`);
  if (profile.style) out.push(`Style: ${profile.style}`);
  if (profile.color) out.push(`Color: ${profile.color}`);
  if (profile.budget) out.push(`Budget: ${profile.budget}`);
  return out;
}

/** Honest post-search copy — never claim SKUs that aren't in `picks`. */
export function catalogResultMessage(
  query: string,
  picks: MarketProductPick[],
  profile?: FashionProfile | null,
  opts?: {
    flaggedCount?: number;
    flaggedSummaries?: string[];
  },
): string {
  const wanted = (profile?.item || query || "that")
    .trim()
    .replace(/\s+/g, " ");
  const flaggedCount = opts?.flaggedCount ?? 0;

  const quarantineNote =
    flaggedCount > 0
      ? ` One listing that matched looked prompt-injection shaped — it was not trusted as fashion instructions (and settle still locks payee/amount if you open it). Report it or find a similar clean product.`
      : "";

  if (picks.length === 0) {
    if (flaggedCount > 0) {
      return `I scanned seller catalogs for “${wanted}”. A matching listing looked like injection-shaped catalog copy, so it was held out of the fashion results.${quarantineNote}`;
    }
    return `I searched seller catalogs on the Borneo network and couldn't find a match for “${wanted}”. Try naming a piece (shirt, pants, tee, cap) or browse Market.`;
  }

  const titles = picks.map((p) =>
    p.quarantined ? p.id.split(":").pop() || p.title : p.title,
  );
  const list =
    titles.length === 1
      ? titles[0]
      : `${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1]}`;

  const roles = new Set(
    picks.map((p) => {
      const t = p.title.toLowerCase();
      if (/\b(jeans?|pants?|trousers?|shorts?|skirts?|chinos?)\b/.test(t)) {
        return "bottom";
      }
      if (/\b(coats?|blazers?|jackets?)\b/.test(t)) return "outer";
      if (/\b(shirts?|tees?|blouses?|tops?|crews?|sweaters?)\b/.test(t)) {
        return "top";
      }
      return "other";
    }),
  );
  const isRealSet =
    roles.has("top") && (roles.has("bottom") || roles.has("outer"));

  const setHint = isRealSet
    ? " These look like complementary pieces — add what you want in Build your set, or tap a piece for details and pay."
    : " Tap a piece for details, then pay with Visa or RLUSD.";

  const wantedPieces = [
    ...(profile?.items || []),
    ...wanted.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2),
  ];
  const hay = titles.join(" ").toLowerCase();
  const missing = [...new Set(wantedPieces)].filter((t) => {
    if (
      [
        "and",
        "the",
        "for",
        "with",
        "black",
        "white",
        "casual",
        "professional",
        "formal",
        "outfit",
        "set",
        "date",
        "night",
      ].includes(t)
    ) {
      return false;
    }
    if (
      (t === "tee" || t === "tshirt" || t === "shirt") &&
      /shirt|tee|blouse|oxford/.test(hay)
    )
      return false;
    if (t === "hat" && /cap|hat/.test(hay)) return false;
    if (
      (t === "pants" ||
        t === "pant" ||
        t === "trousers" ||
        t === "jeans" ||
        t === "jean") &&
      /pants?|jeans|trousers|shorts|chino/.test(hay)
    )
      return false;
    if (t === "poplin" && /poplin|shirt/.test(hay)) return false;
    if (t === "blazer" && /blazer|jacket|coat/.test(hay)) return false;
    return !hay.includes(t);
  });

  if (missing.length > 0) {
    return `Here's what matched: ${list}. I didn't surface ${missing.join(", ")} in these picks — try a more specific ask or browse Market.${quarantineNote}${setHint}`;
  }

  return `Here's what matched across seller catalogs: ${list}.${quarantineNote}${setHint}`;
}
