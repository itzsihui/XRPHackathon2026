"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  readDemoSession,
  singularProductHint,
  writeDemoSession,
  type SessionStoreRef,
} from "@/lib/demo-session";
import { cn } from "@/lib/utils";

type MarketProduct = {
  id: string;
  title: string;
  description?: string;
  price: string;
  quantity: number;
  storeSlug: string;
  storeName: string;
  merchantDisplayName?: string;
  merchantAddress?: string;
  visaReceiveLabel?: string;
  visaReceiveId?: string;
  imageUrl: string;
  sellerVerification?: { onLedger: boolean; did: string | null };
};

type MarketPayload = {
  storeCount: number;
  productCount: number;
  products: MarketProduct[];
  stores: Array<{ slug: string; name: string; skuCount: number }>;
};

type Mode = "human" | "agent";

function articleFor(product: string) {
  return /^[aeiou]/i.test(product) ? "an" : "a";
}

export function MarketClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const modeParam = searchParams.get("mode");
  const mode: Mode = modeParam === "agent" ? "agent" : "human";

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [storeFilter, setStoreFilter] = useState<string | null>(null);
  const [data, setData] = useState<MarketPayload | null>(null);
  const [llmsTxt, setLlmsTxt] = useState<string>("");
  const [previewPath, setPreviewPath] = useState("/llms.txt");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  const loadMarket = useCallback(async (q: string) => {
    setBusy(true);
    setError(null);
    try {
      const url = q ? `/api/market?q=${encodeURIComponent(q)}` : "/api/market";
      const res = await fetch(url);
      const json = (await res.json()) as MarketPayload;
      if (!res.ok) throw new Error("Market API failed");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load market");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadMarket(debounced);
  }, [debounced, loadMarket]);

  useEffect(() => {
    if (mode !== "agent") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(previewPath);
        const text = await res.text();
        if (!cancelled) setLlmsTxt(text);
      } catch {
        if (!cancelled) setLlmsTxt(`Could not load ${previewPath}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, previewPath]);

  function setMode(next: Mode) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "human") params.delete("mode");
    else params.set("mode", "agent");
    const qs = params.toString();
    router.replace(qs ? `/market?${qs}` : "/market");
  }

  function buyWithAgent(product: MarketProduct) {
    const hint = singularProductHint(product.title);
    const ref: SessionStoreRef = {
      slug: product.storeSlug,
      name: product.storeName,
      productHint: hint,
    };
    const input = `Agent, go to /s/${product.storeSlug} and buy ${articleFor(hint)} ${hint}.`;
    const prev = readDemoSession();
    writeDemoSession({
      lastStore: ref,
      buyer: {
        input,
        lines: prev.buyer?.lines?.length
          ? prev.buyer.lines
          : [
              {
                role: "agent",
                text: "Buyer agent ready. I read /llms.txt + /registry.json — not HTML.",
              },
            ],
      },
    });
    router.push("/buyer");
  }

  const products = useMemo(() => {
    const list = data?.products ?? [];
    if (!storeFilter) return list;
    return list.filter((p) => p.storeSlug === storeFilter);
  }, [data?.products, storeFilter]);

  const empty = !busy && products.length === 0;

  return (
    <div
      className={cn(
        "min-h-[100dvh] transition-colors",
        mode === "human" ? "bg-[#f6f3ee]" : "bg-neutral-950",
      )}
    >
      <SiteHeader tone={mode === "agent" ? "dark" : "light"} variant="buyer" />

      {mode === "human" ? (
        <main className="mx-auto max-w-[1200px] px-5 pt-24 pb-20 md:px-8">
          <header className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#5c6b52]">
                Fashion marketplace
              </p>
              <h1 className="mt-2 font-[family-name:var(--font-syne)] text-4xl font-semibold tracking-tight text-[#1a1f16] md:text-5xl">
                Shop Borneo
              </h1>
              <p className="mt-3 max-w-[42ch] text-[15px] leading-relaxed text-[#1a1f16]/70">
                Apparel, accessories, and shoes. Checkout still runs through the
                Buyer agent — no fake cart.
              </p>
            </div>
            <ModeToggle mode={mode} onChange={setMode} />
          </header>

          <div className="mt-8 flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search shirts, sneakers, totes…"
                className="h-11 max-w-lg border-[#d9d2c5] bg-white text-[#1a1f16] shadow-sm"
              />
              <p className="text-xs text-[#1a1f16]/45">
                {busy
                  ? "Loading…"
                  : `${products.length} products · ${data?.storeCount ?? 0} shops`}
              </p>
            </div>

            {data?.stores?.length ? (
              <div className="flex flex-wrap gap-2">
                <StoreChip
                  active={!storeFilter}
                  label="All shops"
                  onClick={() => setStoreFilter(null)}
                />
                {data.stores.map((s) => (
                  <StoreChip
                    key={s.slug}
                    active={storeFilter === s.slug}
                    label={s.name}
                    onClick={() =>
                      setStoreFilter((prev) =>
                        prev === s.slug ? null : s.slug,
                      )
                    }
                  />
                ))}
              </div>
            ) : null}
          </div>

          {error ? (
            <p className="mt-6 text-sm text-red-700">{error}</p>
          ) : null}

          {empty ? (
            <div className="mt-10 rounded-2xl border border-dashed border-[#d9d2c5] bg-white/60 px-6 py-16 text-center">
              <p className="text-sm text-[#1a1f16]/70">
                No listings yet. Publish a store and it shows up here.
              </p>
              <Link
                href="/merchant/login"
                className="mt-4 inline-flex h-10 items-center justify-center rounded-full bg-[#2f5d3a] px-5 text-sm font-medium text-white"
              >
                Sell
              </Link>
            </div>
          ) : (
            <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
              {products.map((product, index) => (
                <article
                  key={`${product.storeSlug}-${product.id}-${index}`}
                  className="group flex flex-col overflow-hidden rounded-2xl border border-[#e6dfd3] bg-white shadow-[0_1px_0_rgba(26,31,22,0.04)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(26,31,22,0.08)]"
                >
                  <div className="relative aspect-square overflow-hidden bg-[#efeae2]">
                    <Image
                      src={product.imageUrl}
                      alt={product.title}
                      fill
                      sizes="(max-width: 768px) 50vw, 25vw"
                      className="object-cover transition duration-500 group-hover:scale-[1.03]"
                    />
                  </div>
                  <div className="flex flex-1 flex-col gap-2 p-3.5 sm:p-4">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-[#5c6b52]/80">
                      {product.merchantDisplayName
                        ? `Sold by ${product.merchantDisplayName}`
                        : product.storeName}
                      {product.sellerVerification?.onLedger ? (
                        <span
                          title={`Borneo verified-seller credential on XRPL${product.sellerVerification.did ? ` · ${product.sellerVerification.did}` : ""}`}
                          className="ml-2 inline-flex items-center rounded-full border border-[#5c6b52]/30 bg-[#5c6b52]/10 px-1.5 py-px align-middle text-[9px] font-semibold normal-case tracking-normal text-[#3f4c37]"
                        >
                          ✓ Verified on XRPL
                        </span>
                      ) : null}
                    </p>
                    <h2 className="line-clamp-2 text-sm font-semibold leading-snug text-[#1a1f16] sm:text-[15px]">
                      {product.title}
                    </h2>
                    {product.description ? (
                      <p className="line-clamp-2 text-xs leading-relaxed text-[#1a1f16]/50">
                        {product.description}
                      </p>
                    ) : null}
                    <div className="mt-auto flex items-end justify-between gap-2 pt-2">
                      <div>
                        <p className="font-[family-name:var(--font-syne)] text-lg font-semibold text-[#1a1f16]">
                          {product.price}
                          <span className="ml-1 text-xs font-medium text-[#1a1f16]/45">
                            RLUSD
                          </span>
                        </p>
                        <p className="text-[11px] text-[#1a1f16]/40">
                          {product.quantity} in stock
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        className="rounded-full bg-[#2f5d3a] px-3 text-xs text-white hover:bg-[#264a2f]"
                        onClick={() => buyWithAgent(product)}
                      >
                        Buy
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}

          <p className="mt-10 text-center text-xs text-[#1a1f16]/40">
            Each shop also publishes{" "}
            <span className="font-mono text-[#1a1f16]/55">
              /s/&#123;slug&#125;/llms.txt
            </span>
            . Flip to{" "}
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() => setMode("agent")}
            >
              Agents
            </button>{" "}
            to inspect them — or try{" "}
            <span className="font-mono text-[#1a1f16]/55">
              Agent, buy an oxford shirt.
            </span>
          </p>
        </main>
      ) : (
        <main className="mx-auto flex max-w-[1100px] flex-col gap-6 px-6 pt-24 pb-16 text-neutral-100">
          <header className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-emerald-500/80">
                agent://discovery
              </p>
              <h1 className="mt-2 font-mono text-2xl font-medium tracking-tight text-neutral-50 md:text-3xl">
                Network → shop llms.txt
              </h1>
              <p className="mt-2 max-w-[56ch] font-mono text-xs leading-relaxed text-neutral-400">
                Root <span className="text-emerald-400">/llms.txt</span> is the
                yellow pages. Every shop has its own instructions at{" "}
                <span className="text-emerald-400">/s/&#123;slug&#125;/llms.txt</span>{" "}
                (+ catalog.json, agent.json). Agents: index → shop file → buy.
              </p>
            </div>
            <ModeToggle mode={mode} onChange={setMode} inverse />
          </header>

          <div className="flex flex-wrap gap-2">
            <AgentLink href="/llms.txt">GET /llms.txt (network)</AgentLink>
            <AgentLink href="/registry.json">GET /registry.json</AgentLink>
            <AgentLink href="/buyer">Buyer · no slug</AgentLink>
          </div>

          <section className="rounded-md border border-neutral-800 bg-neutral-900/80">
            <div className="border-b border-neutral-800 px-4 py-2 font-mono text-[11px] text-neutral-500">
              per-shop surfaces (click to preview)
            </div>
            <ul className="divide-y divide-neutral-800">
              <li>
                <button
                  type="button"
                  onClick={() => setPreviewPath("/llms.txt")}
                  className={cn(
                    "flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left font-mono text-xs transition-colors hover:bg-neutral-800/80",
                    previewPath === "/llms.txt" && "bg-neutral-800",
                  )}
                >
                  <span className="text-neutral-200">Borneo network index</span>
                  <span className="text-emerald-400/90">/llms.txt</span>
                </button>
              </li>
              {(data?.stores ?? []).map((store) => {
                const shopLlms = `/s/${store.slug}/llms.txt`;
                return (
                  <li key={store.slug}>
                    <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setPreviewPath(shopLlms)}
                        className={cn(
                          "min-w-0 flex-1 text-left font-mono text-xs transition-colors",
                          previewPath === shopLlms
                            ? "text-emerald-300"
                            : "text-neutral-200 hover:text-emerald-400",
                        )}
                      >
                        <span className="block truncate">{store.name}</span>
                        <span className="text-neutral-500">
                          {shopLlms} · {store.skuCount} SKU
                          {store.skuCount === 1 ? "" : "s"}
                        </span>
                      </button>
                      <AgentLink href={shopLlms}>llms.txt</AgentLink>
                      <AgentLink href={`/s/${store.slug}/catalog.json`}>
                        catalog
                      </AgentLink>
                      <AgentLink href={`/s/${store.slug}/agent.json`}>
                        agent.json
                      </AgentLink>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <div className="overflow-hidden rounded-md border border-neutral-800 bg-black">
            <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2 font-mono text-[11px] text-neutral-500">
              <span className="truncate">GET {previewPath}</span>
              <span className="shrink-0 text-emerald-600">live</span>
            </div>
            <ScrollArea className="h-[min(50vh,420px)]">
              <pre className="whitespace-pre-wrap p-4 font-mono text-[11px] leading-relaxed text-emerald-400/90 md:text-xs">
                {llmsTxt || "// loading…"}
              </pre>
            </ScrollArea>
          </div>

          <p className="font-mono text-[11px] text-neutral-500">
            flow: GET /llms.txt → GET /s/atelier-cloth/llms.txt → GET catalog.json →
            POST /buy
          </p>
        </main>
      )}
    </div>
  );
}

function ModeToggle({
  mode,
  onChange,
  inverse,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
  inverse?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex rounded-full p-1",
        inverse
          ? "border border-neutral-700 bg-neutral-900"
          : "border border-[#d9d2c5] bg-white shadow-sm",
      )}
    >
      <button
        type="button"
        onClick={() => onChange("human")}
        className={cn(
          "rounded-full px-4 py-1.5 text-sm transition-colors",
          mode === "human"
            ? inverse
              ? "bg-neutral-100 text-neutral-900"
              : "bg-[#2f5d3a] text-white"
            : inverse
              ? "text-neutral-400 hover:text-neutral-200"
              : "text-[#1a1f16]/55 hover:text-[#1a1f16]",
        )}
      >
        Humans
      </button>
      <button
        type="button"
        onClick={() => onChange("agent")}
        className={cn(
          "rounded-full px-4 py-1.5 text-sm transition-colors",
          mode === "agent"
            ? inverse
              ? "bg-emerald-600 text-white"
              : "bg-[#2f5d3a] text-white"
            : inverse
              ? "text-neutral-400 hover:text-neutral-200"
              : "text-[#1a1f16]/55 hover:text-[#1a1f16]",
        )}
      >
        Agents
      </button>
    </div>
  );
}

function StoreChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-[#1a1f16] text-white"
          : "bg-white text-[#1a1f16]/65 ring-1 ring-[#d9d2c5] hover:text-[#1a1f16]",
      )}
    >
      {label}
    </button>
  );
}

function AgentLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      target={href.startsWith("http") || href.endsWith(".txt") || href.endsWith(".json") || href.startsWith("/api") || href.startsWith("/llms") || href.startsWith("/registry") ? "_blank" : undefined}
      className="rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 font-mono text-[11px] text-emerald-400/90 hover:border-emerald-700 hover:text-emerald-300"
    >
      {children}
    </Link>
  );
}
