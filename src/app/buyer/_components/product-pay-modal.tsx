"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MarketProductPick, PaymentRail } from "../_lib/buyer-flow";

type FxQuoteState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; xrpDisplay: string; deliverRlusd: string }
  | { status: "unavailable"; reason: string };

export function ProductPayModal({
  open,
  product,
  rail,
  onRailChange,
  onClose,
  onPay,
  busy,
  receiptNote,
  firstMastercardIssue,
  acceptRlusd = true,
  acceptXrp = true,
  acceptMastercard = true,
}: {
  open: boolean;
  product: MarketProductPick | null;
  rail: PaymentRail | null;
  onRailChange: (rail: PaymentRail) => void;
  onClose: () => void;
  onPay: () => void;
  busy?: boolean;
  receiptNote?: string | null;
  /** Unused; kept for prop compatibility. */
  firstMastercardIssue?: boolean;
  acceptRlusd?: boolean;
  acceptXrp?: boolean;
  acceptMastercard?: boolean;
}) {
  const [step, setStep] = useState<"detail" | "confirm">("detail");
  const [fx, setFx] = useState<FxQuoteState>({ status: "idle" });

  useEffect(() => {
    if (!open) {
      setStep("detail");
      setFx({ status: "idle" });
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  useEffect(() => {
    if (!open || !product || rail !== "xrp" || !acceptXrp) {
      if (rail !== "xrp") setFx({ status: "idle" });
      return;
    }

    const amount = product.price;
    // Server resolves payTo from MERCHANT_ADDRESS (ignores stale catalog rHb9…).
    let cancelled = false;
    setFx({ status: "loading" });
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(
            `/api/fx-quote?amount=${encodeURIComponent(amount)}`,
          );
          const data = (await res.json()) as {
            ok?: boolean;
            xrpDisplay?: string;
            deliverRlusd?: string;
            reason?: string;
          };
          if (cancelled) return;
          if (!data.ok || !data.xrpDisplay) {
            setFx({
              status: "unavailable",
              reason: data.reason || "XRP path unavailable",
            });
            return;
          }
          setFx({
            status: "ok",
            xrpDisplay: data.xrpDisplay,
            deliverRlusd: data.deliverRlusd || amount,
          });
        } catch {
          if (!cancelled) {
            setFx({
              status: "unavailable",
              reason: "Could not quote XRP",
            });
          }
        }
      })();
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, product, rail, acceptXrp]);

  if (!open || !product) return null;

  const xrpReady = rail === "xrp" && fx.status === "ok";
  const xrpBlocked =
    rail === "xrp" &&
    (fx.status === "unavailable" || fx.status === "loading" || fx.status === "idle");
  const canContinue =
    !!rail &&
    !(rail === "xrp" && !xrpReady) &&
    !(rail === "stablecoin" && !acceptRlusd) &&
    !(rail === "mastercard" && !acceptMastercard);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="product-detail-title"
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/50"
        disabled={busy}
        onClick={() => {
          if (!busy) onClose();
        }}
      />
      <div className="relative z-[1] flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden border border-border bg-background shadow-xl">
        <div className="relative aspect-[4/3] bg-muted">
          <Image
            src={product.imageUrl}
            alt={product.title}
            fill
            className="object-cover"
            sizes="512px"
          />
        </div>

        <div className="overflow-y-auto px-5 py-4">
          <h2
            id="product-detail-title"
            className="font-[family-name:var(--font-syne)] text-lg font-semibold tracking-tight"
          >
            {product.quarantined
              ? product.id.includes(":")
                ? product.id.slice(product.id.indexOf(":") + 1)
                : product.id
              : product.title}
          </h2>
          {product.quarantined ? (
            <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] leading-relaxed text-foreground/80">
              <p className="font-medium text-destructive">
                Catalog injection attempt
              </p>
              <p className="mt-1 text-foreground/65">
                This listing’s title/description tried to act like instructions
                (e.g. retarget pay or skip authorize). That text is untrusted
                data — it cannot change the locked settle fields below.
              </p>
              {product.injectionFlags?.length ? (
                <p className="mt-1.5 font-mono text-[11px] text-foreground/50">
                  Flags: {product.injectionFlags.join(", ")}
                </p>
              ) : null}
            </div>
          ) : null}
          <p className="mt-1 font-mono text-xs text-foreground/50">
            /s/{product.storeSlug} · {product.storeName}
            {product.merchantDisplayName
              ? ` · sold by ${product.merchantDisplayName}`
              : ""}
          </p>
          {product.quarantined ? (
            <p className="mt-2 break-words font-mono text-[11px] leading-relaxed text-foreground/40">
              Raw title (data only): {product.title}
            </p>
          ) : null}
          <p className="mt-3 text-base font-medium">
            {product.price}{" "}
            <span className="text-foreground/50">RLUSD</span>
          </p>
          {product.description ? (
            <p className="mt-2 text-sm leading-relaxed text-foreground/70">
              {product.description}
            </p>
          ) : null}

          {step === "detail" ? (
            <div className="mt-5 space-y-3">
              <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">
                Pay with
              </p>
              <div className="grid grid-cols-3 gap-2">
                {acceptRlusd ? (
                  <RailChip
                    selected={rail === "stablecoin"}
                    disabled={busy}
                    title="RLUSD"
                    subtitle="x402"
                    onClick={() => onRailChange("stablecoin")}
                  />
                ) : null}
                {acceptXrp ? (
                  <RailChip
                    selected={rail === "xrp"}
                    disabled={busy}
                    title="XRP"
                    subtitle={
                      fx.status === "ok"
                        ? `≈${fx.xrpDisplay}`
                        : fx.status === "unavailable"
                          ? "n/a"
                          : rail === "xrp"
                            ? "…"
                            : "AMM"
                    }
                    onClick={() => onRailChange("xrp")}
                  />
                ) : null}
                {acceptMastercard ? (
                  <RailChip
                    selected={rail === "mastercard"}
                    disabled={busy}
                    title="Mastercard"
                    subtitle="AP4M"
                    onClick={() => onRailChange("mastercard")}
                  />
                ) : null}
              </div>

              {rail === "xrp" ? (
                <FxStrip
                  fx={fx}
                  deliverFallback={product.price}
                />
              ) : rail === "stablecoin" ? (
                <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-[13px] text-foreground/70">
                  You pay{" "}
                  <strong>
                    {product.price} RLUSD
                  </strong>
                  {" · "}
                  merchant receives the same
                </p>
              ) : rail === "mastercard" ? (
                <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-[13px] text-foreground/70">
                  Mastercard AP4M Channel voucher · {product.price} RLUSD
                </p>
              ) : null}
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              <div className="rounded-md border border-border bg-muted/40 px-3 py-3 text-[13px] leading-relaxed text-foreground/75">
                <p className="text-[11px] font-medium tracking-wide text-foreground/50 uppercase">
                  Locked quote
                </p>
                <dl className="mt-2 space-y-1.5 font-mono text-[12px]">
                  <div className="flex justify-between gap-3">
                    <dt className="text-foreground/45">Merchant</dt>
                    <dd className="text-right text-foreground">
                      /s/{product.storeSlug}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-foreground/45">SKU</dt>
                    <dd className="text-right text-foreground">
                      {product.id.includes(":")
                        ? product.id.slice(product.id.indexOf(":") + 1)
                        : product.id}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-foreground/45">Deliver</dt>
                    <dd className="text-right text-foreground">
                      {product.price} RLUSD
                    </dd>
                  </div>
                  {rail === "xrp" && fx.status === "ok" ? (
                    <div className="flex justify-between gap-3">
                      <dt className="text-foreground/45">You send</dt>
                      <dd className="text-right text-foreground">
                        ≈ {fx.xrpDisplay} XRP
                      </dd>
                    </div>
                  ) : null}
                  <div className="flex justify-between gap-3">
                    <dt className="text-foreground/45">Rail</dt>
                    <dd className="text-right text-foreground">
                      {rail === "mastercard"
                        ? "Mastercard · AP4M"
                        : rail === "xrp"
                          ? "XRP → RLUSD (AMM)"
                          : "RLUSD · x402"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-foreground/45">Authorize</dt>
                    <dd className="text-right text-foreground">Required</dd>
                  </div>
                </dl>
                <p className="mt-3 font-sans text-[12px] leading-relaxed text-foreground/55">
                  {product.quarantined
                    ? "Injection blocked from control flow: payee, amount, SKU, and authorize stay locked to this quote — not the hostile title."
                    : "Untrusted catalog copy cannot change these fields."}
                </p>
              </div>
              <div className="rounded-md border border-border bg-muted/20 px-3 py-2.5 text-[13px] leading-relaxed text-foreground/75">
                {rail === "mastercard" ? (
                  <>
                    {firstMastercardIssue ? (
                      <p className="mb-2">
                        Settlement uses your open Mastercard AP4M payment Channel on XRPL EVM Testnet.
                      </p>
                    ) : null}
                    Confirm Mastercard AP4M checkout: redeem{" "}
                    <strong>{product.price}</strong> RLUSD from your open
                    Channel for merchant{" "}
                    <strong>{product.storeSlug}</strong>. The agent will not pay
                    until you authorize.
                  </>
                ) : rail === "xrp" ? (
                  <>
                    Confirm cross-currency Payment: spend ≈{" "}
                    <strong>
                      {fx.status === "ok" ? fx.xrpDisplay : "…"} XRP
                    </strong>
                    , merchant receives{" "}
                    <strong>{product.price} RLUSD</strong> via XRPL AMM/DEX.
                  </>
                ) : (
                  <>
                    Confirm x402 on XRPL Testnet: transfer{" "}
                    <strong>{product.price}</strong> RLUSD to merchant crypto
                    receive{" "}
                    <span className="font-mono text-xs">
                      {product.merchantAddress || "store payTo"}
                    </span>{" "}
                    after HTTP 402, then unlock with PAYMENT-SIGNATURE.
                  </>
                )}
              </div>
            </div>
          )}

          {receiptNote ? (
            <p className="mt-3 text-xs text-foreground/60">{receiptNote}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              if (step === "confirm") setStep("detail");
              else onClose();
            }}
          >
            {step === "confirm" ? "Back" : "Close"}
          </Button>
          {step === "detail" ? (
            <Button
              type="button"
              disabled={busy || !canContinue || xrpBlocked}
              onClick={() => setStep("confirm")}
            >
              Continue to pay
            </Button>
          ) : (
            <Button
              type="button"
              disabled={busy || !canContinue}
              onClick={onPay}
            >
              {busy
                ? "Paying…"
                : product.quarantined
                  ? "Authorize locked settle"
                  : "Authorize purchase"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function RailChip({
  selected,
  disabled,
  title,
  subtitle,
  onClick,
}: {
  selected: boolean;
  disabled?: boolean;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-lg border px-2 py-2.5 text-center transition-colors",
        selected
          ? "border-foreground ring-1 ring-foreground bg-muted/40"
          : "border-border hover:border-foreground/40",
      )}
    >
      <span className="block text-sm font-medium leading-tight">{title}</span>
      <span className="mt-0.5 block truncate text-[11px] text-foreground/55">
        {subtitle}
      </span>
    </button>
  );
}

function FxStrip({
  fx,
  deliverFallback,
}: {
  fx: FxQuoteState;
  deliverFallback: string;
}) {
  if (fx.status === "loading" || fx.status === "idle") {
    return (
      <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-[13px] text-foreground/55">
        Quoting XRP→RLUSD via AMM…
      </p>
    );
  }
  if (fx.status === "unavailable") {
    return (
      <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] text-foreground/70">
        XRP unavailable — {fx.reason}. Pick RLUSD or Mastercard.
      </p>
    );
  }
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-[13px] leading-relaxed text-foreground/75">
      <p>
        You pay ≈ <strong>{fx.xrpDisplay} XRP</strong>
      </p>
      <p className="mt-0.5">
        Merchant receives{" "}
        <strong>
          {fx.deliverRlusd || deliverFallback} RLUSD
        </strong>
      </p>
    </div>
  );
}
