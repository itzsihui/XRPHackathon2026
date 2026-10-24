"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProtocolLog } from "@/components/marketing/protocol-log";
import {
  evaluatePolicy,
  getBuyerCloudSyncUid,
  readBuyerAccount,
  recordSpend,
  formatSizingSummary,
} from "@/lib/buyer-account";
import { readDemoSession, writeDemoSession } from "@/lib/demo-session";
import { ProductPayModal } from "./_components/product-pay-modal";
import { CartPayModal } from "./_components/cart-pay-modal";
import { ChatHistorySidebar } from "./_components/chat-history-sidebar";
import { SalespersonChat } from "./_components/salesperson-chat";
import {
  catalogResultMessage,
  createInitialState,
  INITIAL_STEPS,
  profileBullets,
  selectedPick,
  sleep,
  SUGGEST_REPORT,
  SUGGEST_SIMILAR,
  updateStep,
  WELCOME_MESSAGE,
  type BuyerFlowState,
  type ChainStep,
  type ChatMessage,
  type FashionProfile,
  type MarketProductPick,
  type PaymentRail,
  type PurchaseQuote,
} from "./_lib/buyer-flow";
import {
  createDefaultStore,
  deriveChatTitle,
  emptyThread,
  readChatThreads,
  snapshotFromState,
  sortThreads,
  stateFromSnapshot,
  writeChatThreads,
  type ChatThread,
  type ChatThreadsStore,
} from "./_lib/chat-threads";
import { formatFlagSummary, discoverFashionPicks } from "./_lib/discover-client";
import type { SalespersonResult } from "./_lib/salesperson";

const META_ROLE = "buyer-flow-meta";

type PersistedMeta = {
  selectedId: string | null;
  rail: PaymentRail | null;
  phase: BuyerFlowState["phase"];
  picks: MarketProductPick[];
  snowtrace: string | null;
  messages: ChatMessage[];
  suggestions: string[];
  profile: FashionProfile | null;
  intent: string;
};

function stepsToLines(
  steps: ChainStep[],
): Array<{ role: string; text: string }> {
  const lines: Array<{ role: string; text: string }> = [];
  for (const step of steps) {
    lines.push({
      role: `cot/${step.status}`,
      text: step.title + (step.description ? ` — ${step.description}` : ""),
    });
    for (const bullet of step.bullets ?? []) {
      lines.push({ role: "cot/bullet", text: bullet });
    }
    for (const proto of step.protocolLines ?? []) {
      lines.push(proto);
    }
  }
  return lines;
}

function encodeSessionLines(
  steps: ChainStep[],
  meta: PersistedMeta,
): Array<{ role: string; text: string }> {
  return [
    { role: META_ROLE, text: JSON.stringify(meta) },
    ...stepsToLines(steps),
  ];
}

function parseSessionMeta(
  lines: Array<{ role: string; text: string }> | undefined,
): PersistedMeta | null {
  const raw = lines?.find((l) => l.role === META_ROLE)?.text;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedMeta;
  } catch {
    return null;
  }
}

export default function BuyerPage() {
  const [hydrated, setHydrated] = useState(false);
  const [storeSlug, setStoreSlug] = useState<string | null>(null);
  const [state, setState] = useState<BuyerFlowState>(() =>
    createInitialState(),
  );
  const [receiptNote, setReceiptNote] = useState<string | null>(null);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(true);
  const messagesRef = useRef<ChatMessage[]>([WELCOME_MESSAGE]);
  const profileRef = useRef<FashionProfile | null>(null);
  const flaggedRef = useRef<
    Array<{ id: string; storeSlug: string; flags: string[] }>
  >([]);
  const searchQueriesRef = useRef<string[]>([]);
  const intentRef = useRef("");
  const activeThreadIdRef = useRef("");
  const stateRef = useRef(state);
  const threadsRef = useRef<ChatThread[]>([]);
  const sidebarPinnedRef = useRef(true);

  useEffect(() => {
    messagesRef.current = state.messages;
    profileRef.current = state.profile;
    flaggedRef.current = state.flaggedSkus ?? [];
    searchQueriesRef.current = state.lastSearchQueries ?? [];
    intentRef.current = state.intent;
    stateRef.current = state;
  }, [
    state.messages,
    state.profile,
    state.flaggedSkus,
    state.lastSearchQueries,
    state.intent,
    state,
  ]);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);

  useEffect(() => {
    sidebarPinnedRef.current = sidebarPinned;
  }, [sidebarPinned]);

  useEffect(() => {
    const session = readDemoSession();
    const store = session.lastStore ?? null;
    setStoreSlug(store?.slug ?? null);

    const existing = readChatThreads();
    let storeThreads: ChatThreadsStore;

    if (existing) {
      storeThreads = existing;
    } else {
      const meta = parseSessionMeta(session.buyer?.lines);
      const seed = meta
        ? {
            selectedId: meta.selectedId,
            rail: meta.rail,
            phase: (String(meta.phase) === "thinking" ||
            String(meta.phase) === "settle" ||
            String(meta.phase) === "intent"
              ? "chat"
              : meta.phase) as BuyerFlowState["phase"],
            picks: meta.picks ?? [],
            snowtrace: meta.snowtrace,
            messages:
              meta.messages?.length > 0 ? meta.messages : [WELCOME_MESSAGE],
            suggestions: meta.suggestions ?? [],
            profile: meta.profile,
            intent: meta.intent || "",
            cart: [] as MarketProductPick[],
            cartQty: {} as Record<string, number>,
            flaggedSkus: [],
            lastSearchQueries: [] as string[],
          }
        : null;
      storeThreads = createDefaultStore(seed);
      writeChatThreads(storeThreads);
    }

    const active =
      storeThreads.threads.find((t) => t.id === storeThreads.activeId) ??
      storeThreads.threads[0]!;
    const next = stateFromSnapshot(active.snapshot);

    if (next.picks.length) {
      next.steps = INITIAL_STEPS.map((s) => ({
        ...s,
        status: "complete" as const,
        description:
          s.id === "rank"
            ? `Restored ${next.picks.length} catalog pick(s)`
            : s.description,
      }));
    }

    setThreads(sortThreads(storeThreads.threads));
    threadsRef.current = storeThreads.threads;
    setActiveThreadId(active.id);
    activeThreadIdRef.current = active.id;
    setSidebarPinned(storeThreads.sidebarOpen);
    sidebarPinnedRef.current = storeThreads.sidebarOpen;
    setSidebarOpen(storeThreads.sidebarOpen);
    setState(next);
    messagesRef.current = next.messages;
    profileRef.current = next.profile;
    stateRef.current = next;
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || !activeThreadId) return;

    const title = deriveChatTitle({
      intent: state.intent,
      lastSearchQueries: state.lastSearchQueries,
      profile: state.profile,
      messages: state.messages,
    });
    const snapshot = snapshotFromState(state);
    const now = Date.now();

    setThreads((prev) => {
      const nextThreads = prev.map((t) =>
        t.id === activeThreadId
          ? {
              ...t,
              title:
                title === "New chat" && t.title !== "New chat" ? t.title : title,
              updatedAt: now,
              snapshot,
            }
          : t,
      );
      threadsRef.current = nextThreads;
      writeChatThreads({
        activeId: activeThreadId,
        threads: nextThreads,
        sidebarOpen: sidebarPinned,
      });
      return sortThreads(nextThreads);
    });

    writeDemoSession({
      buyer: {
        input: state.intent || state.messages.at(-1)?.content || "",
        lines: encodeSessionLines(state.steps, {
          selectedId: state.selectedId,
          rail: state.rail,
          phase: state.phase,
          picks: state.picks,
          snowtrace: state.snowtrace,
          messages: state.messages,
          suggestions: state.suggestions,
          profile: state.profile,
          intent: state.intent,
        }),
      },
    });
  }, [hydrated, state, activeThreadId, sidebarPinned]);

  const applyThreadState = useCallback((next: BuyerFlowState) => {
    setState(next);
    messagesRef.current = next.messages;
    profileRef.current = next.profile;
    stateRef.current = next;
    setReceiptNote(null);
  }, []);

  const saveCurrentThreadSnapshot = useCallback(() => {
    const id = activeThreadIdRef.current;
    if (!id) return;
    const current = stateRef.current;
    const title = deriveChatTitle({
      intent: current.intent,
      lastSearchQueries: current.lastSearchQueries,
      profile: current.profile,
      messages: current.messages,
    });
    const snapshot = snapshotFromState(current);
    const now = Date.now();
    const pinned = sidebarPinnedRef.current;
    const nextThreads = threadsRef.current.map((t) =>
      t.id === id
        ? {
            ...t,
            title:
              title === "New chat" && t.title !== "New chat" ? t.title : title,
            updatedAt: now,
            snapshot,
          }
        : t,
    );
    threadsRef.current = nextThreads;
    setThreads(sortThreads(nextThreads));
    writeChatThreads({
      activeId: id,
      threads: nextThreads,
      sidebarOpen: pinned,
    });
  }, []);

  const handleNewChat = useCallback(() => {
    saveCurrentThreadSnapshot();
    const thread = emptyThread();
    const nextThreads = [thread, ...threadsRef.current];
    threadsRef.current = nextThreads;
    setThreads(sortThreads(nextThreads));
    writeChatThreads({
      activeId: thread.id,
      threads: nextThreads,
      sidebarOpen: sidebarPinnedRef.current,
    });
    setActiveThreadId(thread.id);
    activeThreadIdRef.current = thread.id;
    applyThreadState(createInitialState());
  }, [applyThreadState, saveCurrentThreadSnapshot]);

  const handleSelectThread = useCallback(
    (id: string) => {
      if (id === activeThreadIdRef.current) return;
      saveCurrentThreadSnapshot();
      const target = threadsRef.current.find((t) => t.id === id);
      if (!target) return;
      writeChatThreads({
        activeId: id,
        threads: threadsRef.current,
        sidebarOpen: sidebarPinnedRef.current,
      });
      setActiveThreadId(id);
      activeThreadIdRef.current = id;
      applyThreadState(stateFromSnapshot(target.snapshot));
    },
    [applyThreadState, saveCurrentThreadSnapshot],
  );

  const handleDeleteThread = useCallback(
    (id: string) => {
      const remaining = threadsRef.current.filter((t) => t.id !== id);
      if (remaining.length === 0) {
        const thread = emptyThread();
        threadsRef.current = [thread];
        setThreads([thread]);
        writeChatThreads({
          activeId: thread.id,
          threads: [thread],
          sidebarOpen: sidebarPinnedRef.current,
        });
        setActiveThreadId(thread.id);
        activeThreadIdRef.current = thread.id;
        applyThreadState(createInitialState());
        return;
      }

      const deletingActive = id === activeThreadIdRef.current;
      const nextActive = deletingActive
        ? remaining[0]!
        : remaining.find((t) => t.id === activeThreadIdRef.current) ??
          remaining[0]!;

      threadsRef.current = remaining;
      setThreads(sortThreads(remaining));
      writeChatThreads({
        activeId: nextActive.id,
        threads: remaining,
        sidebarOpen: sidebarPinnedRef.current,
      });

      if (deletingActive) {
        setActiveThreadId(nextActive.id);
        activeThreadIdRef.current = nextActive.id;
        applyThreadState(stateFromSnapshot(nextActive.snapshot));
      }
    },
    [applyThreadState],
  );

  const selected = useMemo(() => selectedPick(state), [state]);

  const runDiscovery = useCallback(
    async (
      query: string,
      profile: FashionProfile | null,
      opts?: {
        searchQueries?: string[];
        thoughts?: string[];
        excludeSkuIds?: string[];
        similarClean?: boolean;
      },
    ) => {
      const intent = query.trim();
      if (!intent) return;

      const thoughtBullets = [
        ...new Map(
          (opts?.thoughts || [])
            .filter(Boolean)
            .map((t) => [t.trim().toLowerCase().replace(/\s+/g, " "), t.trim()]),
        ).values(),
      ];
      const queries = opts?.searchQueries?.length
        ? opts.searchQueries
        : [intent];

      setState((prev) => ({
        ...prev,
        phase: "thinking",
        intent,
        profile,
        busy: true,
        chatBusy: false,
        error: null,
        picks: [],
        selectedId: null,
        rail: null,
        detailOpen: false,
        snowtrace: null,
        suggestions: [],
        flaggedSkus: [],
        lastSearchQueries: queries,
        steps: INITIAL_STEPS.map((s) => ({ ...s })),
      }));
      setReceiptNote(null);

      try {
        // Kick off catalog hunt immediately — don't wait on CoT theatrics
        const sizing = readBuyerAccount()?.sizing;
        const sizingLine = formatSizingSummary(sizing);
        const discoveryPromise = discoverFashionPicks(
          intent,
          profile,
          opts?.searchQueries,
          { excludeSkuIds: opts?.excludeSkuIds, sizing },
        );

        setState((prev) => ({
          ...prev,
          steps: updateStep(prev.steps, "parse", {
            status: "active",
            description: `Catalog hunt: “${intent}”`,
            bullets: thoughtBullets.length ? thoughtBullets : undefined,
          }),
        }));
        await sleep(40);

        setState((prev) => ({
          ...prev,
          steps: updateStep(
            updateStep(prev.steps, "parse", {
              status: "complete",
              description: thoughtBullets.length
                ? "Salesperson intent → catalog terms"
                : "Intent locked from salesperson chat",
              bullets: thoughtBullets.length ? thoughtBullets : undefined,
            }),
            "decompose",
            {
              status: "active",
              bullets: profileBullets(profile),
            },
          ),
        }));
        await sleep(40);

        setState((prev) => ({
          ...prev,
          steps: updateStep(prev.steps, "search", {
            status: "active",
            description: "GET /api/search · ranking market catalog…",
          }),
        }));

        const { picks, flagged, decomposed, storeSlugs, searchUrls } =
          await discoveryPromise;

        const flaggedMeta = flagged.map((f) => ({
          id: f.id,
          storeSlug: f.storeSlug,
          flags: f.injectionFlags,
        }));
        flaggedRef.current = flaggedMeta;
        searchQueriesRef.current = queries;
        intentRef.current = intent;

        setState((prev) => ({
          ...prev,
          flaggedSkus: flaggedMeta,
          lastSearchQueries: queries,
          steps: updateStep(
            updateStep(prev.steps, "decompose", {
              status: "complete",
              bullets: [
                ...profileBullets(profile),
                ...(sizingLine
                  ? [`Preferencing your fit: ${sizingLine}`]
                  : []),
                ...(opts?.searchQueries?.length
                  ? [`Queries: ${opts.searchQueries.join(" · ")}`]
                  : []),
                ...decomposed.constraints.filter(
                  (c) => !c.startsWith("Category:"),
                ),
              ],
            }),
            "search",
            {
              status: "complete",
              description:
                storeSlugs.length > 0
                  ? `Matched ${storeSlugs.length} seller store(s)`
                  : "No store hits",
              links: [
                ...searchUrls.slice(0, 3).map((href) => ({
                  label: href.length > 48 ? `${href.slice(0, 45)}…` : href,
                  href,
                })),
                ...storeSlugs.slice(0, 4).map((slug) => ({
                  label: `/s/${slug}/catalog.json`,
                  href: `/s/${slug}/catalog.json`,
                })),
              ],
            },
          ),
        }));
        await sleep(30);

        setState((prev) => ({
          ...prev,
          steps: updateStep(
            updateStep(prev.steps, "quarantine", {
              status: "complete",
              description:
                flagged.length > 0
                  ? `Encountered ${flagged.length} injection-shaped listing(s) while ranking — held out of fashion picks`
                  : "No injection-shaped catalog copy matched this hunt",
              bullets:
                flagged.length > 0
                  ? flagged.map((f) => `Flagged SKU: ${formatFlagSummary(f)}`)
                  : ["Catalog copy treated as data only"],
            }),
            "rank",
            {
              status: "active",
              description: "Scoring clean / typed catalog fields…",
            },
          ),
        }));
        await sleep(30);

        const resultText = catalogResultMessage(intent, picks, profile, {
          flaggedCount: flagged.length,
          flaggedSummaries: flagged.map(formatFlagSummary),
        });

        const suggestions =
          flagged.length > 0
            ? [SUGGEST_REPORT, SUGGEST_SIMILAR, "Something else?"]
            : opts?.similarClean
              ? ["Something else?", "Looking for a tee", "Looking for a cap"]
              : [
                  "Something else?",
                  "Looking for a tee",
                  "Looking for a cap",
                ];

        if (picks.length === 0) {
          setState((prev) => {
            const steps = updateStep(prev.steps, "rank", {
              status: "error",
              description: "No clean catalog matches for this request.",
              links: [{ label: "Browse Market", href: "/market" }],
            });
            return {
              ...prev,
              phase: "chat",
              busy: false,
              picks: [],
              flaggedSkus: flaggedMeta,
              suggestions:
                flagged.length > 0
                  ? [SUGGEST_REPORT, SUGGEST_SIMILAR, "Browse Market"]
                  : [
                      "I want a t-shirt",
                      "Looking for a cap",
                      "Browse Market",
                    ],
              messages: [
                ...prev.messages,
                { role: "assistant", content: resultText, steps },
              ],
              steps,
            };
          });
          return;
        }

        setState((prev) => {
          const steps = updateStep(prev.steps, "rank", {
            status: "complete",
            description: `Top ${picks.length} seller product(s)`,
            bullets: picks.map((p) => {
              const label = p.quarantined
                ? `${p.storeSlug}:${p.id.split(":")[1] || p.id}`
                : p.title;
              return `${label} @ /s/${p.storeSlug} · ${p.price} RLUSD (score ${p.score})${p.quarantined ? " · quarantined" : ""}`;
            }),
          });
          return {
            ...prev,
            phase: "chat",
            busy: false,
            picks,
            flaggedSkus: flaggedMeta,
            suggestions,
            messages: [
              ...prev.messages,
              {
                role: "assistant",
                content: resultText,
                products: picks,
                steps,
              },
            ],
            steps,
          };
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Discovery failed";
        setState((prev) => {
          const steps = updateStep(prev.steps, "search", {
            status: "error",
            description: message,
          });
          return {
            ...prev,
            phase: "chat",
            busy: false,
            error: message,
            messages: [
              ...prev.messages,
              {
                role: "assistant",
                content: `Search failed: ${message}. Try again?`,
                steps,
              },
            ],
            steps,
          };
        });
      }
    },
    [],
  );

  const reportFlaggedListing = useCallback(async () => {
    const target = flaggedRef.current[0];
    const userMsg: ChatMessage = {
      role: "user",
      content: SUGGEST_REPORT,
    };
    const nextMessages = [...messagesRef.current, userMsg];
    messagesRef.current = nextMessages;
    setState((prev) => ({
      ...prev,
      messages: nextMessages,
      chatBusy: true,
      suggestions: [],
    }));

    if (!target) {
      const assistant: ChatMessage = {
        role: "assistant",
        content:
          "Nothing flagged in the last search to report. If you open a suspicious listing, try again after quarantine runs.",
      };
      const withAssistant = [...messagesRef.current, assistant];
      messagesRef.current = withAssistant;
      setState((prev) => ({
        ...prev,
        messages: withAssistant,
        chatBusy: false,
        suggestions: ["Find a similar clean product", "Something else?"],
      }));
      return;
    }

    try {
      const res = await fetch("/api/catalog-report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          storeSlug: target.storeSlug,
          skuId: target.id,
          flags: target.flags,
          intentSnippet: intentRef.current,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; reportId?: string };
      const assistant: ChatMessage = {
        role: "assistant",
        content: data.ok
          ? `Reported listing ${target.storeSlug}:${target.id}${data.reportId ? ` (${data.reportId})` : ""}. Thanks — that helps keep the network clean. Settle would still lock payee and amount if anyone paid. Want a similar clean product instead?`
          : "Could not file the report — try again in a moment.",
      };
      const withAssistant = [...messagesRef.current, assistant];
      messagesRef.current = withAssistant;
      setState((prev) => ({
        ...prev,
        messages: withAssistant,
        chatBusy: false,
        suggestions: [SUGGEST_SIMILAR, "Something else?"],
      }));
    } catch {
      const assistant: ChatMessage = {
        role: "assistant",
        content: "Report failed to reach the server. Try again?",
      };
      const withAssistant = [...messagesRef.current, assistant];
      messagesRef.current = withAssistant;
      setState((prev) => ({
        ...prev,
        messages: withAssistant,
        chatBusy: false,
        suggestions: [SUGGEST_REPORT, SUGGEST_SIMILAR],
      }));
    }
  }, []);

  const searchSimilarClean = useCallback(async () => {
    const profile = profileRef.current;
    const intent =
      intentRef.current ||
      searchQueriesRef.current.join(" ") ||
      "shirt tee";
    const exclude = flaggedRef.current.flatMap((f) => [
      f.id,
      `${f.storeSlug}:${f.id}`,
    ]);
    const userMsg: ChatMessage = {
      role: "user",
      content: SUGGEST_SIMILAR,
    };
    const nextMessages = [...messagesRef.current, userMsg];
    messagesRef.current = nextMessages;
    setState((prev) => ({
      ...prev,
      messages: nextMessages,
      chatBusy: false,
      suggestions: [],
    }));

    const bridge: ChatMessage = {
      role: "assistant",
      content:
        "Searching seller catalogs again for a similar clean product — excluding quarantined listings.",
    };
    const withBridge = [...messagesRef.current, bridge];
    messagesRef.current = withBridge;
    setState((prev) => ({ ...prev, messages: withBridge }));

    await runDiscovery(intent, profile, {
      searchQueries: searchQueriesRef.current.length
        ? searchQueriesRef.current
        : [intent],
      excludeSkuIds: exclude,
      similarClean: true,
      thoughts: [
        "Privileged path: re-search without flagged SKUs",
        "Quarantined listings excluded from fashion rank",
      ],
    });
  }, [runDiscovery]);

  const sendChat = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      if (trimmed === SUGGEST_REPORT) {
        await reportFlaggedListing();
        return;
      }
      if (trimmed === SUGGEST_SIMILAR) {
        await searchSimilarClean();
        return;
      }

      const userMsg: ChatMessage = { role: "user", content: trimmed };
      const priorProfile = profileRef.current;

      const nextMessages = [...messagesRef.current, userMsg];
      messagesRef.current = nextMessages;

      setState((prev) => ({
        ...prev,
        messages: nextMessages,
        chatBusy: true,
        error: null,
        suggestions: [],
      }));

      try {
        const res = await fetch("/api/buyer-chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: nextMessages }),
        });
        const data = (await res.json()) as SalespersonResult & {
          error?: string;
        };

        const profile = data.profile ?? priorProfile;
        const ready = data.status === "ready" && Boolean(data.searchQuery);
        const thoughtBullets = [
          ...new Map(
            (data.thoughts || [])
              .filter(Boolean)
              .map((t) => [
                t.trim().toLowerCase().replace(/\s+/g, " "),
                t.trim(),
              ]),
          ).values(),
        ];

        const assistant: ChatMessage = {
          role: "assistant",
          content: ready
            ? data.reply?.match(/found|here'?s what/i)
              ? "I'll search the Borneo network for that now."
              : data.reply || "I'll search the Borneo network for that now."
            : data.reply || "Tell me a bit more about what you want.",
          // Clarifying turns: show occasion inference before catalog search
          ...(!ready && thoughtBullets.length
            ? {
                steps: [
                  {
                    id: "parse",
                    title: "Parse fashion intent",
                    status: "complete" as const,
                    capability: "privileged" as const,
                    description: "Salesperson intent from conversation",
                    bullets: thoughtBullets,
                  },
                ] satisfies ChainStep[],
              }
            : {}),
        };

        const withAssistant = [...messagesRef.current, assistant];
        messagesRef.current = withAssistant;

        setState((prev) => ({
          ...prev,
          messages: withAssistant,
          suggestions: ready ? [] : (data.suggestions ?? []),
          profile,
          chatBusy: false,
        }));

        if (ready && data.searchQuery) {
          await runDiscovery(data.searchQuery, profile, {
            searchQueries: data.searchQueries,
            thoughts: data.thoughts,
          });
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Chat failed";
        setState((prev) => ({
          ...prev,
          chatBusy: false,
          error: message,
          messages: [
            ...prev.messages,
            {
              role: "assistant",
              content: "I hit a snag — try that again?",
            },
          ],
          suggestions: ["I want a t-shirt", "Looking for a cap"],
        }));
      }
    },
    [runDiscovery, reportFlaggedListing, searchSimilarClean],
  );

  const settleProducts = useCallback(
    async (
      lines: Array<MarketProductPick & { quantity: number }>,
      rail: PaymentRail,
      opts: { clearCart: boolean; closeDetail: boolean },
    ) => {
      const account = readBuyerAccount();
      if (!account) {
        setState((prev) => ({
          ...prev,
          error: "Complete buyer onboarding before checkout",
          detailOpen: false,
          cartCheckoutOpen: false,
        }));
        return;
      }

      const totalAmount = lines.reduce(
        (sum, line) => sum + Number(line.price) * line.quantity,
        0,
      );
      if (!Number.isFinite(totalAmount) || totalAmount < 0) {
        setState((prev) => ({ ...prev, error: "Invalid cart total" }));
        return;
      }

      const policyCheck = evaluatePolicy(account, totalAmount);
      if (!policyCheck.ok) {
        setState((prev) => ({
          ...prev,
          error: policyCheck.reason,
          detailOpen: opts.closeDetail,
          cartCheckoutOpen: !opts.closeDetail,
          busy: false,
          phase: "chat",
        }));
        return;
      }

      setState((prev) => ({
        ...prev,
        phase: "settle",
        busy: true,
        detailOpen: false,
        cartCheckoutOpen: false,
        error: null,
        steps: [
          ...prev.steps.filter((s) => s.id !== "settle"),
          {
            id: "settle",
            title:
              rail === "mastercard"
                ? `Settling Mastercard AP4M · ${lines.length} locked quote(s)`
                : rail === "xrp"
                  ? `Settling XRP→RLUSD · ${lines.length} locked quote(s)`
                  : `Settling RLUSD x402 · ${lines.length} locked quote(s)`,
            status: "active",
            capability: "privileged",
            description: "Authorized — each SKU settles on its locked quote…",
          },
        ],
      }));

      const links: Array<{ label: string; href: string }> = [];

      try {
        for (const line of lines) {
          const unit = Number(line.price);
          const skuId = line.id.includes(":")
            ? line.id.slice(line.id.indexOf(":") + 1)
            : line.id;
          const quote: PurchaseQuote = {
            storeSlug: line.storeSlug,
            skuId,
            price: line.price,
            merchantAddress: line.merchantAddress,
            rail,
          };

          for (let q = 0; q < line.quantity; q++) {
            if (rail === "stablecoin") {
              const res = await fetch("/api/buyer-agent", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  buyerUid: getBuyerCloudSyncUid() || undefined,
                  quote: {
                    storeSlug: quote.storeSlug,
                    skuId: quote.skuId,
                    price: quote.price,
                    merchantAddress: quote.merchantAddress,
                  },
                }),
              });
              const data = (await res.json()) as {
                steps?: Array<{ type: string; text: string }>;
                error?: string;
                receipt?: { explorerUrl?: string; orderId?: string };
              };
              if (
                (data.steps ?? []).some((s) => s.type === "error") ||
                !(data.steps ?? []).some((s) => s.type === "success")
              ) {
                const errStep = (data.steps ?? []).find((s) => s.type === "error");
                throw new Error(
                  errStep?.text || data.error || "x402 settlement failed",
                );
              }
              const explorer =
                data.receipt?.explorerUrl ||
                (data.steps ?? []).find(
                  (s) =>
                    s.type === "success" && /^https?:\/\//i.test(s.text.trim()),
                )?.text.trim();
              recordSpend({
                amount: unit,
                rail: "x402",
                title: line.title,
                storeSlug: line.storeSlug,
                storeName: line.storeName,
                merchantDisplayName: line.merchantDisplayName,
                merchantReceive: line.merchantAddress,
                skuId,
                imageUrl: line.imageUrl,
                explorerUrl: explorer,
                orderId: data.receipt?.orderId,
              });
              if (explorer) {
                links.push({
                  label: `XRPL explorer · ${skuId}`,
                  href: explorer,
                });
              }
            } else if (rail === "xrp") {
              const res = await fetch("/api/fx-settle", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  storeSlug: quote.storeSlug,
                  skuId: quote.skuId,
                  quantity: 1,
                  buyerUid: getBuyerCloudSyncUid() || undefined,
                }),
              });
              const data = (await res.json()) as {
                steps?: Array<{ type: string; text: string }>;
                error?: string;
                receipt?: {
                  explorerUrl?: string;
                  orderId?: string;
                  sentXrp?: string;
                  deliveredRlusd?: string;
                };
              };
              if (
                (data.steps ?? []).some((s) => s.type === "error") ||
                !(data.steps ?? []).some((s) => s.type === "success")
              ) {
                const errStep = (data.steps ?? []).find((s) => s.type === "error");
                throw new Error(
                  errStep?.text || data.error || "XRP→RLUSD settlement failed",
                );
              }
              const explorer =
                data.receipt?.explorerUrl ||
                (data.steps ?? []).find(
                  (s) =>
                    s.type === "success" && /^https?:\/\//i.test(s.text.trim()),
                )?.text.trim();
              const fxNote = (data.steps ?? []).find(
                (s) =>
                  s.type === "success" &&
                  /spent .+ XRP · merchant received/i.test(s.text),
              )?.text;
              recordSpend({
                amount: unit,
                rail: "xrpl-xrp",
                title: line.title,
                storeSlug: line.storeSlug,
                storeName: line.storeName,
                merchantDisplayName: line.merchantDisplayName,
                merchantReceive: line.merchantAddress,
                skuId,
                imageUrl: line.imageUrl,
                explorerUrl: explorer,
                sentXrp: data.receipt?.sentXrp,
                deliveredRlusd: data.receipt?.deliveredRlusd,
                orderId: data.receipt?.orderId,
              });
              if (explorer) {
                links.push({
                  label: fxNote
                    ? `XRPL · ${fxNote.replace(/^Paid ·\s*/i, "")}`
                    : `XRPL explorer · ${skuId}`,
                  href: explorer,
                });
              }
            } else {
              const res = await fetch("/api/ap4m-settle", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  storeSlug: line.storeSlug,
                  skuId,
                  price: line.price,
                  title: line.title,
                  operation: `borneo-${line.storeSlug}-${skuId}-${Date.now()}-${q}`
                    .toLowerCase()
                    .replace(/[^a-z0-9._:-]+/g, "-")
                    .slice(0, 64),
                }),
              });
              const data = (await res.json()) as {
                steps?: Array<{ type: string; text: string }>;
                error?: string;
                receipt?: {
                  orderId?: string;
                  explorerUrl?: string;
                  channelId?: string;
                };
              };
              if (
                (data.steps ?? []).some((s) => s.type === "error") ||
                !(data.steps ?? []).some((s) => s.type === "success")
              ) {
                const errStep = (data.steps ?? []).find((s) => s.type === "error");
                throw new Error(
                  errStep?.text ||
                    data.error ||
                    "Mastercard AP4M checkout failed",
                );
              }
              const explorer = data.receipt?.explorerUrl;
              recordSpend({
                amount: unit,
                rail: "ap4m",
                title: line.title,
                storeSlug: line.storeSlug,
                storeName: line.storeName,
                merchantDisplayName: line.merchantDisplayName,
                merchantReceive:
                  data.receipt?.channelId || line.storeSlug,
                skuId,
                imageUrl: line.imageUrl,
                orderId: data.receipt?.orderId,
                explorerUrl: explorer,
              });
              if (explorer) {
                links.push({
                  label: `AP4M explorer · ${skuId}`,
                  href: explorer,
                });
              }
            }
          }
        }

        setReceiptNote(null);
        setState((prev) => ({
          ...prev,
          phase: "done",
          busy: false,
          detailOpen: false,
          cartCheckoutOpen: false,
          cart: opts.clearCart ? [] : prev.cart,
          cartQty: opts.clearCart ? {} : prev.cartQty,
          snowtrace: links[0]?.href ?? prev.snowtrace,
          messages: [
            ...prev.messages,
            {
              role: "assistant",
              content: "Purchase complete.",
              links: links.length
                ? links.slice(0, 4).map((l, i) => ({
                    label:
                      links.length === 1
                        ? "View transaction on ledger"
                        : `View transaction on ledger (${i + 1})`,
                    href: l.href,
                  }))
                : undefined,
            },
          ],
          steps: updateStep(prev.steps, "settle", {
            status: "complete",
            description:
              rail === "mastercard"
                ? "Mastercard AP4M settles complete"
                : rail === "xrp"
                  ? "XRP→RLUSD settles complete"
                  : "x402 settles complete",
            links: links.slice(0, 4),
          }),
        }));
      } catch (error) {
        const messageText =
          error instanceof Error ? error.message : "Payment failed";
        setState((prev) => ({
          ...prev,
          phase: "chat",
          busy: false,
          error: messageText,
          steps: updateStep(prev.steps, "settle", {
            status: "error",
            description: messageText,
          }),
        }));
      }
    },
    [],
  );

  const authorizePurchaseSingle = useCallback(async () => {
    const product = selectedPick(state);
    const rail = state.rail;
    if (!product || !rail) return;
    await settleProducts([{ ...product, quantity: 1 }], rail, {
      clearCart: false,
      closeDetail: true,
    });
  }, [state, settleProducts]);

  const authorizeCart = useCallback(async () => {
    const rail = state.rail;
    if (!rail || state.cart.length === 0) return;
    const lines = state.cart.map((p) => ({
      ...p,
      quantity: Math.max(1, state.cartQty[p.id] || 1),
    }));
    await settleProducts(lines, rail, { clearCart: true, closeDetail: false });
  }, [state.rail, state.cart, state.cartQty, settleProducts]);

  const cartLines = state.cart.map((p) => ({
    id: p.id,
    name: p.title,
    price: Number(p.price) || 0,
    category: `/s/${p.storeSlug}`,
    image: p.imageUrl,
    color: p.storeName,
    quantity: Math.max(1, state.cartQty[p.id] || 1),
    meta: { product: p },
  }));

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col md:flex-row">
      {hydrated && activeThreadId ? (
        <ChatHistorySidebar
          threads={threads}
          activeId={activeThreadId}
          open={sidebarOpen}
          onOpenChange={setSidebarOpen}
          pinned={sidebarPinned}
          onPinnedChange={(pinned) => {
            setSidebarPinned(pinned);
            sidebarPinnedRef.current = pinned;
            setSidebarOpen(pinned);
            writeChatThreads({
              activeId: activeThreadIdRef.current || activeThreadId,
              threads: threadsRef.current,
              sidebarOpen: pinned,
            });
          }}
          onNew={handleNewChat}
          onSelect={handleSelectThread}
          onDelete={handleDeleteThread}
        />
      ) : null}

      <main className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-1 flex-col gap-2 px-3 py-3 sm:px-6">
        {storeSlug ? (
          <p className="shrink-0 px-1 text-[11px] text-foreground/45">
            Last handoff{" "}
            <span className="font-mono text-foreground/70">/s/{storeSlug}</span>
          </p>
        ) : null}

        {state.error ? (
          <p className="shrink-0 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {state.error}
          </p>
        ) : null}

        <SalespersonChat
          messages={state.messages}
          suggestions={state.suggestions}
          steps={state.steps}
          onSend={(text) => void sendChat(text)}
          onProductClick={(product) =>
            setState((prev) => ({
              ...prev,
              selectedId: product.id,
              picks: prev.picks.some((p) => p.id === product.id)
                ? prev.picks
                : [...prev.picks, product],
              detailOpen: true,
              rail: prev.rail,
              error: null,
            }))
          }
          cartLines={cartLines}
          onCartAdd={(product) =>
            setState((prev) => {
              if (prev.cart.some((c) => c.id === product.id)) {
                return {
                  ...prev,
                  cartQty: {
                    ...prev.cartQty,
                    [product.id]: (prev.cartQty[product.id] || 1) + 1,
                  },
                };
              }
              return {
                ...prev,
                cart: [...prev.cart, product],
                cartQty: { ...prev.cartQty, [product.id]: 1 },
              };
            })
          }
          onCartRemove={(productId) =>
            setState((prev) => {
              const nextQty = { ...prev.cartQty };
              delete nextQty[productId];
              return {
                ...prev,
                cart: prev.cart.filter((c) => c.id !== productId),
                cartQty: nextQty,
              };
            })
          }
          onCartQty={(productId, quantity) =>
            setState((prev) => {
              if (quantity <= 0) {
                const nextQty = { ...prev.cartQty };
                delete nextQty[productId];
                return {
                  ...prev,
                  cart: prev.cart.filter((c) => c.id !== productId),
                  cartQty: nextQty,
                };
              }
              return {
                ...prev,
                cartQty: { ...prev.cartQty, [productId]: quantity },
              };
            })
          }
          onCartClear={() =>
            setState((prev) => ({ ...prev, cart: [], cartQty: {} }))
          }
          onCartCheckout={() =>
            setState((prev) => ({
              ...prev,
              cartCheckoutOpen: true,
              detailOpen: false,
              error: null,
            }))
          }
          chatBusy={state.chatBusy}
          searching={state.busy}
          disabled={state.busy && state.phase === "settle"}
        />

        <ProductPayModal
          open={state.detailOpen}
          product={selected}
          rail={state.rail}
          busy={state.busy}
          receiptNote={receiptNote}
          acceptRlusd={selected?.acceptRlusd !== false}
          acceptXrp={selected?.acceptXrp !== false}
          acceptMastercard={selected?.acceptMastercard !== false}
          onRailChange={(rail) =>
            setState((prev) => ({ ...prev, rail, error: null }))
          }
          onClose={() =>
            setState((prev) => ({
              ...prev,
              detailOpen: false,
            }))
          }
          onPay={() => void authorizePurchaseSingle()}
        />

        <CartPayModal
          open={state.cartCheckoutOpen}
          lines={state.cart.map((p) => ({
            ...p,
            quantity: Math.max(1, state.cartQty[p.id] || 1),
          }))}
          rail={state.rail}
          busy={state.busy}
          acceptRlusd={state.cart.every((p) => p.acceptRlusd !== false)}
          acceptXrp={state.cart.every((p) => p.acceptXrp !== false)}
          acceptMastercard={state.cart.every(
            (p) => p.acceptMastercard !== false,
          )}
          onRailChange={(rail) =>
            setState((prev) => ({ ...prev, rail, error: null }))
          }
          onClose={() =>
            setState((prev) => ({ ...prev, cartCheckoutOpen: false }))
          }
          onPay={() => void authorizeCart()}
        />

        {(state.rail === "stablecoin" || state.rail === "xrp") &&
        (state.phase === "settle" || state.phase === "done") ? (
          <ProtocolLog className="max-h-32 shrink-0 overflow-auto" />
        ) : null}
      </main>
    </div>
  );
}
