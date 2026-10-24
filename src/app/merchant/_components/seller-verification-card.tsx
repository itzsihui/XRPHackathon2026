"use client";

import { useCallback, useEffect, useState } from "react";
import { Wallet, type Transaction } from "xrpl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authenticateWithXrplSeed, shortAddress } from "@/lib/wallet/xrpl";
import type { SellerVerification } from "@/lib/xrpl/seller-verification-types";

type Receipt = { type: string; hash: string; result: string; explorerUrl: string };

type Step = { label: string; state: "running" | "done" | "error"; detail?: string };

const STATUS_COPY: Record<SellerVerification["status"], { label: string; tone: string }> = {
  verified: {
    label: "Verified on XRPL",
    tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  pending_accept: {
    label: "Issued — awaiting your acceptance",
    tone: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  expired: {
    label: "Credential expired",
    tone: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  unverified: {
    label: "Not verified",
    tone: "border-border bg-muted/40 text-foreground/70",
  },
};

async function post<T>(body: unknown): Promise<T> {
  const res = await fetch("/api/seller-verification", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & {
    error?: string;
    flagged?: { store: string; sku: string; flags: string[] }[];
  };
  if (!res.ok) {
    const extra = data.flagged?.length
      ? ` (${data.flagged.map((f) => `${f.store}:${f.sku}`).join(", ")})`
      : "";
    throw new Error((data.error || `HTTP ${res.status}`) + extra);
  }
  return data;
}

/**
 * Borneo verified seller: XLS-70 credential (issued by Borneo, accepted by you)
 * + XLS-40 DID on your payout address. Seed is only used in this browser to
 * sign CredentialAccept / DIDSet; Borneo relays the signed blobs.
 */
async function fetchVerification(addr: string, fresh = false) {
  try {
    const res = await fetch(
      `/api/seller-verification?address=${encodeURIComponent(addr)}${fresh ? "&fresh=1" : ""}`,
      { cache: "no-store" },
    );
    const data = (await res.json()) as { verification?: SellerVerification };
    return data.verification ?? null;
  } catch {
    return null; // status is best-effort
  }
}

export function SellerVerificationCard({ address }: { address: string | null }) {
  // The seed the merchant signs with decides the subject; default to bound wallet.
  const [proofAddress, setProofAddress] = useState<string | null>(null);
  const target = proofAddress ?? address;
  const [verification, setVerification] = useState<SellerVerification | null>(null);
  const [seed, setSeed] = useState("");
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (addr: string | null, fresh = false) => {
    if (!addr) return;
    const v = await fetchVerification(addr, fresh);
    if (v) setVerification(v);
  }, []);

  useEffect(() => {
    if (!target) return;
    let live = true;
    void fetchVerification(target).then((v) => {
      if (live && v) setVerification(v);
    });
    return () => {
      live = false;
    };
  }, [target]);

  function step(label: string, state: Step["state"], detail?: string) {
    setSteps((prev) => {
      const i = prev.findIndex((s) => s.label === label);
      const next = { label, state, detail };
      if (i === -1) return [...prev, next];
      const copy = [...prev];
      copy[i] = next;
      return copy;
    });
  }

  async function run() {
    setBusy(true);
    setError(null);
    setSteps([]);
    setReceipts([]);
    let current = "Prove wallet control";
    try {
      step(current, "running");
      const proof = authenticateWithXrplSeed(seed);
      setProofAddress(proof.address);
      step(current, "done", shortAddress(proof.address));

      current = "Borneo issues credential (CredentialCreate)";
      step(current, "running");
      const issued = await post<{ receipts: Receipt[]; verification: SellerVerification }>({
        action: "issue",
        proof,
      });
      setReceipts((r) => [...r, ...issued.receipts]);
      step(current, "done", issued.receipts.length ? "submitted" : `already ${issued.verification.status}`);

      current = "You accept + publish DID (CredentialAccept, DIDSet)";
      step(current, "running");
      const prepared = await post<{ txs: Transaction[]; verification: SellerVerification }>({
        action: "prepare",
        address: proof.address,
      });
      if (prepared.txs.length === 0) {
        step(current, "done", "nothing to sign");
        setVerification(prepared.verification);
      } else {
        const wallet = Wallet.fromSeed(seed.trim().replace(/^["']|["']$/g, ""));
        const txBlobs = prepared.txs.map((tx) => wallet.sign(tx).tx_blob);
        const submitted = await post<{ receipts: Receipt[]; verification: SellerVerification }>({
          action: "submit",
          address: proof.address,
          txBlobs,
        });
        setReceipts((r) => [...r, ...submitted.receipts]);
        setVerification(submitted.verification);
        step(current, "done", submitted.receipts.map((r) => r.type).join(" + "));
      }
      setSeed("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Verification failed";
      step(current, "error", msg);
      setError(msg);
      void refresh(target, true);
    } finally {
      setBusy(false);
    }
  }

  const status = verification?.status ?? "unverified";
  const copy = STATUS_COPY[status];

  return (
    <section className="mt-10 space-y-3 border-t border-border pt-8">
      <h2 className="text-sm font-medium">4. Verified seller on XRPL</h2>
      <p className="text-xs text-foreground/55">
        Borneo issues a <code className="text-[11px]">BorneoVerifiedSeller</code>{" "}
        credential (XLS-70) to your payout address. You accept it and publish a DID
        (XLS-40) pointing at your storefronts. Buyer agents check both on the ledger
        themselves and rank verified sellers higher. Publish a store first; your
        wallet needs a little testnet XRP for the reserve.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-3 py-1 text-xs font-medium ${copy.tone}`}>
          {copy.label}
        </span>
        {target ? (
          <span className="font-mono text-[11px] text-muted-foreground">
            {shortAddress(target, 6)}
          </span>
        ) : null}
        {verification?.didLinked ? (
          <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-foreground/60">
            {verification.did?.id}
          </span>
        ) : null}
        {target ? (
          <button
            type="button"
            onClick={() => void refresh(target, true)}
            className="text-[11px] text-foreground/50 underline-offset-2 hover:underline"
          >
            Re-check ledger
          </button>
        ) : null}
      </div>
      {verification?.reason && status !== "verified" ? (
        <p className="font-mono text-[10px] text-muted-foreground">{verification.reason}</p>
      ) : null}
      {verification?.expiresAt ? (
        <p className="text-[11px] text-foreground/50">
          Expires {new Date(verification.expiresAt).toLocaleDateString()}
        </p>
      ) : null}

      {status !== "verified" || !verification?.didLinked ? (
        <>
          <Input
            type="password"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            placeholder="Payout wallet seed (s…) — signs in this browser only"
            className="h-10 font-mono text-sm"
            autoComplete="off"
          />
          <Button
            type="button"
            variant="outline"
            disabled={busy || !seed.trim()}
            onClick={() => void run()}
            className="h-10"
          >
            {busy ? "Verifying on XRPL…" : "Get verified on XRPL"}
          </Button>
        </>
      ) : null}

      {steps.length ? (
        <ol className="space-y-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
          {steps.map((s) => (
            <li key={s.label} className="flex gap-2">
              <span className="w-4">
                {s.state === "done" ? "✓" : s.state === "error" ? "✕" : "…"}
              </span>
              <span className="flex-1">
                {s.label}
                {s.detail ? (
                  <span className="block break-all font-mono text-[10px] text-muted-foreground">
                    {s.detail}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {receipts.length ? (
        <ul className="space-y-1 text-[11px]">
          {receipts.map((r) => (
            <li key={r.hash}>
              <a
                href={r.explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono underline underline-offset-2"
              >
                {r.type} · {r.result} · {r.hash.slice(0, 10)}…
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </section>
  );
}
