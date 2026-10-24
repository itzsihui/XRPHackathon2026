"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PaymentRail } from "../_lib/buyer-flow";

const RAILS: Array<{
  id: PaymentRail;
  title: string;
  subtitle: string;
}> = [
  {
    id: "stablecoin",
    title: "RLUSD",
    subtitle: "Exact stablecoin · x402",
  },
  {
    id: "xrp",
    title: "XRP",
    subtitle: "Converted to RLUSD via AMM",
  },
  {
    id: "visa",
    title: "Visa",
    subtitle: "Scoped card · agent-authorized",
  },
];

export function PaymentRailPicker({
  value,
  onChange,
  onContinue,
  disabled,
  canContinue,
}: {
  value: PaymentRail | null;
  onChange: (rail: PaymentRail) => void;
  onContinue: () => void;
  disabled?: boolean;
  canContinue?: boolean;
}) {
  return (
    <section className="border border-border">
      <div className="border-b border-border px-4 py-3">
        <h2 className="font-[family-name:var(--font-syne)] text-sm font-semibold tracking-tight">
          How do you want to pay?
        </h2>
        <p className="mt-1 text-xs text-foreground/55">
          Merchant always receives RLUSD. Pick your pay-in — confirm before the
          agent settles.
        </p>
      </div>

      <div className="grid gap-2 p-4 sm:grid-cols-3">
        {RAILS.map((rail) => {
          const selected = value === rail.id;
          return (
            <button
              key={rail.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(rail.id)}
              className={cn(
                "rounded-lg border p-3 text-left transition-colors",
                selected
                  ? "border-foreground bg-muted/50 ring-1 ring-foreground"
                  : "border-border hover:border-foreground/40",
              )}
            >
              <p className="text-sm font-medium">{rail.title}</p>
              <p className="mt-1 text-xs text-foreground/55">{rail.subtitle}</p>
            </button>
          );
        })}
      </div>

      <div className="border-t border-border px-4 py-3">
        <Button
          type="button"
          disabled={disabled || !canContinue || !value}
          onClick={onContinue}
        >
          Continue to checkout
        </Button>
      </div>
    </section>
  );
}
