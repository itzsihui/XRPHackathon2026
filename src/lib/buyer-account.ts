/** Session / local storage helpers for the demo buyer account. */

const ACCOUNT_KEY = "borneo.buyer.account.v1";

export type GovernancePolicy = {
  maxPerTransaction: number | null;
  maxPerDay: number | null;
  maxPerWeek: number | null;
  maxPurchasesPerHour: number | null;
  maxPurchasesPerDay: number | null;
};

export type GovernanceRule = {
  id: string;
  sourceText: string;
  summary: string;
  createdAt: string;
};

export type SpendEvent = {
  id: string;
  at: string;
  amount: number;
  rail: "x402" | "straitsx-card" | "xrpl-xrp" | "ap4m";
  title: string;
  storeSlug?: string;
  storeName?: string;
  merchantDisplayName?: string;
  /** Where funds went on the merchant side (wallet short or Mastercard label). */
  merchantReceive?: string;
  skuId?: string;
  imageUrl?: string;
  /** XRPL explorer (or explorer) link for RLUSD / x402 / XRP settlements */
  explorerUrl?: string;
  /** When rail is xrpl-xrp: XRP spent (display). */
  sentXrp?: string;
  /** When rail is xrpl-xrp: RLUSD merchant received. */
  deliveredRlusd?: string;
  orderId?: string;
  /** Mastercard mandate proof */
  cardOpaqueId?: string;
  truncatedPan?: string;
  /** Set after a verified-purchase review is submitted. */
  reviewId?: string;
};

export type BuyerCardStatus = {
  issued: boolean;
  truncatedPan?: string;
  lastIssuedAt?: string;
  source?: string;
};

export type BuyerAddress = {
  id: string;
  label: string;
  line1: string;
  line2?: string;
  city: string;
  country: string;
  postal?: string;
};

/** Soft fit prefs — discovery boosts matching titles; never hard-hides SKUs. */
export type BuyerSizingPrefs = {
  tops?: string;
  bottoms?: string;
  shoes?: string;
};

export type BuyerAccount = {
  displayName: string;
  email?: string;
  onboardedAt: string;
  card: BuyerCardStatus;
  policy: GovernancePolicy;
  rules: GovernanceRule[];
  ledger: SpendEvent[];
  addresses: BuyerAddress[];
  sizing?: BuyerSizingPrefs;
};

export const EMPTY_POLICY: GovernancePolicy = {
  maxPerTransaction: null,
  maxPerDay: null,
  maxPerWeek: null,
  maxPurchasesPerHour: null,
  maxPurchasesPerDay: null,
};

export const BUYER_TOP_SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;

export function normalizeBuyerSizing(
  raw?: Partial<BuyerSizingPrefs> | null,
): BuyerSizingPrefs | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const tops = String(raw.tops || "")
    .trim()
    .toUpperCase();
  const bottoms = String(raw.bottoms || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  const shoes = String(raw.shoes || "")
    .trim()
    .toLowerCase();
  const sizing: BuyerSizingPrefs = {};
  if (tops && (BUYER_TOP_SIZES as readonly string[]).includes(tops)) {
    sizing.tops = tops;
  }
  if (bottoms) sizing.bottoms = bottoms;
  if (shoes) sizing.shoes = shoes;
  return sizing.tops || sizing.bottoms || sizing.shoes ? sizing : undefined;
}

export function formatSizingSummary(
  sizing?: BuyerSizingPrefs | null,
): string | null {
  if (!sizing) return null;
  const parts: string[] = [];
  if (sizing.tops) parts.push(`tops ${sizing.tops}`);
  if (sizing.bottoms) parts.push(`bottoms ${sizing.bottoms}`);
  if (sizing.shoes) parts.push(`shoes ${sizing.shoes}`);
  return parts.length ? parts.join(" · ") : null;
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function normalizeSpendEvent(raw: Partial<SpendEvent> & { at?: string }): SpendEvent {
  const rail: SpendEvent["rail"] =
    raw.rail === "straitsx-card"
      ? "straitsx-card"
      : raw.rail === "xrpl-xrp"
        ? "xrpl-xrp"
        : raw.rail === "ap4m"
          ? "ap4m"
          : "x402";
  return {
    id: raw.id || `spend_${raw.at || Date.now()}`,
    at: raw.at || new Date().toISOString(),
    amount: Number(raw.amount) || 0,
    rail,
    title: String(raw.title || "Purchase"),
    storeSlug: raw.storeSlug ? String(raw.storeSlug) : undefined,
    storeName: raw.storeName ? String(raw.storeName) : undefined,
    merchantDisplayName: raw.merchantDisplayName
      ? String(raw.merchantDisplayName)
      : undefined,
    merchantReceive: raw.merchantReceive
      ? String(raw.merchantReceive)
      : undefined,
    skuId: raw.skuId ? String(raw.skuId) : undefined,
    imageUrl: raw.imageUrl ? String(raw.imageUrl) : undefined,
    explorerUrl: raw.explorerUrl ? String(raw.explorerUrl) : undefined,
    sentXrp: raw.sentXrp ? String(raw.sentXrp) : undefined,
    deliveredRlusd: raw.deliveredRlusd ? String(raw.deliveredRlusd) : undefined,
    orderId: raw.orderId ? String(raw.orderId) : undefined,
    cardOpaqueId: raw.cardOpaqueId ? String(raw.cardOpaqueId) : undefined,
    truncatedPan: raw.truncatedPan ? String(raw.truncatedPan) : undefined,
    reviewId: raw.reviewId ? String(raw.reviewId) : undefined,
  };
}

function startOfLocalDay(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function startOfLocalWeek(d = new Date()) {
  const day = d.getDay(); // 0 Sun
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + mondayOffset);
  return monday.getTime();
}

export function normalizeBuyerAccount(
  data: Partial<BuyerAccount> & { displayName?: string },
): BuyerAccount | null {
  if (!data?.displayName) return null;
  return {
    displayName: String(data.displayName),
    email: data.email ? String(data.email) : undefined,
    onboardedAt: String(data.onboardedAt || new Date().toISOString()),
    card: data.card ?? { issued: false },
    policy: { ...EMPTY_POLICY, ...data.policy },
    rules: Array.isArray(data.rules) ? data.rules : [],
    ledger: Array.isArray(data.ledger)
      ? data.ledger.map(normalizeSpendEvent)
      : [],
    addresses: Array.isArray(data.addresses)
      ? data.addresses.map((a) => ({
          id: String(a.id || cryptoRandomId()),
          label: String(a.label || "Home"),
          line1: String(a.line1 || ""),
          line2: a.line2 ? String(a.line2) : undefined,
          city: String(a.city || ""),
          country: String(a.country || ""),
          postal: a.postal ? String(a.postal) : undefined,
        }))
      : [],
    sizing: normalizeBuyerSizing(data.sizing),
  };
}

function cryptoRandomId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id_${Date.now()}`;
}

export function readBuyerAccount(): BuyerAccount | null {
  if (!canUseStorage()) return null;
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY);
    if (!raw) return null;
    return normalizeBuyerAccount(JSON.parse(raw) as Partial<BuyerAccount>);
  } catch {
    return null;
  }
}

/** Optional hook: when set, every local write also syncs to Firestore. */
let cloudSyncUid: string | null = null;

export function setBuyerCloudSyncUid(uid: string | null) {
  cloudSyncUid = uid;
}

export function getBuyerCloudSyncUid() {
  return cloudSyncUid;
}

export function writeBuyerAccount(account: BuyerAccount) {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
  } catch {
    // quota / private mode
  }
  if (cloudSyncUid) {
    void import("@/lib/firebase/buyer-auth")
      .then(({ saveBuyerToCloud }) => saveBuyerToCloud(cloudSyncUid!, account))
      .catch((err) => {
        console.error("[borneo] Firestore sync failed", err);
      });
  }
}

export function clearBuyerAccount() {
  if (!canUseStorage()) return;
  try {
    localStorage.removeItem(ACCOUNT_KEY);
  } catch {
    // ignore
  }
  // Drop buyer shop session; leave merchant onboard / lastStore intact
  try {
    if (typeof sessionStorage === "undefined") return;
    const raw = sessionStorage.getItem("borneo.demo.session.v2");
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    delete parsed.buyer;
    sessionStorage.setItem("borneo.demo.session.v2", JSON.stringify(parsed));
  } catch {
    // ignore
  }
}

export function createBuyerAccount(args: {
  displayName: string;
  email?: string;
  policy?: Partial<GovernancePolicy>;
}): BuyerAccount {
  const account: BuyerAccount = {
    displayName: args.displayName.trim() || "Buyer",
    email: args.email?.trim().toLowerCase(),
    onboardedAt: new Date().toISOString(),
    card: { issued: false },
    policy: { ...EMPTY_POLICY, ...args.policy },
    rules: [],
    ledger: [],
    addresses: [],
  };
  writeBuyerAccount(account);
  return account;
}

export function updateBuyerAccount(
  patch: Partial<Omit<BuyerAccount, "policy" | "card">> & {
    policy?: Partial<GovernancePolicy>;
    card?: Partial<BuyerCardStatus>;
  },
): BuyerAccount | null {
  const current = readBuyerAccount();
  if (!current) return null;
  const next: BuyerAccount = {
    ...current,
    ...patch,
    policy: patch.policy
      ? { ...current.policy, ...patch.policy }
      : current.policy,
    card: patch.card ? { ...current.card, ...patch.card } : current.card,
    rules: patch.rules ?? current.rules,
    ledger: patch.ledger ?? current.ledger,
    addresses: patch.addresses ?? current.addresses,
    sizing:
      patch.sizing !== undefined
        ? normalizeBuyerSizing(patch.sizing)
        : current.sizing,
  };
  writeBuyerAccount(next);
  return next;
}

/** Prefer the tighter (smaller) positive number; null loses to a set value. */
export function tightenPolicy(
  current: GovernancePolicy,
  incoming: Partial<GovernancePolicy>,
): GovernancePolicy {
  const merge = (
    a: number | null,
    b: number | null | undefined,
  ): number | null => {
    if (b == null || !Number.isFinite(b) || b <= 0) return a;
    if (a == null) return b;
    return Math.min(a, b);
  };
  return {
    maxPerTransaction: merge(current.maxPerTransaction, incoming.maxPerTransaction),
    maxPerDay: merge(current.maxPerDay, incoming.maxPerDay),
    maxPerWeek: merge(current.maxPerWeek, incoming.maxPerWeek),
    maxPurchasesPerHour: merge(
      current.maxPurchasesPerHour,
      incoming.maxPurchasesPerHour,
    ),
    maxPurchasesPerDay: merge(
      current.maxPurchasesPerDay,
      incoming.maxPurchasesPerDay,
    ),
  };
}

/**
 * Apply an approved NL parse: any field present in `incoming` overwrites
 * the current value. Unmentioned fields stay as-is.
 */
export function applyPolicyPatch(
  current: GovernancePolicy,
  incoming: Partial<GovernancePolicy>,
): GovernancePolicy {
  const next = { ...current };
  const keys: (keyof GovernancePolicy)[] = [
    "maxPerTransaction",
    "maxPerDay",
    "maxPerWeek",
    "maxPurchasesPerHour",
    "maxPurchasesPerDay",
  ];
  for (const key of keys) {
    const v = incoming[key];
    if (v != null && Number.isFinite(v) && v > 0) {
      next[key] = v;
    }
  }
  return next;
}

export function spentInRange(
  ledger: SpendEvent[],
  fromMs: number,
  toMs = Date.now(),
): number {
  return ledger
    .filter((e) => {
      const t = new Date(e.at).getTime();
      return t >= fromMs && t <= toMs;
    })
    .reduce((sum, e) => sum + e.amount, 0);
}

export function purchaseCountInRange(
  ledger: SpendEvent[],
  fromMs: number,
  toMs = Date.now(),
): number {
  return ledger.filter((e) => {
    const t = new Date(e.at).getTime();
    return t >= fromMs && t <= toMs;
  }).length;
}

export function remainingCaps(
  account: BuyerAccount,
  now = Date.now(),
): {
  remainingDaily: number | null;
  remainingWeekly: number | null;
  maxPerTransaction: number | null;
} {
  const { policy, ledger } = account;
  const daySpent = spentInRange(ledger, startOfLocalDay(new Date(now)), now);
  const weekSpent = spentInRange(ledger, startOfLocalWeek(new Date(now)), now);
  return {
    maxPerTransaction: policy.maxPerTransaction,
    remainingDaily:
      policy.maxPerDay == null
        ? null
        : Math.max(0, policy.maxPerDay - daySpent),
    remainingWeekly:
      policy.maxPerWeek == null
        ? null
        : Math.max(0, policy.maxPerWeek - weekSpent),
  };
}

/** Mandate spendCap = min(price, remaining daily/weekly, max per tx). */
export function mandateSpendCap(
  account: BuyerAccount,
  price: number,
): number {
  const caps = remainingCaps(account);
  let cap = price;
  if (caps.maxPerTransaction != null) {
    cap = Math.min(cap, caps.maxPerTransaction);
  }
  if (caps.remainingDaily != null) {
    cap = Math.min(cap, caps.remainingDaily);
  }
  if (caps.remainingWeekly != null) {
    cap = Math.min(cap, caps.remainingWeekly);
  }
  return Math.max(0, Number(cap.toFixed(6)));
}

export function evaluatePolicy(
  account: BuyerAccount,
  amount: number,
  now = Date.now(),
): { ok: true } | { ok: false; reason: string } {
  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, reason: "Invalid purchase amount" };
  }

  const { policy, ledger } = account;

  if (
    policy.maxPerTransaction != null &&
    amount > policy.maxPerTransaction + 1e-9
  ) {
    return {
      ok: false,
      reason: `Per-transaction limit ${policy.maxPerTransaction} exceeded (this purchase is ${amount})`,
    };
  }

  const dayStart = startOfLocalDay(new Date(now));
  const weekStart = startOfLocalWeek(new Date(now));
  const hourStart = now - 60 * 60 * 1000;

  if (policy.maxPerDay != null) {
    const daySpent = spentInRange(ledger, dayStart, now);
    if (daySpent + amount > policy.maxPerDay + 1e-9) {
      return {
        ok: false,
        reason: `Daily spend limit ${policy.maxPerDay} exceeded (spent ${daySpent.toFixed(2)} today, this purchase ${amount})`,
      };
    }
  }

  if (policy.maxPerWeek != null) {
    const weekSpent = spentInRange(ledger, weekStart, now);
    if (weekSpent + amount > policy.maxPerWeek + 1e-9) {
      return {
        ok: false,
        reason: `Weekly spend limit ${policy.maxPerWeek} exceeded (spent ${weekSpent.toFixed(2)} this week, this purchase ${amount})`,
      };
    }
  }

  if (policy.maxPurchasesPerHour != null) {
    const count = purchaseCountInRange(ledger, hourStart, now);
    if (count >= policy.maxPurchasesPerHour) {
      return {
        ok: false,
        reason: `Hourly purchase rate limit ${policy.maxPurchasesPerHour} reached`,
      };
    }
  }

  if (policy.maxPurchasesPerDay != null) {
    const count = purchaseCountInRange(ledger, dayStart, now);
    if (count >= policy.maxPurchasesPerDay) {
      return {
        ok: false,
        reason: `Daily purchase rate limit ${policy.maxPurchasesPerDay} reached`,
      };
    }
  }

  return { ok: true };
}

export function recordSpend(args: {
  amount: number;
  rail: "x402" | "straitsx-card" | "xrpl-xrp" | "ap4m";
  title: string;
  storeSlug?: string;
  storeName?: string;
  merchantDisplayName?: string;
  merchantReceive?: string;
  skuId?: string;
  imageUrl?: string;
  explorerUrl?: string;
  sentXrp?: string;
  deliveredRlusd?: string;
  orderId?: string;
  cardOpaqueId?: string;
  truncatedPan?: string;
}): BuyerAccount | null {
  const current = readBuyerAccount();
  if (!current) return null;
  const event = normalizeSpendEvent({
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `spend_${Date.now()}`,
    at: new Date().toISOString(),
    amount: args.amount,
    rail: args.rail,
    title: args.title,
    storeSlug: args.storeSlug,
    storeName: args.storeName,
    merchantDisplayName: args.merchantDisplayName,
    merchantReceive: args.merchantReceive,
    skuId: args.skuId,
    imageUrl: args.imageUrl,
    explorerUrl: args.explorerUrl,
    sentXrp: args.sentXrp,
    deliveredRlusd: args.deliveredRlusd,
    orderId: args.orderId,
    cardOpaqueId: args.cardOpaqueId,
    truncatedPan: args.truncatedPan,
  });
  return updateBuyerAccount({
    ledger: [...current.ledger, event],
  });
}

/** Attach a reviewId to a ledger spend event (by spend id or orderId). */
export function markSpendReviewed(args: {
  spendId?: string;
  orderId?: string;
  reviewId: string;
}): BuyerAccount | null {
  const current = readBuyerAccount();
  if (!current) return null;
  const reviewId = args.reviewId.trim();
  if (!reviewId) return current;
  const ledger = current.ledger.map((e) => {
    const match =
      (args.spendId && e.id === args.spendId) ||
      (args.orderId && e.orderId === args.orderId);
    return match ? { ...e, reviewId } : e;
  });
  return updateBuyerAccount({ ledger });
}

export function railLabel(rail: SpendEvent["rail"]) {
  if (rail === "xrpl-xrp") return "XRP → RLUSD";
  if (rail === "ap4m") return "Mastercard · AP4M";
  if (rail === "straitsx-card") return "Mastercard";
  return "RLUSD · x402";
}

export function markCardIssued(args: {
  truncatedPan?: string;
  source?: string;
}): BuyerAccount | null {
  return updateBuyerAccount({
    card: {
      issued: true,
      truncatedPan: args.truncatedPan,
      lastIssuedAt: new Date().toISOString(),
      source: args.source,
    },
  });
}

export function formatPolicySummary(policy: GovernancePolicy): string[] {
  const lines: string[] = [];
  if (policy.maxPerTransaction != null) {
    lines.push(`Max ${policy.maxPerTransaction} per transaction`);
  }
  if (policy.maxPerDay != null) {
    lines.push(`Max ${policy.maxPerDay} per day`);
  }
  if (policy.maxPerWeek != null) {
    lines.push(`Max ${policy.maxPerWeek} per week`);
  }
  if (policy.maxPurchasesPerHour != null) {
    lines.push(`Max ${policy.maxPurchasesPerHour} purchases per hour`);
  }
  if (policy.maxPurchasesPerDay != null) {
    lines.push(`Max ${policy.maxPurchasesPerDay} purchases per day`);
  }
  if (lines.length === 0) lines.push("No spend limits set");
  return lines;
}

/** Deterministic NL → policy (no LLM). Used as API fallback. */
export function parseGovernanceText(text: string): {
  summary: string;
  policy: Partial<GovernancePolicy>;
} {
  const lower = text.toLowerCase().replace(/,/g, " ");
  const policy: Partial<GovernancePolicy> = {};

  const tx =
    lower.match(
      /(?:cannot|can't|no more than|not more than|max(?:imum)?|limit(?:ed)?(?: to)?|up to)\s*(?:spend\s*)?(?:more than\s*)?([\d.]+)\s*(?:usdc|usd|sgd)?\s*(?:in\s+)?(?:1|one|a|per)?\s*(?:transaction|purchase|payment|tx)/i,
    ) ||
    lower.match(
      /([\d.]+)\s*(?:usdc|usd|sgd)?\s*(?:per|\/)\s*(?:transaction|purchase|payment|tx)/i,
    );
  if (tx) policy.maxPerTransaction = Number(tx[1]);

  const day =
    lower.match(
      /(?:cannot|can't|no more than|not more than|max(?:imum)?|limit(?:ed)?(?: to)?|up to|and)\s*(?:spend\s*)?(?:more than\s*)?([\d.]+)\s*(?:usdc|usd|sgd)?\s*(?:per|\/|a|each)?\s*day/i,
    ) || lower.match(/([\d.]+)\s*(?:usdc|usd|sgd)?\s*(?:per|\/)\s*day/i);
  if (day) policy.maxPerDay = Number(day[1]);

  const week =
    lower.match(
      /(?:cannot|can't|no more than|not more than|max(?:imum)?|limit(?:ed)?(?: to)?|up to|and)\s*(?:spend\s*)?(?:more than\s*)?([\d.]+)\s*(?:usdc|usd|sgd)?\s*(?:per|\/|a|each)?\s*week/i,
    ) || lower.match(/([\d.]+)\s*(?:usdc|usd|sgd)?\s*(?:per|\/)\s*week/i);
  if (week) policy.maxPerWeek = Number(week[1]);

  const perHour = lower.match(
    /([\d.]+)\s*(?:purchases?|buys?|orders?)\s*(?:per|\/|an?)\s*hour/i,
  );
  if (perHour) policy.maxPurchasesPerHour = Number(perHour[1]);

  const perDayCount = lower.match(
    /([\d.]+)\s*(?:purchases?|buys?|orders?)\s*(?:per|\/|a)\s*day/i,
  );
  if (perDayCount) policy.maxPurchasesPerDay = Number(perDayCount[1]);

  // Sanitize
  for (const key of Object.keys(policy) as (keyof GovernancePolicy)[]) {
    const v = policy[key];
    if (v == null || !Number.isFinite(v) || v <= 0) delete policy[key];
  }

  const bits = formatPolicySummary({ ...EMPTY_POLICY, ...policy }).filter(
    (l) => l !== "No spend limits set",
  );
  const summary =
    bits.length > 0
      ? bits.join("; ")
      : "Could not extract spend limits from that text";

  return { summary, policy };
}
