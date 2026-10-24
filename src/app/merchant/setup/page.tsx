"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMerchantAuth } from "@/app/merchant/_components/merchant-auth-provider";
import { SellerVerificationCard } from "@/app/merchant/_components/seller-verification-card";
import {
  DEFAULT_MERCHANT_GOVERNANCE,
  merchantSetupComplete,
  type MerchantGovernance,
} from "@/lib/firebase/merchant-auth";
import {
  authenticateWithXrplSeed,
  generateMerchantWallet,
  shortAddress,
} from "@/lib/wallet/xrpl";

export default function MerchantSetupPage() {
  const router = useRouter();
  const merchant = useMerchantAuth();

  const [visaLabel, setVisaLabel] = useState("");
  const [visaReceiveId, setVisaReceiveId] = useState("");
  const [visaNote, setVisaNote] = useState("");
  const [acceptUsdc, setAcceptUsdc] = useState(true);
  const [acceptXrp, setAcceptXrp] = useState(true);
  const [acceptVisa, setAcceptVisa] = useState(true);
  const [minPrice, setMinPrice] = useState("");
  const [maxUnits, setMaxUnits] = useState("");
  const [listOnMarket, setListOnMarket] = useState(true);
  const [requireConfirm, setRequireConfirm] = useState(true);
  const [busy, setBusy] = useState(false);
  const [walletBusy, setWalletBusy] = useState(false);
  const [boundWallet, setBoundWallet] = useState<string | null>(null);
  const [seedInput, setSeedInput] = useState("");
  const [generatedSeed, setGeneratedSeed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!merchant.ready) return;
    if (merchant.configured && !merchant.user) {
      router.replace("/merchant/login");
    }
  }, [merchant.ready, merchant.configured, merchant.user, router]);

  useEffect(() => {
    if (merchant.profile?.walletAddress) {
      setBoundWallet(merchant.profile.walletAddress);
    }
  }, [merchant.profile?.walletAddress]);

  useEffect(() => {
    const p = merchant.profile;
    if (!p) return;
    if (p.visaReceive) {
      setVisaLabel(p.visaReceive.accountLabel || "");
      setVisaReceiveId(p.visaReceive.receiveId || "");
      setVisaNote(p.visaReceive.settlementNote || "");
    }
    const g = p.governance ?? DEFAULT_MERCHANT_GOVERNANCE;
    setAcceptUsdc(g.acceptUsdc);
    setAcceptXrp(g.acceptXrp !== false);
    setAcceptVisa(g.acceptVisa);
    setMinPrice(g.minUnitPriceUsdc != null ? String(g.minUnitPriceUsdc) : "");
    setMaxUnits(g.maxUnitsPerOrder != null ? String(g.maxUnitsPerOrder) : "");
    setListOnMarket(g.listOnMarket);
    setRequireConfirm(g.requireConfirmBeforePublish);
  }, [merchant.profile]);

  const wallet = merchant.profile?.walletAddress || boundWallet;

  async function onBindWallet() {
    setWalletBusy(true);
    setError(null);
    try {
      const proof = authenticateWithXrplSeed(seedInput);
      await merchant.bindWallet(proof.address);
      setBoundWallet(proof.address);
      setSeedInput("");
      setMessage(`XRPL receive bound: ${shortAddress(proof.address)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "XRPL bind failed");
    } finally {
      setWalletBusy(false);
    }
  }

  function onGenerateWallet() {
    const w = generateMerchantWallet();
    setGeneratedSeed(w.seed);
    setSeedInput(w.seed);
    setMessage(
      `Generated ${shortAddress(w.address)}. Copy the seed, fund Testnet XRP + RLUSD trust line, then Bind.`,
    );
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!visaLabel.trim()) {
      setError("Visa account label is required");
      return;
    }
    if (!acceptUsdc && !acceptXrp && !acceptVisa) {
      setError("Enable at least one payment rail (RLUSD, XRP, or Visa)");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await merchant.bindVisa({
        accountLabel: visaLabel.trim(),
        receiveId: visaReceiveId.trim() || undefined,
        settlementNote: visaNote.trim() || undefined,
      });
      const gov: MerchantGovernance = {
        acceptUsdc,
        acceptXrp,
        acceptVisa,
        minUnitPriceUsdc: minPrice.trim() ? Number(minPrice) : null,
        maxUnitsPerOrder: maxUnits.trim()
          ? Math.floor(Number(maxUnits))
          : null,
        listOnMarket,
        requireConfirmBeforePublish: requireConfirm,
      };
      if (
        gov.minUnitPriceUsdc != null &&
        (!Number.isFinite(gov.minUnitPriceUsdc) || gov.minUnitPriceUsdc <= 0)
      ) {
        setError("Min unit price must be a positive number or blank");
        setBusy(false);
        return;
      }
      if (
        gov.maxUnitsPerOrder != null &&
        (!Number.isFinite(gov.maxUnitsPerOrder) || gov.maxUnitsPerOrder <= 0)
      ) {
        setError("Max units per order must be a positive integer or blank");
        setBusy(false);
        return;
      }
      await merchant.saveGovernance(gov);
      setMessage("Settings saved. Continue to Publish when ready.");
      router.push("/onboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save setup");
    } finally {
      setBusy(false);
    }
  }

  if (!merchant.ready || (merchant.configured && !merchant.user)) {
    return (
      <div className="flex flex-1 items-center justify-center py-24">
        <p className="text-sm text-muted-foreground">Loading settings…</p>
      </div>
    );
  }

  const done = merchantSetupComplete(merchant.profile);

  return (
    <main className="mx-auto w-full max-w-xl flex-1 overflow-y-auto px-6 py-8">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Settings
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        Wallet, fiat &amp; limits
      </h1>
      <p className="mt-2 text-sm text-foreground/65">
        Bind where payments settle and set agent rules. Publish chat stays
        focused on inventory — settle rails live here.
      </p>

      <div className="mt-4 flex flex-wrap gap-3 text-xs">
        <Link
          href="/dashboard"
          className="rounded-full border border-border px-3 py-1.5 text-foreground/70 underline-offset-2 hover:bg-muted hover:underline"
        >
          Revenue &amp; orders (Ops)
        </Link>
        <Link
          href="/onboard"
          className="rounded-full border border-border px-3 py-1.5 text-foreground/70 underline-offset-2 hover:bg-muted hover:underline"
        >
          Publish inventory
        </Link>
      </div>

      {done ? (
        <p className="mt-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-foreground/70">
          Setup complete. Edit anytime, check{" "}
          <Link href="/dashboard" className="underline underline-offset-2">
            Ops
          </Link>{" "}
          for revenue, or{" "}
          <Link href="/onboard" className="underline underline-offset-2">
            go to Publish
          </Link>
          .
        </p>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mt-4 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-foreground/70">
          {message}
        </p>
      ) : null}

      <form onSubmit={(e) => void onSave(e)} className="mt-8 space-y-10">
        <section className="space-y-3">
          <h2 className="text-sm font-medium">1. XRPL receiving address</h2>
          <p className="text-xs text-foreground/55">
            Optional for the demo — skip to use{" "}
            <code className="text-[11px]">MERCHANT_ADDRESS</code> from server
            env. Bind a family seed only if you want payouts to your own XRPL
            Testnet wallet (seed stays in the browser).
          </p>
          {wallet ? (
            <p className="font-mono text-sm">
              {shortAddress(wallet)}
              <span className="mt-1 block break-all text-[10px] text-muted-foreground">
                {wallet}
              </span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Not bound yet</p>
          )}
          <Input
            type="password"
            value={seedInput}
            onChange={(e) => setSeedInput(e.target.value)}
            placeholder="XRPL family seed (s…)"
            className="h-10 font-mono text-sm"
            autoComplete="off"
          />
          {generatedSeed ? (
            <p className="break-all rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-[10px] text-foreground/70">
              Save this seed offline: {generatedSeed}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={walletBusy || !seedInput.trim()}
              onClick={() => void onBindWallet()}
              className="h-10"
            >
              {walletBusy
                ? "Binding…"
                : wallet
                  ? "Re-bind XRPL wallet"
                  : "Bind XRPL wallet"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={walletBusy}
              onClick={onGenerateWallet}
              className="h-10"
            >
              Generate testnet wallet
            </Button>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium">2. Visa fiat receiving account</h2>
          <p className="text-xs text-foreground/55">
            Where the Visa scoped-card rail settles. Demo-safe if live StraitsX
            is unset — saved on your profile and stamped onto each store.
          </p>
          <Input
            value={visaLabel}
            onChange={(e) => setVisaLabel(e.target.value)}
            placeholder="Account label"
            className="h-10"
            required
          />
          <Input
            value={visaReceiveId}
            onChange={(e) => setVisaReceiveId(e.target.value)}
            placeholder="Receive id (optional)"
            className="h-10"
          />
          <Input
            value={visaNote}
            onChange={(e) => setVisaNote(e.target.value)}
            placeholder="SGD settlement note (optional)"
            className="h-10"
          />
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium">3. Agent governance &amp; limits</h2>
          <p className="text-xs text-foreground/55">
            In the age of AI shoppers, you set what autonomous buyers may do at
            your store — rails, floors, and discovery — before inventory goes
            live.
          </p>

          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={acceptUsdc}
              onChange={(e) => setAcceptUsdc(e.target.checked)}
            />
            <span>
              Accept RLUSD (x402)
              <span className="mt-0.5 block text-xs text-foreground/50">
                Buyer agents can settle on XRPL Testnet to your classic address.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={acceptXrp}
              onChange={(e) => setAcceptXrp(e.target.checked)}
            />
            <span>
              Accept XRP (converted to RLUSD)
              <span className="mt-0.5 block text-xs text-foreground/50">
                Tourist-terminal rail: buyers pay XRP; you always receive RLUSD
                via AMM/DEX.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={acceptVisa}
              onChange={(e) => setAcceptVisa(e.target.checked)}
            />
            <span>
              Accept Visa scoped card
              <span className="mt-0.5 block text-xs text-foreground/50">
                Buyer agents may issue a burnable card mandate to your Visa
                receive account.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={listOnMarket}
              onChange={(e) => setListOnMarket(e.target.checked)}
            />
            <span>
              List on Market
              <span className="mt-0.5 block text-xs text-foreground/50">
                Discovery agents and humans can find your SKUs on /market.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={requireConfirm}
              onChange={(e) => setRequireConfirm(e.target.checked)}
            />
            <span>
              Require price confirm before publish
              <span className="mt-0.5 block text-xs text-foreground/50">
                The merchant agent drafts inventory but you approve RLUSD prices
                before go-live.
              </span>
            </span>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="minPrice" className="text-xs font-medium">
                Min unit price (RLUSD)
              </label>
              <Input
                id="minPrice"
                inputMode="decimal"
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
                placeholder="No floor"
                className="h-10"
              />
              <p className="text-[11px] text-foreground/45">
                Agents cannot undercut this floor.
              </p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="maxUnits" className="text-xs font-medium">
                Max units per order
              </label>
              <Input
                id="maxUnits"
                inputMode="numeric"
                value={maxUnits}
                onChange={(e) => setMaxUnits(e.target.value)}
                placeholder="No cap"
                className="h-10"
              />
              <p className="text-[11px] text-foreground/45">
                Stops agent bulk-buy sweeps.
              </p>
            </div>
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-3 pb-8">
          <Button type="submit" disabled={busy} className="h-10 px-5">
            {busy ? "Saving…" : "Save & continue to Publish"}
          </Button>
          {done ? (
            <Link
              href="/onboard"
              className="text-sm text-foreground/60 underline-offset-2 hover:underline"
            >
              Skip to Publish
            </Link>
          ) : null}
        </div>
      </form>

      <SellerVerificationCard address={wallet} />
    </main>
  );
}
