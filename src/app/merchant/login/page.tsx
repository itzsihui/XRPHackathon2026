"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMerchantAuth } from "../_components/merchant-auth-provider";

export default function MerchantLoginPage() {
  const router = useRouter();
  const auth = useMerchantAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.signIn(email, password);
      // Fresh merchants land on receive + governance before publish chat
      router.replace("/merchant/setup");
    } catch (err) {
      setError(auth.errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!auth.configured) {
    return (
      <main className="mx-auto max-w-md px-6 pt-24">
        <p className="text-sm text-muted-foreground">
          Firebase is not configured. Add NEXT_PUBLIC_FIREBASE_* keys to{" "}
          <code className="font-mono">.env</code>.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-6 pt-24 pb-12">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Sell · Merchant account
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Sign in
        </h1>
        <p className="mt-2 text-sm text-foreground/70">
          Separate from Shop — bind crypto + Mastercard receiving accounts, then
          publish products linked to you.
        </p>
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="h-10"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="h-10"
          />
        </div>
        <Button type="submit" disabled={busy} className="h-10 w-full px-4">
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="text-sm text-foreground/60">
        No merchant account?{" "}
        <Link
          href="/merchant/signup"
          className="text-foreground underline-offset-2 hover:underline"
        >
          Create one
        </Link>
      </p>
      <p className="text-xs text-foreground/45">
        Not selling?{" "}
        <Link
          href="/buyer/login"
          className="text-foreground/70 underline-offset-2 hover:underline"
        >
          Shop on Borneo
        </Link>
      </p>
    </main>
  );
}
