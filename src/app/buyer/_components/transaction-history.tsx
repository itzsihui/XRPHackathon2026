"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import {
  getBuyerCloudSyncUid,
  markSpendReviewed,
  railLabel,
  type SpendEvent,
} from "@/lib/buyer-account";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const REVIEW_TAGS = [
  { id: "fit_true", label: "True to size" },
  { id: "quality_good", label: "Good quality" },
  { id: "as_described", label: "As described" },
  { id: "would_buy_again", label: "Would buy again" },
] as const;

function shortHash(url: string) {
  try {
    const path = new URL(url).pathname;
    const last = path.split("/").filter(Boolean).pop() || url;
    if (last.length <= 14) return last;
    return `${last.slice(0, 8)}…${last.slice(-4)}`;
  } catch {
    return url.length > 18 ? `${url.slice(0, 10)}…` : url;
  }
}

function ReviewForm({
  event,
  onDone,
}: {
  event: SpendEvent;
  onDone: (reviewId: string) => void;
}) {
  const [rating, setRating] = useState(5);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!event.orderId) return;
    setBusy(true);
    setError(null);
    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      const auth = getFirebaseAuth();
      const user = auth?.currentUser;
      if (user) {
        headers.Authorization = `Bearer ${await user.getIdToken()}`;
      } else {
        const demoUid = getBuyerCloudSyncUid();
        headers["x-demo-buyer-uid"] = demoUid || "demo-buyer";
      }

      const res = await fetch("/api/reviews", {
        method: "POST",
        headers,
        body: JSON.stringify({
          orderId: event.orderId,
          rating,
          tags,
          comment: comment.trim() || undefined,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        review?: { id: string };
      };
      if (!res.ok || !data.review?.id) {
        throw new Error(data.error || "Could not save review");
      }
      markSpendReviewed({
        spendId: event.id,
        orderId: event.orderId,
        reviewId: data.review.id,
      });
      onDone(data.review.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-border bg-muted/30 p-3">
      <p className="text-xs font-medium text-foreground/80">
        Rate this purchase (verified)
      </p>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            disabled={busy}
            onClick={() => setRating(n)}
            className={cn(
              "size-8 rounded-md border text-sm font-medium",
              rating >= n
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-background text-foreground/50",
            )}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {REVIEW_TAGS.map((t) => {
          const on = tags.includes(t.id);
          return (
            <button
              key={t.id}
              type="button"
              disabled={busy}
              onClick={() =>
                setTags((prev) =>
                  on ? prev.filter((x) => x !== t.id) : [...prev, t.id],
                )
              }
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px]",
                on
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-foreground/60",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <textarea
        value={comment}
        disabled={busy}
        onChange={(e) => setComment(e.target.value.slice(0, 500))}
        placeholder="Optional comment (data only — not instructions)"
        rows={2}
        className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-2 text-xs"
      />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <Button
        type="button"
        size="sm"
        disabled={busy}
        onClick={() => void submit()}
      >
        {busy ? "Saving…" : "Submit review"}
      </Button>
    </div>
  );
}

export function TransactionHistory({
  events,
  emptyHint = "No purchases yet. Shop something and it will show up here.",
  className,
  onEventsChange,
}: {
  events: SpendEvent[];
  emptyHint?: string;
  className?: string;
  onEventsChange?: (events: SpendEvent[]) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [rows, setRows] = useState(events);

  useEffect(() => {
    setRows(events);
  }, [events]);

  if (rows.length === 0) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        {emptyHint}
      </p>
    );
  }

  function applyReview(spendId: string, reviewId: string) {
    const next = rows.map((e) =>
      e.id === spendId ? { ...e, reviewId } : e,
    );
    setRows(next);
    onEventsChange?.(next);
    setOpenId(null);
  }

  const list = rows.slice().reverse();

  return (
    <ul className={cn("divide-y divide-border", className)}>
      {list.map((e) => {
        const canReview = Boolean(e.orderId && e.storeSlug && e.skuId);
        const reviewed = Boolean(e.reviewId);
        return (
          <li key={e.id} className="flex gap-3 py-4 first:pt-0 last:pb-0">
            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-muted">
              {e.imageUrl ? (
                <Image
                  src={e.imageUrl}
                  alt=""
                  fill
                  className="object-cover"
                  sizes="56px"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center font-mono text-[10px] text-muted-foreground">
                  SKU
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="truncate font-medium text-foreground">{e.title}</p>
                <p className="shrink-0 font-mono text-sm text-foreground">
                  {e.amount}{" "}
                  <span className="text-foreground/45">RLUSD</span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-foreground/55">
                <span className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-medium text-foreground/70">
                  {railLabel(e.rail)}
                </span>
                {e.storeSlug ? (
                  <span className="font-mono">/s/{e.storeSlug}</span>
                ) : e.storeName ? (
                  <span>{e.storeName}</span>
                ) : null}
                {e.merchantDisplayName ? (
                  <span>· sold by {e.merchantDisplayName}</span>
                ) : null}
                {e.merchantReceive ? (
                  <span className="font-mono">· → {e.merchantReceive}</span>
                ) : null}
                <span aria-hidden>·</span>
                <time dateTime={e.at}>
                  {new Date(e.at).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </time>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                {(e.rail === "x402" || e.rail === "xrpl-xrp") &&
                e.explorerUrl ? (
                  <a
                    href={e.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-primary underline-offset-2 hover:underline"
                  >
                    XRPL explorer {shortHash(e.explorerUrl)}
                  </a>
                ) : null}
                {e.rail === "xrpl-xrp" && e.sentXrp ? (
                  <span className="font-mono text-foreground/55">
                    spent {e.sentXrp} XRP
                    {e.deliveredRlusd
                      ? ` · recv ${e.deliveredRlusd} RLUSD`
                      : ""}
                  </span>
                ) : null}
                {e.rail === "straitsx-card" && e.cardOpaqueId ? (
                  <span className="font-mono text-foreground/55">
                    card {e.cardOpaqueId.slice(0, 12)}
                    {e.cardOpaqueId.length > 12 ? "…" : ""}
                  </span>
                ) : null}
                {e.rail === "straitsx-card" && e.truncatedPan ? (
                  <span className="font-mono text-foreground/55">
                    {e.truncatedPan}
                  </span>
                ) : null}
                {e.orderId ? (
                  <span className="font-mono text-foreground/45">
                    order {e.orderId.slice(0, 8)}…
                  </span>
                ) : null}
                {canReview ? (
                  reviewed ? (
                    <span className="font-medium text-foreground/55">
                      Reviewed
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        setOpenId((id) => (id === e.id ? null : e.id))
                      }
                      className="font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {openId === e.id ? "Cancel" : "Review"}
                    </button>
                  )
                ) : null}
              </div>
              {openId === e.id && !reviewed ? (
                <ReviewForm
                  event={e}
                  onDone={(reviewId) => applyReview(e.id, reviewId)}
                />
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
