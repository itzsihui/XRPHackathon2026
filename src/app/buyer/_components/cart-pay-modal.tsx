"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MarketProductPick, PaymentRail } from "../_lib/buyer-flow";

type FxQuoteState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; xrpDisplay: string; deliverRlusd: string }
  | { status: "unavailable"; reason: string };

export function CartPayModal({
  open,
  lines,
  rail,
  onRailChange,
  onClose,
  onPay,
  busy,
  acceptRlusd = true,
  acceptXrp = true,
  acceptMastercard = true,
}: {
  open: boolean;
  lines: Array<MarketProductPick & { quantity: number }>;
  rail: PaymentRail | null;
  onRailChange: (rail: PaymentRail) => void;
  onClose: () => void;
  onPay: () => void;
  busy?: boolean;
  acceptRlusd?: boolean;
  acceptXrp?: boolean;
  acceptMastercard?: boolean;
}) {
  const [fx, setFx] = useState<FxQuoteState>({ status: "idle" });

  const total = useMemo(
    () =>
      lines.reduce(
        (sum, line) => sum + Number(line.price) * line.quantity,
        0,
      ),
    [lines],
  );
  const stores = useMemo(
    () => [...new Set(lines.map((l) => l.storeSlug))],
    [lines],
  );
  const totalLabel = total.toFixed(2);

  useEffect(() => {
    if (!open || rail !== "xrp" || !acceptXrp) {
      if (rail !== "xrp") setFx({ status: "idle" });
      return;
    }
    if (!(total > 0)) {
      setFx({
        status: "unavailable",
        reason: "Cart total missing",
      });
      return;
    }

    let cancelled = false;
    setFx({ status: "loading" });
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          // Server resolves payTo from MERCHANT_ADDRESS (ignores stale catalog).
          const res = await fetch(
            `/api/fx-quote?amount=${encodeURIComponent(totalLabel)}`,
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
            deliverRlusd: data.deliverRlusd || totalLabel,
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
  }, [open, rail, acceptXrp, total, totalLabel]);

  if (!open || lines.length === 0) return null;

  const xrpReady = rail === "xrp" && fx.status === "ok";
  const canPay =
    !!rail &&
    !(rail === "xrp" && !xrpReady) &&
    !(rail === "stablecoin" && !acceptRlusd) &&
    !(rail === "mastercard" && !acceptMastercard);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cart-pay-title"
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
        <div className="border-b border-border px-5 py-4">
          <h2
            id="cart-pay-title"
            className="font-[family-name:var(--font-syne)] text-lg font-semibold tracking-tight"
          >
            Pay cart in chat
          </h2>
          <p className="mt-1 text-xs text-foreground/50">
            {lines.length} SKU{lines.length === 1 ? "" : "s"} ·{" "}
            <strong className="text-foreground/70">{totalLabel} RLUSD</strong>{" "}
            deliver total
          </p>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          <ul className="space-y-2">
            {lines.map((line) => (
              <li
                key={line.id}
                className="flex items-center gap-3 rounded-xl border border-border p-2"
              >
                <div className="relative size-12 shrink-0 overflow-hidden rounded-md bg-muted">
                  <Image
                    src={line.imageUrl}
                    alt={line.title}
                    fill
                    className="object-cover"
                    sizes="48px"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {line.quarantined
                      ? line.id.split(":")[1] || line.id
                      : line.title}
                  </p>
                  <p className="font-mono text-[10px] text-foreground/45">
                    /s/{line.storeSlug} · ×{line.quantity}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-medium tabular-nums">
                  {(Number(line.price) * line.quantity).toFixed(2)} RLUSD
                </p>
              </li>
            ))}
          </ul>

          <div className="mt-4 space-y-3">
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
              fx.status === "ok" ? (
                <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-[13px] leading-relaxed text-foreground/75">
                  <p>
                    You pay ≈ <strong>{fx.xrpDisplay} XRP</strong>
                  </p>
                  <p className="mt-0.5">
                    Merchants receive{" "}
                    <strong>{totalLabel} RLUSD</strong> total
                  </p>
                </div>
              ) : fx.status === "unavailable" ? (
                <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] text-foreground/70">
                  XRP unavailable — {fx.reason}. Pick RLUSD or Mastercard.
                </p>
              ) : (
                <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-[13px] text-foreground/55">
                  Quoting XRP→RLUSD via AMM…
                </p>
              )
            ) : rail === "stablecoin" ? (
              <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-[13px] text-foreground/70">
                You pay <strong>{totalLabel} RLUSD</strong> · merchants receive
                the same
              </p>
            ) : rail === "mastercard" ? (
              <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-[13px] text-foreground/70">
                Mastercard AP4M Channel · {stores.length} store
                {stores.length === 1 ? "" : "s"}
              </p>
            ) : null}
          </div>

          <div className="mt-4 rounded-md border border-border bg-muted/40 px-3 py-3 text-[13px] leading-relaxed text-foreground/75">
            <p className="text-[11px] font-medium tracking-wide text-foreground/50 uppercase">
              Locked quotes
            </p>
            <p className="mt-2 text-[12px] text-foreground/60">
              Deliver <strong>{totalLabel} RLUSD</strong>
              {rail === "xrp" && fx.status === "ok"
                ? ` · send ≈ ${fx.xrpDisplay} XRP`
                : null}
              . Hostile catalog titles cannot change payee, amount, or skip
              authorize.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onClose}
          >
            Back
          </Button>
          <Button type="button" disabled={busy || !canPay} onClick={onPay}>
            {busy
              ? rail === "mastercard"
                ? "Paying Mastercard…"
                : rail === "xrp"
                  ? "Paying XRP…"
                  : "Paying RLUSD…"
              : `Authorize ${lines.length} settle${lines.length === 1 ? "" : "s"}`}
          </Button>
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
