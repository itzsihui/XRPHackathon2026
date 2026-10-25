"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { User } from "firebase/auth";
import {
  appendMerchantStoreSlug,
  authErrorMessage,
  bindMerchantVisaReceive,
  bindMerchantWallet,
  clearMerchantOnboardingDraft,
  ensureMerchantProfile,
  isFirebaseConfigured,
  loadMerchantFromCloud,
  merchantReceivingComplete,
  merchantSetupComplete,
  saveMerchantGovernance,
  saveMerchantOnboardingDraft,
  savePublishedStoreToCloud,
  signInMerchant,
  signOutMerchant,
  signUpMerchant,
  subscribeMerchantAuth,
  type MerchantGovernance,
  type MerchantOnboardingDraft,
  type MerchantProfile,
  type VisaReceiveAccount,
} from "@/lib/firebase/merchant-auth";
import { clearMerchantOnboardSession } from "@/lib/demo-session";
import type { StoreRecord } from "@/lib/store/types";

type MerchantAuthContextValue = {
  configured: boolean;
  ready: boolean;
  user: User | null;
  profile: MerchantProfile | null;
  receivingComplete: boolean;
  setupComplete: boolean;
  refreshProfile: () => Promise<void>;
  signUp: (args: {
    email: string;
    password: string;
    displayName: string;
  }) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  bindWallet: (address: string) => Promise<void>;
  bindVisa: (visa: VisaReceiveAccount) => Promise<void>;
  saveGovernance: (gov: MerchantGovernance) => Promise<void>;
  recordStoreSlug: (slug: string) => Promise<void>;
  /** Persist published catalog to Firestore so /market lists SKUs immediately. */
  recordPublishedStore: (store: StoreRecord) => Promise<void>;
  saveOnboardingDraft: (
    payload: Omit<MerchantOnboardingDraft, "updatedAt"> & { updatedAt?: string },
  ) => Promise<void>;
  clearOnboardingDraft: () => Promise<void>;
  errorMessage: (err: unknown) => string;
};

const MerchantAuthContext = createContext<MerchantAuthContextValue | null>(
  null,
);

export function MerchantAuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const configured = isFirebaseConfigured();
  const [ready, setReady] = useState(!configured);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MerchantProfile | null>(null);

  const refreshProfile = useCallback(async () => {
    if (!user) {
      setProfile(null);
      return;
    }
    try {
      const cloud = await loadMerchantFromCloud(user.uid);
      setProfile(cloud);
    } catch {
      // Offline / Firestore unreachable — keep existing profile in memory
    }
  }, [user]);

  useEffect(() => {
    if (!configured) {
      setReady(true);
      return;
    }
    const unsub = subscribeMerchantAuth(async (next) => {
      setUser(next);
      if (next) {
        try {
          const cloud = await ensureMerchantProfile(next.uid, {
            email: next.email,
            displayName: next.displayName,
          });
          setProfile(cloud);
        } catch {
          try {
            const cloud = await loadMerchantFromCloud(next.uid);
            setProfile(cloud);
          } catch {
            // Offline: continue with Auth user; profile stays null until reconnect
            setProfile(null);
          }
        }
      } else {
        setProfile(null);
      }
      setReady(true);
    });
    return () => unsub();
  }, [configured]);

  const value = useMemo<MerchantAuthContextValue>(
    () => ({
      configured,
      ready,
      user,
      profile,
      receivingComplete: merchantReceivingComplete(profile),
      setupComplete: merchantSetupComplete(profile),
      refreshProfile,
      signUp: async (args) => {
        const { profile: created } = await signUpMerchant(args);
        clearMerchantOnboardSession();
        setProfile(created);
      },
      signIn: async (email, password) => {
        const { profile: loaded } = await signInMerchant(email, password);
        clearMerchantOnboardSession();
        setProfile(loaded);
      },
      signOut: async () => {
        await signOutMerchant();
        clearMerchantOnboardSession();
        setProfile(null);
        setUser(null);
      },
      bindWallet: async (address) => {
        if (!user) throw new Error("Sign in as a merchant first");
        const next = await bindMerchantWallet(user.uid, address, {
          email: user.email,
          displayName: user.displayName,
        });
        setProfile(next);
      },
      bindVisa: async (visa) => {
        if (!user) throw new Error("Sign in as a merchant first");
        const next = await bindMerchantVisaReceive(user.uid, visa, {
          email: user.email,
          displayName: user.displayName,
        });
        setProfile(next);
      },
      saveGovernance: async (gov) => {
        if (!user) throw new Error("Sign in as a merchant first");
        const next = await saveMerchantGovernance(user.uid, gov, {
          email: user.email,
          displayName: user.displayName,
        });
        setProfile(next);
      },
      recordStoreSlug: async (slug) => {
        if (!user) return;
        await appendMerchantStoreSlug(user.uid, slug, {
          email: user.email,
          displayName: user.displayName,
        });
        await refreshProfile();
      },
      recordPublishedStore: async (store) => {
        if (!user) return;
        await savePublishedStoreToCloud({
          ...store,
          ownerUid: store.ownerUid || user.uid,
        });
        await appendMerchantStoreSlug(user.uid, store.slug, {
          email: user.email,
          displayName: user.displayName,
        });
        await refreshProfile();
      },
      saveOnboardingDraft: async (payload) => {
        if (!user) return;
        await saveMerchantOnboardingDraft(user.uid, payload);
        await refreshProfile();
      },
      clearOnboardingDraft: async () => {
        if (!user) return;
        await clearMerchantOnboardingDraft(user.uid);
        await refreshProfile();
      },
      errorMessage: authErrorMessage,
    }),
    [configured, ready, user, profile, refreshProfile],
  );

  return (
    <MerchantAuthContext.Provider value={value}>
      {children}
    </MerchantAuthContext.Provider>
  );
}

export function useMerchantAuth() {
  const ctx = useContext(MerchantAuthContext);
  if (!ctx) {
    throw new Error("useMerchantAuth must be used within MerchantAuthProvider");
  }
  return ctx;
}
