import {
  createInitialState,
  WELCOME_MESSAGE,
  type BuyerFlowState,
  type ChatMessage,
  type FashionProfile,
  type MarketProductPick,
  type PaymentRail,
} from "./buyer-flow";

const THREADS_KEY = "borneo.buyer.chats.v1";

export type ChatThreadSnapshot = {
  selectedId: string | null;
  rail: PaymentRail | null;
  phase: BuyerFlowState["phase"];
  picks: MarketProductPick[];
  snowtrace: string | null;
  messages: ChatMessage[];
  suggestions: string[];
  profile: FashionProfile | null;
  intent: string;
  cart: MarketProductPick[];
  cartQty: Record<string, number>;
  flaggedSkus: Array<{ id: string; storeSlug: string; flags: string[] }>;
  lastSearchQueries: string[];
};

export type ChatThread = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  snapshot: ChatThreadSnapshot;
};

export type ChatThreadsStore = {
  activeId: string;
  threads: ChatThread[];
  /** Desktop sidebar expanded (persisted). */
  sidebarOpen: boolean;
};

function canUseStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function newId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function truncateTitle(text: string, max = 42) {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "New chat";
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

/** Sidebar label — prefer what they searched for. */
export function deriveChatTitle(opts: {
  intent?: string;
  lastSearchQueries?: string[];
  profile?: FashionProfile | null;
  messages?: ChatMessage[];
}): string {
  const q = opts.lastSearchQueries?.find((s) => s.trim());
  if (q) return truncateTitle(q);

  if (opts.intent?.trim()) return truncateTitle(opts.intent.trim());

  const items = opts.profile?.items?.filter((x) => x.trim());
  if (items && items.length > 0) return truncateTitle(items.join(" · "));

  if (opts.profile?.item?.trim()) {
    return truncateTitle(opts.profile.item.trim());
  }

  const user = opts.messages?.find(
    (m) => m.role === "user" && m.content.trim().length > 0,
  );
  if (user) return truncateTitle(user.content);

  return "New chat";
}

export function snapshotFromState(state: BuyerFlowState): ChatThreadSnapshot {
  return {
    selectedId: state.selectedId,
    rail: state.rail,
    phase:
      state.phase === "thinking" || state.phase === "settle"
        ? "chat"
        : state.phase,
    picks: state.picks,
    snowtrace: state.snowtrace,
    messages: state.messages,
    suggestions: state.suggestions,
    profile: state.profile,
    intent: state.intent,
    cart: state.cart,
    cartQty: state.cartQty,
    flaggedSkus: state.flaggedSkus ?? [],
    lastSearchQueries: state.lastSearchQueries ?? [],
  };
}

export function stateFromSnapshot(snapshot: ChatThreadSnapshot): BuyerFlowState {
  const base = createInitialState();
  const phase =
    snapshot.phase === "thinking" || snapshot.phase === "settle"
      ? "chat"
      : snapshot.phase || "chat";

  return {
    ...base,
    intent: snapshot.intent || "",
    messages:
      snapshot.messages?.length > 0 ? snapshot.messages : [WELCOME_MESSAGE],
    suggestions: snapshot.suggestions?.length
      ? snapshot.suggestions
      : base.suggestions,
    profile: snapshot.profile ?? null,
    picks: snapshot.picks ?? [],
    cart: snapshot.cart ?? [],
    cartQty: snapshot.cartQty ?? {},
    flaggedSkus: snapshot.flaggedSkus ?? [],
    lastSearchQueries: snapshot.lastSearchQueries ?? [],
    selectedId: snapshot.selectedId,
    rail: (() => {
      const raw = snapshot.rail as string | null;
      if (raw === "Mastercard" || raw === "mastercard") return "mastercard" as const;
      if (raw === "stablecoin" || raw === "xrp") return raw;
      return null;
    })(),
    snowtrace: snapshot.snowtrace,
    phase,
    detailOpen: false,
    cartCheckoutOpen: false,
    busy: false,
    chatBusy: false,
    error: null,
  };
}

export function emptyThread(partial?: Partial<ChatThread>): ChatThread {
  const now = Date.now();
  const snapshot = partial?.snapshot ?? snapshotFromState(createInitialState());
  return {
    id: partial?.id ?? newId(),
    title: partial?.title ?? "New chat",
    createdAt: partial?.createdAt ?? now,
    updatedAt: partial?.updatedAt ?? now,
    snapshot,
  };
}

export function readChatThreads(): ChatThreadsStore | null {
  if (!canUseStorage()) return null;
  try {
    const raw = localStorage.getItem(THREADS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChatThreadsStore;
    if (!parsed?.threads?.length || !parsed.activeId) return null;
    return {
      activeId: parsed.activeId,
      threads: parsed.threads,
      sidebarOpen: parsed.sidebarOpen ?? true,
    };
  } catch {
    return null;
  }
}

export function writeChatThreads(store: ChatThreadsStore) {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(THREADS_KEY, JSON.stringify(store));
  } catch {
    // quota / private mode
  }
}

export function clearChatThreads() {
  if (!canUseStorage()) return;
  try {
    localStorage.removeItem(THREADS_KEY);
  } catch {
    // ignore
  }
}

export function createDefaultStore(
  seed?: ChatThreadSnapshot | null,
): ChatThreadsStore {
  const thread = emptyThread(
    seed
      ? {
          title: deriveChatTitle(seed),
          snapshot: seed,
        }
      : undefined,
  );
  return {
    activeId: thread.id,
    threads: [thread],
    sidebarOpen: true,
  };
}

export function sortThreads(threads: ChatThread[]) {
  return [...threads].sort((a, b) => b.updatedAt - a.updatedAt);
}
