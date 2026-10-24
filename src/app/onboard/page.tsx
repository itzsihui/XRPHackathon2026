"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MerchantChat,
  PriceDraftForm,
  type ChatLine,
  type StarterAction,
} from "@/components/onboard/merchant-chat";
import {
  InventorySheet,
  InventorySheetBar,
} from "@/components/onboard/inventory-sheet";
import {
  DiscoveryPane,
  EndpointLab,
} from "@/components/onboard/discovery-panes";
import { useMerchantAuth } from "@/app/merchant/_components/merchant-auth-provider";
import {
  normalizeDraft,
  type MerchantDraft,
} from "@/lib/inventory/parse";
import { isFashionLineComplete } from "@/lib/inventory/fashion";
import {
  DEFAULT_ONBOARD_LINES,
  DEFAULT_ONBOARD_MESSAGE,
  defaultBuyerPrompt,
  readDemoSession,
  storeRefFromPublish,
  writeDemoSession,
} from "@/lib/demo-session";
import {
  type MerchantAuthProof,
} from "@/lib/wallet/xrpl";

export default function OnboardPage() {
  const router = useRouter();
  const merchant = useMerchantAuth();
  const [hydrated, setHydrated] = useState(false);
  const [message, setMessage] = useState(DEFAULT_ONBOARD_MESSAGE);
  const [lines, setLines] = useState<ChatLine[]>(DEFAULT_ONBOARD_LINES);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<MerchantDraft | null>(null);
  const [prices, setPrices] = useState<string[]>([]);
  const [quantities, setQuantities] = useState<string[]>([]);
  const [slug, setSlug] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [merchantAuth, setMerchantAuth] = useState<MerchantAuthProof | null>(
    null,
  );
  const [storeUrl, setStoreUrl] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);

  const merchantAddress =
    merchantAuth?.address ?? merchant.profile?.walletAddress ?? null;
  const boundWalletAddress = merchant.profile?.walletAddress ?? null;
  const visaReady = Boolean(merchant.profile?.visaReceive?.accountLabel);
  const visaReceive = merchant.profile?.visaReceive || undefined;
  /** Visa receive is required; XRPL payTo falls back to MERCHANT_ADDRESS env. */
  const railsReady = visaReady;

  useEffect(() => {
    if (!merchant.ready) return;
    if (merchant.configured && !merchant.user) {
      router.replace("/merchant/login");
      return;
    }
    if (merchant.user && !merchant.setupComplete) {
      router.replace("/merchant/setup");
    }
  }, [
    merchant.ready,
    merchant.configured,
    merchant.user,
    merchant.setupComplete,
    router,
  ]);

  useEffect(() => {
    if (!merchant.ready || hydrated) return;

    async function hydrate() {
      const cloud = merchant.profile?.onboardingDraft;
      if (cloud?.draft) {
        const nextDraft = normalizeDraft(cloud.draft as MerchantDraft);
        if (nextDraft) {
          setDraft(nextDraft);
          setPrices(
            cloud.prices?.length
              ? cloud.prices
              : nextDraft.lines.map((l) => l.price ?? ""),
          );
          setQuantities(
            cloud.quantities?.length
              ? cloud.quantities
              : nextDraft.lines.map((l) => String(l.quantity)),
          );
          // Discovery / x402 panes stay hidden until publish succeeds this visit
          setSlug(null);
          setHydrated(true);
          return;
        }
      }

      const session = readDemoSession();
      if (session.onboard) {
        setMessage(session.onboard.message || DEFAULT_ONBOARD_MESSAGE);
        setLines(
          session.onboard.lines?.length
            ? session.onboard.lines
            : DEFAULT_ONBOARD_LINES,
        );
        setDraft(normalizeDraft(session.onboard.draft));
        const nextDraft = normalizeDraft(session.onboard.draft);
        setPrices(
          session.onboard.prices?.length
            ? session.onboard.prices
            : nextDraft?.lines.map((l) => l.price ?? "") ?? [],
        );
        setQuantities(
          session.onboard.quantities?.length
            ? session.onboard.quantities
            : nextDraft?.lines.map((l) => String(l.quantity)) ?? [],
        );
        const saved = session.onboard.merchantAuth as MerchantAuthProof | null;
        if (saved?.address && saved.signature && saved.message) {
          setMerchantAuth(saved);
        }
      }

      // Never restore slug from session/profile — shared or prior stores
      // would flash Agent discovery + x402 before this merchant publishes.
      setSlug(null);
      setHydrated(true);
    }

    void hydrate();
  }, [
    merchant.ready,
    merchant.profile?.onboardingDraft,
    hydrated,
  ]);

  useEffect(() => {
    if (!hydrated) return;
    writeDemoSession({
      onboard: {
        message,
        lines,
        draft,
        prices,
        quantities,
        slug,
        merchantAddress,
        merchantAuth,
      },
    });
  }, [
    hydrated,
    message,
    lines,
    draft,
    prices,
    quantities,
    slug,
    merchantAddress,
    merchantAuth,
  ]);

  useEffect(() => {
    if (!hydrated || !merchant.user || !draft) return;
    const handle = window.setTimeout(() => {
      void merchant.saveOnboardingDraft({
        draft,
        prices,
        quantities,
        status: draft.lines.every((l) => isFashionLineComplete(l))
          ? "need_price"
          : "need_variants",
      });
    }, 600);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- merchant methods are stable enough
  }, [hydrated, merchant.user, draft, prices, quantities]);

  async function callAgent(
    payload: {
      message?: string;
      csv?: string;
      url?: string;
      draft?: MerchantDraft | null;
      prices?: string[];
    },
    authOverride?: MerchantAuthProof | null,
  ) {
    setBusy(true);
    try {
      const res = await fetch("/api/merchant-agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: payload.message,
          csv: payload.csv,
          url: payload.url,
          draft: payload.draft,
          prices: payload.prices,
          merchantAuth: authOverride ?? merchantAuth,
          ownerUid: merchant.user?.uid,
          merchantDisplayName:
            merchant.profile?.displayName || merchant.user?.displayName || undefined,
          visaReceive,
          existingSlug: slug || merchant.profile?.storeSlugs?.[0] || null,
          boundWalletAddress,
          listOnMarket:
            merchant.profile?.governance?.listOnMarket !== false,
          acceptRlusd: merchant.profile?.governance?.acceptUsdc !== false,
          acceptXrp: merchant.profile?.governance?.acceptXrp !== false,
          acceptVisa: merchant.profile?.governance?.acceptVisa !== false,
        }),
      });
      const raw = await res.text();
      let data: {
        reply: string;
        store: import("@/lib/store/types").StoreRecord | null;
        status?:
          | "published"
          | "need_price"
          | "need_variants"
          | "need_wallet"
          | "clarify";
        draft?: MerchantDraft | null;
        llm?: string;
      };
      try {
        data = JSON.parse(raw) as typeof data;
      } catch {
        throw new Error(
          raw.trim()
            ? `Merchant agent returned non-JSON (${res.status})`
            : `Merchant agent returned empty response (${res.status})`,
        );
      }
      if (!data.reply) {
        data.reply = "No reply from merchant agent.";
      }
      const nextDraft =
        data.status === "need_price" ||
        data.status === "need_variants" ||
        data.status === "need_wallet" ||
        data.status === "published"
          ? normalizeDraft(data.draft)
          : null;
      if (nextDraft) {
        setDraft(nextDraft);
        setPrices(
          nextDraft.lines.map((line, i) =>
            String(line.price || prices[i] || ""),
          ),
        );
        setQuantities(
          nextDraft.lines.map((line, i) =>
            String(quantities[i] || line.quantity || "100"),
          ),
        );
        if (data.status !== "published") {
          void merchant.saveOnboardingDraft({
            draft: nextDraft,
            prices: nextDraft.lines.map((line, i) =>
              String(line.price || prices[i] || ""),
            ),
            quantities: nextDraft.lines.map((line, i) =>
              String(quantities[i] || line.quantity || "100"),
            ),
            status:
              data.status === "need_wallet"
                ? "need_wallet"
                : data.status === "need_variants"
                  ? "need_variants"
                  : "need_price",
            ask: data.reply,
          });
        }
      } else if (
        data.status !== "published" &&
        data.status !== "need_price" &&
        data.status !== "need_variants" &&
        data.status !== "need_wallet"
      ) {
        /* clarify without draft — leave existing sheet alone */
      }
      if (data.status === "published" && data.store?.slug) {
        setSlug(data.store.slug);
        setRefreshKey((k) => k + 1);
        if (data.store.skus?.length) {
          await merchant.recordPublishedStore(data.store);
        } else {
          await merchant.recordStoreSlug(data.store.slug);
        }
        await merchant.clearOnboardingDraft();
        // Keep working sheet after publish when API returned draft; else keep prior
        if (!nextDraft && draft) {
          setDraft({
            ...draft,
            slug: data.store.slug,
            name: data.store.name || draft.name,
          });
        }
        const ref = storeRefFromPublish(data.store);
        writeDemoSession({
          lastStore: ref,
          buyer: {
            input: defaultBuyerPrompt(ref),
            lines: readDemoSession().buyer?.lines ?? [
              {
                role: "agent",
                text: "Buyer agent ready. I will read llms.txt / agent.json, not HTML.",
              },
            ],
          },
        });
      }
      setLines((prev) => [
        ...prev,
        {
          role: "borneo",
          text: data.reply,
          llm: data.llm,
        },
      ]);
    } catch (error) {
      setLines((prev) => [
        ...prev,
        {
          role: "borneo",
          text:
            error instanceof Error
              ? error.message
              : "Merchant agent request failed",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function applyAuth(proof: MerchantAuthProof) {
    setMerchantAuth(proof);
    try {
      await merchant.bindWallet(proof.address);
    } catch {
      /* profile bind best-effort; publish still uses signed proof */
    }

    const nextPrices = draft
      ? draft.lines.map((l, i) => prices[i] || l.price || "")
      : [];
    const canPublish =
      Boolean(draft) &&
      nextPrices.every((p) => String(p).trim()) &&
      Boolean(visaReceive?.accountLabel);

    setLines((prev) => [
      ...prev,
      {
        role: "merchant",
        text: `Receiving wallet ready for settlements`,
      },
      ...(canPublish
        ? []
        : [
            {
              role: "borneo" as const,
              text: visaReceive?.accountLabel
                ? `Crypto receive is ${proof.address}. Describe products, import a CSV, or paste a Shopify URL when you're ready.`
                : `Crypto receive is ${proof.address}. Finish Visa + governance on Setup before publishing.`,
            },
          ]),
    ]);

    if (canPublish && draft) {
      const nextDraft: MerchantDraft = {
        ...draft,
        lines: draft.lines.map((l, i) => ({
          ...l,
          quantity: Math.max(
            1,
            Math.floor(Number(quantities[i]) || l.quantity || 100),
          ),
          price: nextPrices[i],
        })),
      };
      await callAgent(
        {
          draft: nextDraft,
          prices: nextPrices,
        },
        proof,
      );
    }
  }

  function onStarter(action: StarterAction) {
    if (action === "describe") {
      setLines((prev) => [
        ...prev,
        {
          role: "borneo",
          text: "Share a fashion description — e.g. “10 linen shirts, 8 tote bags, 6 sneakers” — and I'll draft the listing, then ask for RLUSD prices.",
        },
      ]);
      return;
    }
    if (action === "import") {
      setLines((prev) => [
        ...prev,
        {
          role: "borneo",
          text: "Choose a CSV with title, description, quantity, price. Quote any description that contains commas.",
        },
      ]);
      return;
    }
    setLines((prev) => [
      ...prev,
      {
        role: "borneo",
        text: "Paste a Shopify storefront URL. We’ll pull products, keep USD≈RLUSD suggestions, and ask you to confirm prices.",
      },
    ]);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = message.trim();
    if (!text) return;
    setLines((prev) => [...prev, { role: "merchant", text }]);
    setMessage("");
    await callAgent({ message: text, draft });
  }

  async function onFile(file: File) {
    const csv = await file.text();
    setLines((prev) => [
      ...prev,
      { role: "merchant", text: `Uploaded ${file.name}` },
    ]);
    await callAgent({ csv, draft });
  }

  async function onImportUrl() {
    const url = storeUrl.trim();
    if (!url) return;
    setDraft(null);
    setPrices([]);
    setQuantities([]);
    setLines((prev) => [
      ...prev,
      { role: "merchant", text: `Import store ${url}` },
    ]);
    await callAgent({ url, draft: null });
  }

  async function onSubmitPrices() {
    if (!draft) return;
    if (!visaReceive?.accountLabel) {
      setLines((prev) => [
        ...prev,
        {
          role: "borneo",
          text: "Finish Visa receive on Setup before publishing. Both crypto and Visa rails are required.",
        },
      ]);
      router.push("/merchant/setup");
      return;
    }
    const nextDraft: MerchantDraft = {
      ...draft,
      lines: draft.lines.map((line, i) => {
        const qty = Math.max(
          1,
          Math.floor(Number(quantities[i]) || line.quantity || 100),
        );
        return {
          ...line,
          quantity: qty,
        };
      }),
    };
    setDraft(nextDraft);
    setLines((prev) => [
      ...prev,
      {
        role: "merchant",
        text: nextDraft.lines
          .map((line, i) => `${line.quantity} ${line.title} @ ${prices[i]} RLUSD`)
          .join(", "),
      },
    ]);

    if (!visaReady) {
      setLines((prev) => [
        ...prev,
        {
          role: "borneo",
          text: "Finish Visa receive on Setup before publishing.",
        },
      ]);
      return;
    }

    await callAgent({ draft: nextDraft, prices });
  }

  async function saveLiveToStore() {
    if (!draft || !slug) return;
    if (!visaReceive?.accountLabel) {
      setLines((prev) => [
        ...prev,
        {
          role: "borneo",
          text: "Finish Visa receive on Setup before saving to the live store.",
        },
      ]);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/merchant-inventory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug,
          draft,
          prices,
          quantities,
          merchantAuth,
          ownerUid: merchant.user?.uid,
          merchantDisplayName:
            merchant.profile?.displayName ||
            merchant.user?.displayName ||
            undefined,
          visaReceive,
          boundWalletAddress,
          listOnMarket:
            merchant.profile?.governance?.listOnMarket !== false,
          acceptRlusd: merchant.profile?.governance?.acceptUsdc !== false,
          acceptXrp: merchant.profile?.governance?.acceptXrp !== false,
          acceptVisa: merchant.profile?.governance?.acceptVisa !== false,
        }),
      });
      const data = (await res.json()) as {
        reply?: string;
        draft?: MerchantDraft | null;
        store?: import("@/lib/store/types").StoreRecord | null;
        status?: string;
      };
      if (data.draft) {
        const next = normalizeDraft(data.draft);
        if (next) {
          setDraft(next);
          setPrices(next.lines.map((l) => l.price ?? ""));
          setQuantities(next.lines.map((l) => String(l.quantity)));
        }
      }
      if (data.store?.slug) {
        setRefreshKey((k) => k + 1);
        if (data.status === "published" && data.store.skus?.length) {
          await merchant.recordPublishedStore(data.store);
        }
      }
      setLines((prev) => [
        ...prev,
        {
          role: "borneo",
          text: data.reply || "Inventory saved.",
        },
      ]);
    } catch (error) {
      setLines((prev) => [
        ...prev,
        {
          role: "borneo",
          text:
            error instanceof Error
              ? error.message
              : "Could not save inventory to store.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  if (!merchant.ready) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading merchant…</p>
      </div>
    );
  }

  if (merchant.configured && !merchant.user) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Redirecting to sign in…</p>
      </div>
    );
  }

  if (!merchant.configured) {
    return (
      <main className="mx-auto max-w-lg px-6 py-12">
        <p className="text-sm text-muted-foreground">
          Firebase is not configured. Add NEXT_PUBLIC_FIREBASE_* keys, then
          create a merchant account to open a store.
        </p>
        <Link
          href="/merchant/signup"
          className="mt-4 inline-block text-sm underline"
        >
          Merchant signup
        </Link>
      </main>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <main className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-1 flex-col gap-2 overflow-hidden px-3 py-3 sm:px-6">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-1">
            <p className="text-[11px] text-foreground/45">
              Signed in as{" "}
              <span className="text-foreground/70">
                {merchant.profile?.displayName || merchant.user?.email}
              </span>
              {slug ? (
                <>
                  {" "}
                  · Live{" "}
                  <span className="font-mono text-foreground/70">/s/{slug}</span>
                </>
              ) : null}
            </p>
            <Link
              href="/merchant/setup"
              className="text-[11px] text-foreground/50 underline-offset-2 hover:underline"
            >
              Settings
            </Link>
          </div>

          <MerchantChat
            lines={lines}
            message={message}
            setMessage={setMessage}
            busy={busy}
            onSubmit={onSubmit}
            onFile={onFile}
            storeUrl={storeUrl}
            setStoreUrl={setStoreUrl}
            onImportUrl={onImportUrl}
            onStarter={onStarter}
            onOpenSheet={() => setSheetOpen(true)}
            sheetSkuCount={draft?.lines.length ?? 0}
            belowMessages={
              <>
                {draft ? (
                  <InventorySheetBar
                    count={draft.lines.length}
                    onOpen={() => setSheetOpen(true)}
                    live={Boolean(slug)}
                  />
                ) : null}
                {draft ? (
                  <div className="lg:hidden">
                    <PriceDraftForm
                      draft={draft}
                      setDraft={setDraft}
                      prices={prices}
                      setPrices={setPrices}
                      quantities={quantities}
                      setQuantities={setQuantities}
                      busy={busy}
                      onSubmit={onSubmitPrices}
                      walletReady={railsReady}
                    />
                  </div>
                ) : null}
                {slug ? (
                  <div className="grid gap-3 lg:grid-cols-2">
                    <DiscoveryPane
                      slug={slug}
                      refreshKey={refreshKey}
                      className="min-h-[220px]"
                    />
                    <EndpointLab
                      slug={slug}
                      refreshKey={refreshKey}
                      className="min-h-[220px]"
                    />
                  </div>
                ) : null}
              </>
            }
          />
        </main>

      {draft ? (
        <InventorySheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          draft={draft}
          setDraft={setDraft}
          prices={prices}
          setPrices={setPrices}
          quantities={quantities}
          setQuantities={setQuantities}
          busy={busy}
          live={Boolean(slug)}
          slug={slug}
          onPublish={() => {
            setSheetOpen(false);
            void onSubmitPrices();
          }}
          onSaveLive={saveLiveToStore}
          walletReady={railsReady}
        />
      ) : null}
    </div>
  );
}
