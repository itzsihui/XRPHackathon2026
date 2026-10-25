"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { ProtocolEvent } from "@/lib/store/types";

export function ProtocolLog({ className }: { className?: string }) {
  const [events, setEvents] = useState<ProtocolEvent[]>([]);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onmessage = (message) => {
      const payload = JSON.parse(message.data) as
        | { type: "snapshot"; events: ProtocolEvent[] }
        | { type: "event"; event: ProtocolEvent };
      if (payload.type === "snapshot") setEvents(payload.events);
      if (payload.type === "event") {
        setEvents((prev) => [...prev.slice(-120), payload.event]);
      }
    };
    return () => source.close();
  }, []);

  useEffect(() => {
    if (scroller.current) {
      scroller.current.scrollTop = scroller.current.scrollHeight;
    }
  }, [events]);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900",
        className,
      )}
    >
      <div className="flex items-center gap-2 bg-neutral-800 px-4 py-3">
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-full bg-red-500" />
          <div className="h-3 w-3 rounded-full bg-yellow-500" />
          <div className="h-3 w-3 rounded-full bg-green-500" />
        </div>
        <div className="flex-1 text-center">
          <span className="text-xs text-neutral-400">
            borneo — x402 + Mastercard
          </span>
        </div>
        <div className="w-[52px]" />
      </div>
      <div
        ref={scroller}
        className="h-80 overflow-y-auto p-4 font-mono text-xs leading-relaxed"
      >
        {events.length === 0 ? (
          <p className="text-neutral-500">waiting for agent traffic…</p>
        ) : (
          events.map((event) => (
            <p
              key={`${event.ts}-${event.path}-${event.message}`}
              className={cn(
                "whitespace-pre-wrap",
                // x402 / cardapi: HTTP 402 is the payment challenge — success path, not an error
                event.status === 402 && "text-amber-300",
                event.status === 200 && "text-emerald-400",
                event.status >= 400 &&
                  event.status !== 402 &&
                  "text-red-400",
                event.status < 400 &&
                  event.status !== 200 &&
                  "text-neutral-400",
              )}
            >
              {new Date(event.ts).toISOString().slice(11, 23)} {event.method}{" "}
              {event.path} → {event.status} {event.message}
            </p>
          ))
        )}
      </div>
    </div>
  );
}
