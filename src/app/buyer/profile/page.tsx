"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TransactionHistory } from "../_components/transaction-history";
import { useBuyerAuth } from "../_components/buyer-auth-provider";
import {
  clearBuyerAccount,
  formatPolicySummary,
  readBuyerAccount,
  updateBuyerAccount,
  type BuyerAccount,
  type BuyerAddress,
} from "@/lib/buyer-account";
import { cn } from "@/lib/utils";

const TOP_SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;
export default function BuyerProfilePage() {
  const router = useRouter();
  const auth = useBuyerAuth();
  const [account, setAccount] = useState<BuyerAccount | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [addrLabel, setAddrLabel] = useState("Home");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [postal, setPostal] = useState("");
  const [addrError, setAddrError] = useState<string | null>(null);
  const [topsSize, setTopsSize] = useState("");
  const [bottomsSize, setBottomsSize] = useState("");
  const [shoesSize, setShoesSize] = useState("");
  const [sizingSaved, setSizingSaved] = useState(false);

  const reload = useCallback(() => {
    const next = readBuyerAccount();
    setAccount(next);
    setTopsSize(next?.sizing?.tops || "");
    setBottomsSize(next?.sizing?.bottoms || "");
    setShoesSize(next?.sizing?.shoes || "");
  }, []);

  useEffect(() => {
    reload();
  }, [reload, auth.account]);

  async function startFresh() {
    if (auth.configured && auth.user) {
      await auth.signOut();
      router.replace("/buyer/login");
      return;
    }
    clearBuyerAccount();
    setConfirmReset(false);
    router.replace("/buyer/onboard");
  }

  async function onSignOut() {
    if (auth.configured) {
      await auth.signOut();
      router.replace("/buyer/login");
    }
  }

  function addAddress(e: FormEvent) {
    e.preventDefault();
    if (!line1.trim() || !city.trim() || !country.trim()) {
      setAddrError("Line 1, city, and country are required");
      return;
    }
    const next: BuyerAddress = {
      id: crypto.randomUUID(),
      label: addrLabel.trim() || "Home",
      line1: line1.trim(),
      line2: line2.trim() || undefined,
      city: city.trim(),
      country: country.trim(),
      postal: postal.trim() || undefined,
    };
    const updated = updateBuyerAccount({
      addresses: [...(account?.addresses ?? []), next],
    });
    setAccount(updated);
    setLine1("");
    setLine2("");
    setCity("");
    setCountry("");
    setPostal("");
    setAddrError(null);
  }

  function removeAddress(id: string) {
    const updated = updateBuyerAccount({
      addresses: (account?.addresses ?? []).filter((a) => a.id !== id),
    });
    setAccount(updated);
  }

  function saveSizing(e: FormEvent) {
    e.preventDefault();
    const updated = updateBuyerAccount({
      sizing: {
        tops: topsSize || undefined,
        bottoms: bottomsSize || undefined,
        shoes: shoesSize || undefined,
      },
    });
    setAccount(updated);
    setSizingSaved(true);
    window.setTimeout(() => setSizingSaved(false), 2000);
  }

  if (!account) {
    return (
      <main className="mx-auto max-w-[1400px] px-6 py-8">
        <p className="text-sm text-muted-foreground">No buyer profile yet.</p>
      </main>
    );
  }

  const limits = formatPolicySummary(account.policy);
  const onboarded = new Date(account.onboardedAt).toLocaleString();
  const recent = account.ledger.slice(-5);

  return (
    <main className="mx-auto flex max-w-[1400px] flex-col gap-8 px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Profile</h1>
          <p className="mt-2 max-w-[58ch] text-sm text-foreground/70">
            {auth.configured
              ? "Synced to Firebase when signed in. Mastercard AP4M settles use your funded Channel."
              : "Demo buyer account for this browser. Mastercard AP4M settles use your funded Channel."}
          </p>
        </div>
        {auth.configured && auth.user ? (
          <Button
            type="button"
            variant="outline"
            className="h-9 px-3"
            onClick={() => void onSignOut()}
          >
            Sign out
          </Button>
        ) : null}
      </div>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-background p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Identity
          </p>
          <p className="mt-3 text-xl font-semibold tracking-tight">
            {account.displayName}
          </p>
          {account.email || auth.user?.email ? (
            <p className="mt-1 text-sm text-foreground/60">
              {account.email || auth.user?.email}
            </p>
          ) : null}
          <p className="mt-1 text-sm text-foreground/60">
            Onboarded {onboarded}
          </p>
        </div>

        <div className="rounded-lg border border-border bg-background p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Mastercard AP4M
          </p>
          <p className="mt-3 text-sm text-foreground/70">
            Checkout can settle RLUSD from your funded Mastercard AP4M Channel
            on XRPL EVM Testnet. Classic XRPL RLUSD x402 and XRP→RLUSD remain
            available as other rails.
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-background p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Preferred sizes
        </p>
        <p className="mt-2 max-w-[58ch] text-sm text-foreground/65">
          We&apos;ll prefer listings that match these sizes when you shop. Other
          sizes still appear — this is a soft fit preference, not a hard filter.
        </p>
        <form
          onSubmit={saveSizing}
          className="mt-4 grid gap-3 sm:grid-cols-3"
        >
          <div className="space-y-1.5">
            <label className="text-xs font-medium" htmlFor="size-tops">
              Tops
            </label>
            <select
              id="size-tops"
              className="flex h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none"
              value={topsSize}
              onChange={(e) => setTopsSize(e.target.value)}
            >
              <option value="">Any</option>
              {TOP_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium" htmlFor="size-bottoms">
              Bottoms
            </label>
            <Input
              id="size-bottoms"
              value={bottomsSize}
              onChange={(e) => setBottomsSize(e.target.value)}
              placeholder="e.g. 30x32 or 30"
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium" htmlFor="size-shoes">
              Shoes
            </label>
            <Input
              id="size-shoes"
              value={shoesSize}
              onChange={(e) => setShoesSize(e.target.value)}
              placeholder="e.g. 42"
              className="h-9"
            />
          </div>
          <div className="flex items-center gap-3 sm:col-span-3">
            <Button type="submit" className="h-9 px-3">
              Save sizes
            </Button>
            {sizingSaved ? (
              <span className="text-xs text-foreground/55">Saved</span>
            ) : null}
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-border bg-background p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Addresses
        </p>
        <ul className="mt-3 space-y-2">
          {(account.addresses ?? []).length === 0 ? (
            <li className="text-sm text-muted-foreground">No addresses yet.</li>
          ) : (
            (account.addresses ?? []).map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-border/80 px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium">{a.label}</p>
                  <p className="text-foreground/70">
                    {a.line1}
                    {a.line2 ? `, ${a.line2}` : ""}
                  </p>
                  <p className="text-foreground/55">
                    {a.city}
                    {a.postal ? ` ${a.postal}` : ""}, {a.country}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-8 px-2 text-xs"
                  onClick={() => removeAddress(a.id)}
                >
                  Remove
                </Button>
              </li>
            ))
          )}
        </ul>

        <form
          onSubmit={addAddress}
          className="mt-5 grid gap-3 border-t border-border pt-4 sm:grid-cols-2"
        >
          {addrError ? (
            <p className="sm:col-span-2 text-sm text-destructive">{addrError}</p>
          ) : null}
          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-xs font-medium" htmlFor="addr-label">
              Label
            </label>
            <Input
              id="addr-label"
              value={addrLabel}
              onChange={(e) => setAddrLabel(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-xs font-medium" htmlFor="addr-line1">
              Address line 1
            </label>
            <Input
              id="addr-line1"
              value={line1}
              onChange={(e) => setLine1(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-xs font-medium" htmlFor="addr-line2">
              Address line 2
            </label>
            <Input
              id="addr-line2"
              value={line2}
              onChange={(e) => setLine2(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium" htmlFor="addr-city">
              City
            </label>
            <Input
              id="addr-city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium" htmlFor="addr-postal">
              Postal
            </label>
            <Input
              id="addr-postal"
              value={postal}
              onChange={(e) => setPostal(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-xs font-medium" htmlFor="addr-country">
              Country
            </label>
            <Input
              id="addr-country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" className="h-9 px-3">
              Add address
            </Button>
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-border bg-background p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Active limits
            </p>
            <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-foreground/80">
              {limits.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <Link
            href="/buyer/governance"
            className={cn(buttonVariants({ variant: "outline" }), "h-9 px-3")}
          >
            Edit governance
          </Link>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-background p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Recent activity
          </p>
          <Link
            href="/buyer/activity"
            className={cn(buttonVariants({ variant: "outline" }), "h-9 px-3")}
          >
            View all
          </Link>
        </div>
        <div className="mt-4">
          <TransactionHistory
            events={recent}
            emptyHint="No purchases yet. Completed checkouts show up under Activity."
          />
        </div>
      </section>

      <section className="rounded-lg border border-destructive/25 bg-destructive/5 p-5">
        <p className="font-medium text-foreground">
          {auth.configured ? "Sign out / reset local cache" : "Start fresh"}
        </p>
        <p className="mt-1 max-w-[58ch] text-sm text-foreground/70">
          {auth.configured
            ? "Signs you out and clears the local shop session. Your Firestore profile stays until you delete it in Firebase."
            : "Clears this buyer profile, spend ledger, and shop chat session."}
        </p>
        {!confirmReset ? (
          <Button
            type="button"
            variant="destructive"
            className="mt-4 h-9 px-3"
            onClick={() => setConfirmReset(true)}
          >
            {auth.configured ? "Sign out" : "Start fresh"}
          </Button>
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <p className="text-sm text-destructive">Confirm?</p>
            <Button
              type="button"
              variant="destructive"
              className="h-9 px-3"
              onClick={() => void startFresh()}
            >
              Confirm
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-9 px-3"
              onClick={() => setConfirmReset(false)}
            >
              Cancel
            </Button>
          </div>
        )}
      </section>
    </main>
  );
}
