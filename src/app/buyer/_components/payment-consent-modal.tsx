"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import type { MarketProductPick, PaymentRail } from "../_lib/buyer-flow";

export function PaymentConsentModal({
  open,
  product,
  rail,
  onCancel,
  onAuthorize,
  busy,
}: {
  open: boolean;
  product: MarketProductPick | null;
  rail: PaymentRail | null;
  onCancel: () => void;
  onAuthorize: () => void;
  busy?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open || !product || !rail) return null;

  const isMastercard = rail === "mastercard";
  const isXrp = rail === "xrp";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-title"
    >
      <button
        type="button"
        aria-label="Close consent dialog"
        className="absolute inset-0 bg-black/50"
        disabled={busy}
        onClick={() => {
          if (!busy) onCancel();
        }}
      />
      <div className="relative z-[1] w-full max-w-md border border-border bg-background shadow-xl">
        <div className="border-b border-border px-5 py-4">
          <h2
            id="consent-title"
            className="font-[family-name:var(--font-syne)] text-base font-semibold tracking-tight"
          >
            Authorize purchase
          </h2>
          <p className="mt-1 text-xs text-foreground/55">
            Review the transaction preview. The agent will not pay until you
            confirm.
          </p>
        </div>

        <div className="space-y-4 px-5 py-4 text-sm">
          <dl className="space-y-2">
            <div className="flex justify-between gap-4">
              <dt className="text-foreground/55">Item</dt>
              <dd className="text-right font-medium">{product.title}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-foreground/55">Merchant</dt>
              <dd className="font-mono text-right text-xs">
                /s/{product.storeSlug}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-foreground/55">Quantity</dt>
              <dd>1</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-foreground/55">Amount</dt>
              <dd className="font-medium">{product.price} RLUSD</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-foreground/55">Rail</dt>
              <dd className="text-right">
                {isMastercard
                  ? "Mastercard · AP4M Channel"
                  : isXrp
                    ? "XRP → RLUSD (AMM)"
                    : "RLUSD · XRPL Testnet x402"}
              </dd>
            </div>
          </dl>

          <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5 text-[13px] leading-relaxed text-foreground/75">
            {isMastercard ? (
              <>
                Settle <strong>{product.price}</strong> RLUSD from your funded
                Mastercard AP4M Channel (XRPL EVM Testnet voucher redeem) ·
                merchant{" "}
                <span className="font-mono">{product.storeSlug}</span>. Agent
                pays only after you confirm.
              </>
            ) : isXrp ? (
              <>
                Cross-currency Payment: you spend XRP; merchant receives{" "}
                <strong>{product.price}</strong> RLUSD via XRPL AMM/DEX. Atomic
                settle — no redirect out of chat.
              </>
            ) : (
              <>
                On-chain settlement via x402 on XRPL Testnet: expect HTTP 402,
                transfer <strong>{product.price}</strong> RLUSD to the merchant,
                then complete with PAYMENT-SIGNATURE. No redirect out of chat.
              </>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button type="button" disabled={busy} onClick={onAuthorize}>
            {busy ? "Authorizing…" : "Authorize purchase"}
          </Button>
        </div>
      </div>
    </div>
  );
}
