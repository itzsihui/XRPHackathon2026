import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { authErrorMessage } from "@/lib/firebase/buyer-auth";
import { getFirebaseAuth, getFirebaseDb, isFirebaseConfigured } from "./client";

const MERCHANTS = "merchants";

export type VisaReceiveAccount = {
  accountLabel: string;
  receiveId?: string;
  settlementNote?: string;
};

/**
 * Seller-side rules for AI buyer agents hitting this merchant.
 * Complements buyer spend governance — this is what the store will accept.
 */
export type MerchantGovernance = {
  /** Accept RLUSD / x402 settlements on XRPL */
  acceptUsdc: boolean;
  /** Accept XRP pay-in (converted to RLUSD via AMM/DEX) */
  acceptXrp: boolean;
  /** Accept Mastercard scoped-card rail */
  acceptVisa: boolean;
  /** Floor unit price agents must respect (RLUSD) */
  minUnitPriceUsdc: number | null;
  /** Cap quantity per agent checkout */
  maxUnitsPerOrder: number | null;
  /** Appear on /market discovery */
  listOnMarket: boolean;
  /** Inventory chat must confirm prices before going live */
  requireConfirmBeforePublish: boolean;
  updatedAt?: string;
};

export const DEFAULT_MERCHANT_GOVERNANCE: MerchantGovernance = {
  acceptUsdc: true,
  acceptXrp: true,
  acceptVisa: true,
  minUnitPriceUsdc: null,
  maxUnitsPerOrder: null,
  listOnMarket: true,
  requireConfirmBeforePublish: true,
};

export type MerchantProfile = {
  displayName: string;
  email: string;
  /** XRPL classic r… receive address */
  walletAddress?: string;
  visaReceive?: VisaReceiveAccount;
  governance?: MerchantGovernance;
  storeSlugs: string[];
  createdAt: string;
  /** In-progress fashion inventory draft (seller onboard). */
  onboardingDraft?: MerchantOnboardingDraft | null;
};

export type MerchantOnboardingDraft = {
  updatedAt: string;
  draft: unknown;
  prices?: string[];
  quantities?: string[];
  status?: "need_variants" | "need_price" | "need_wallet";
  ask?: string;
};

function stripUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeGovernance(
  raw: Partial<MerchantGovernance> | undefined,
): MerchantGovernance | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  return {
    acceptUsdc: raw.acceptUsdc !== false,
    acceptXrp: raw.acceptXrp !== false,
    acceptVisa: raw.acceptVisa !== false,
    minUnitPriceUsdc:
      raw.minUnitPriceUsdc != null && Number.isFinite(Number(raw.minUnitPriceUsdc))
        ? Number(raw.minUnitPriceUsdc)
        : null,
    maxUnitsPerOrder:
      raw.maxUnitsPerOrder != null && Number.isFinite(Number(raw.maxUnitsPerOrder))
        ? Math.floor(Number(raw.maxUnitsPerOrder))
        : null,
    listOnMarket: raw.listOnMarket !== false,
    requireConfirmBeforePublish: raw.requireConfirmBeforePublish !== false,
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : undefined,
  };
}

export function normalizeMerchantProfile(
  data: Partial<MerchantProfile> & { email?: string },
): MerchantProfile | null {
  if (!data || typeof data !== "object") return null;
  const email = String(data.email || "").toLowerCase();
  const displayName =
    String(data.displayName || "").trim() ||
    (email ? email.split("@")[0]! : "Merchant");
  return {
    displayName,
    email,
    walletAddress: data.walletAddress
      ? String(data.walletAddress).trim()
      : undefined,
    visaReceive: data.visaReceive
      ? {
          accountLabel: String(data.visaReceive.accountLabel || "Mastercard receive"),
          receiveId: data.visaReceive.receiveId
            ? String(data.visaReceive.receiveId)
            : undefined,
          settlementNote: data.visaReceive.settlementNote
            ? String(data.visaReceive.settlementNote)
            : undefined,
        }
      : undefined,
    governance: normalizeGovernance(data.governance),
    storeSlugs: Array.isArray(data.storeSlugs)
      ? data.storeSlugs.map(String)
      : [],
    createdAt: String(data.createdAt || new Date().toISOString()),
    onboardingDraft: data.onboardingDraft
      ? (data.onboardingDraft as MerchantOnboardingDraft)
      : null,
  };
}

export async function signUpMerchant(args: {
  email: string;
  password: string;
  displayName: string;
}): Promise<{ user: User; profile: MerchantProfile }> {
  const auth = getFirebaseAuth();
  const db = getFirebaseDb();
  if (!auth || !db) throw new Error("Firebase is not configured");

  const cred = await createUserWithEmailAndPassword(
    auth,
    args.email.trim(),
    args.password,
  );
  const name = args.displayName.trim() || "Merchant";
  await updateProfile(cred.user, { displayName: name });

  const profile: MerchantProfile = {
    displayName: name,
    email: args.email.trim().toLowerCase(),
    storeSlugs: [],
    createdAt: new Date().toISOString(),
  };

  await setDoc(doc(db, MERCHANTS, cred.user.uid), {
    ...stripUndefined(profile),
    uid: cred.user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return { user: cred.user, profile };
}

export async function signInMerchant(email: string, password: string) {
  const auth = getFirebaseAuth();
  if (!auth) throw new Error("Firebase is not configured");
  const cred = await signInWithEmailAndPassword(
    auth,
    email.trim(),
    password,
  );
  // Fresh login always starts with an empty inventory draft (0 SKUs).
  await clearMerchantOnboardingDraft(cred.user.uid);
  const profile = await loadMerchantFromCloud(cred.user.uid);
  return {
    user: cred.user,
    profile: profile
      ? { ...profile, onboardingDraft: null }
      : null,
  };
}

export async function signOutMerchant() {
  const auth = getFirebaseAuth();
  if (!auth) return;
  await signOut(auth);
}

export async function loadMerchantFromCloud(
  uid: string,
): Promise<MerchantProfile | null> {
  const db = getFirebaseDb();
  if (!db) return null;
  const snap = await getDoc(doc(db, MERCHANTS, uid));
  if (!snap.exists()) return null;
  return normalizeMerchantProfile(snap.data() as Partial<MerchantProfile>);
}

export async function saveMerchantToCloud(
  uid: string,
  profile: MerchantProfile,
): Promise<void> {
  const db = getFirebaseDb();
  if (!db) throw new Error("Firebase is not configured");
  await setDoc(
    doc(db, MERCHANTS, uid),
    {
      ...stripUndefined(profile),
      uid,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

type MerchantIdentity = {
  email?: string | null;
  displayName?: string | null;
};

/** Create merchants/{uid} if Auth exists but the Firestore doc was never written. */
export async function ensureMerchantProfile(
  uid: string,
  identity?: MerchantIdentity,
): Promise<MerchantProfile> {
  const existing = await loadMerchantFromCloud(uid);
  if (existing) return existing;

  const authUser = getFirebaseAuth()?.currentUser;
  const email = (identity?.email || authUser?.email || "").trim().toLowerCase();
  const displayName = (
    identity?.displayName ||
    authUser?.displayName ||
    email.split("@")[0] ||
    "Merchant"
  ).trim();

  if (!email) {
    throw new Error(
      "Merchant profile is missing. Sign out and create a merchant account.",
    );
  }

  const profile: MerchantProfile = {
    displayName,
    email,
    storeSlugs: [],
    createdAt: new Date().toISOString(),
  };
  await saveMerchantToCloud(uid, profile);
  return profile;
}

export async function bindMerchantWallet(
  uid: string,
  walletAddress: string,
  identity?: MerchantIdentity,
): Promise<MerchantProfile> {
  const current = await ensureMerchantProfile(uid, identity);
  const next: MerchantProfile = { ...current, walletAddress };
  await saveMerchantToCloud(uid, next);
  return next;
}

export async function bindMerchantVisaReceive(
  uid: string,
  visaReceive: VisaReceiveAccount,
  identity?: MerchantIdentity,
): Promise<MerchantProfile> {
  const current = await ensureMerchantProfile(uid, identity);
  const next: MerchantProfile = {
    ...current,
    visaReceive: {
      accountLabel: visaReceive.accountLabel.trim() || "Mastercard receive",
      receiveId: visaReceive.receiveId?.trim() || undefined,
      settlementNote: visaReceive.settlementNote?.trim() || undefined,
    },
  };
  await saveMerchantToCloud(uid, next);
  return next;
}

export async function saveMerchantGovernance(
  uid: string,
  governance: MerchantGovernance,
  identity?: MerchantIdentity,
): Promise<MerchantProfile> {
  const current = await ensureMerchantProfile(uid, identity);
  const next: MerchantProfile = {
    ...current,
    governance: {
      ...DEFAULT_MERCHANT_GOVERNANCE,
      ...governance,
      updatedAt: new Date().toISOString(),
    },
  };
  await saveMerchantToCloud(uid, next);
  return next;
}

export async function appendMerchantStoreSlug(
  uid: string,
  slug: string,
  identity?: MerchantIdentity,
): Promise<void> {
  const current = await ensureMerchantProfile(uid, identity);
  if (current.storeSlugs.includes(slug)) return;
  await saveMerchantToCloud(uid, {
    ...current,
    storeSlugs: [...current.storeSlugs, slug],
  });
}

/** Persist full store catalog so /market can list SKUs after publish. */
export async function savePublishedStoreToCloud(
  store: import("@/lib/store/types").StoreRecord,
): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  const { putCatalogStore } = await import("@/lib/store/firestore-catalog");
  await putCatalogStore(db, {
    ...store,
    listOnMarket: store.listOnMarket !== false,
  });
}

export async function saveMerchantOnboardingDraft(
  uid: string,
  payload: Omit<MerchantOnboardingDraft, "updatedAt"> & { updatedAt?: string },
): Promise<void> {
  const current = await loadMerchantFromCloud(uid);
  if (!current) return;
  const onboardingDraft: MerchantOnboardingDraft = stripUndefined({
    updatedAt: payload.updatedAt || new Date().toISOString(),
    draft: payload.draft,
    prices: payload.prices,
    quantities: payload.quantities,
    status: payload.status,
    ask: payload.ask,
  });
  await saveMerchantToCloud(uid, { ...current, onboardingDraft });
}

export async function clearMerchantOnboardingDraft(uid: string): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  const current = await loadMerchantFromCloud(uid);
  if (!current) return;
  await setDoc(
    doc(db, MERCHANTS, uid),
    {
      ...stripUndefined({ ...current, onboardingDraft: null }),
      uid,
      onboardingDraft: null,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export function merchantReceivingComplete(profile: MerchantProfile | null) {
  // XRPL payTo can fall back to MERCHANT_ADDRESS env — Mastercard label is the hard gate.
  return Boolean(profile?.visaReceive?.accountLabel);
}

/** Mastercard + crypto receive + governance saved at least once. */
export function merchantSetupComplete(profile: MerchantProfile | null) {
  return Boolean(
    merchantReceivingComplete(profile) && profile?.governance?.updatedAt,
  );
}

export function subscribeMerchantAuth(cb: (user: User | null) => void) {
  const auth = getFirebaseAuth();
  if (!auth || !isFirebaseConfigured()) {
    cb(null);
    return () => {};
  }
  return onAuthStateChanged(auth, cb);
}

export { authErrorMessage, isFirebaseConfigured };
