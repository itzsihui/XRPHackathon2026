"use client";

import { useState } from "react";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { ProtocolLog } from "@/components/marketing/protocol-log";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

type Line = { role: string; text: string };

export default function DemoPage() {
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<Line[]>([
    {
      role: "pitch",
      text: "90s script: merchant publish → x402 402→200 → Mastercard rail. Open /onboard and /buyer for interactive panes.",
    },
  ]);
  const [explorerUrl, setExplorerUrl] = useState<string | null>(null);

  async function runFullScript() {
    setBusy(true);
    setLog([{ role: "gateway", text: "One-click script started…" }]);
    setExplorerUrl(null);
    try {
      const res = await fetch("/api/demo-script", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          merchantMessage:
            "Create a store. I'm selling 50 Mastercard Hackathon Shirts for 0.01 RLUSD each.",
          buyerMessage:
            "Agent, go to /s/hackathon-shirts and buy a hackathon shirt.",
          rails: ["x402", "card"],
        }),
      });
      const data = (await res.json()) as {
        log?: Array<{ phase: string; text: string }>;
        snowtrace?: string | null;
        explorerUrl?: string | null;
        error?: string;
        pitch?: { avalanche?: string; xrpl?: string; straitsx?: string; aws?: string };
      };
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setLog(
        (data.log ?? []).map((l) => ({
          role: l.phase,
          text: l.text,
        })),
      );
      const link = data.explorerUrl || data.snowtrace;
      if (link) setExplorerUrl(link);
      if (data.pitch) {
        setLog((prev) => [
          ...prev,
          {
            role: "pitch",
            text: `XRPL: ${data.pitch?.xrpl || data.pitch?.avalanche}`,
          },
          { role: "pitch", text: `Mastercard: ${data.pitch?.straitsx}` },
          { role: "pitch", text: `AWS: ${data.pitch?.aws}` },
        ]);
      }
    } catch (error) {
      setLog((prev) => [
        ...prev,
        {
          role: "error",
          text: error instanceof Error ? error.message : "Script failed",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-[100dvh] bg-background">
      <SiteHeader variant="public" />
      <main className="mx-auto max-w-[1400px] px-6 pt-20 pb-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              Handshake
            </h1>
            <p className="mt-2 max-w-[52ch] text-foreground/70">
              Pitch script for judges. Build stores via{" "}
              <Link href="/merchant/login" className="text-primary underline underline-offset-2">
                Sell
              </Link>
              ; pay via{" "}
              <Link href="/buyer/login" className="text-primary underline underline-offset-2">
                Shop
              </Link>
              .
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="lg"
              disabled={busy}
              onClick={runFullScript}
            >
              {busy ? "Running…" : "Run full 90s script"}
            </Button>
            <Link
              href="/dashboard"
              className="inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
            >
              Dashboard
            </Link>
          </div>
        </div>

        {explorerUrl ? (
          <p className="mt-4 text-sm">
            XRPL explorer:{" "}
            <a
              className="text-primary underline-offset-4 hover:underline"
              href={explorerUrl}
              target="_blank"
              rel="noreferrer"
            >
              {explorerUrl}
            </a>
          </p>
        ) : null}

        <section className="mt-8 border border-border bg-background">
          <h2 className="border-b border-border px-4 py-3 font-[family-name:var(--font-syne)] text-sm font-semibold tracking-tight">
            Script log
          </h2>
          <ScrollArea className="h-80 px-4 py-3">
            <div className="flex flex-col gap-2 font-mono text-xs">
              {log.map((line, index) => (
                <p key={index} className="whitespace-pre-wrap text-foreground/80">
                  <span className="text-foreground/50">{line.role}: </span>
                  {line.text}
                </p>
              ))}
            </div>
          </ScrollArea>
        </section>

        <div className="mt-4">
          <ProtocolLog className="max-w-none" />
        </div>
      </main>
    </div>
  );
}
