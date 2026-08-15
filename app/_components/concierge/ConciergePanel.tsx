"use client";

import { useChat, type UseChatHelpers } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRouter } from "next/navigation";
import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { ConciergeAgentUIMessage } from "@/app/_ai/agents/concierge-agent";
import type { CabinRecommendation } from "@/app/_ai/schemas/concierge";
import { useReservation } from "@/app/_components/ReservationContext";
import CabinComparison from "./CabinComparison";
import CabinRecommendationCard from "./CabinRecommendationCard";
import ToolStatus from "./ToolStatus";

const conciergeTransport = new DefaultChatTransport({
  api: "/api/ai/concierge",
});

const suggestions = [
  "A family of four, next weekend for three nights, under $1,200",
  "Two guests for a quiet four-night stay next month",
];

const focusableSelector = [
  "a[href]",
  "button:not([disabled]):not([tabindex='-1'])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export type ConciergeChatAdapter = Pick<
  UseChatHelpers<ConciergeAgentUIMessage>,
  | "messages"
  | "sendMessage"
  | "status"
  | "stop"
  | "regenerate"
  | "error"
  | "clearError"
>;

type ConciergePanelProps = {
  chatAdapter?: ConciergeChatAdapter;
};

export default function ConciergePanel({ chatAdapter }: ConciergePanelProps = {}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [wasCancelled, setWasCancelled] = useState(false);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { adoptDraft } = useReservation();
  const liveChat = useChat<ConciergeAgentUIMessage>({
    id: "wild-oasis-concierge",
    transport: conciergeTransport,
  });
  const {
    messages,
    sendMessage,
    status,
    stop,
    regenerate,
    error,
    clearError,
  } = chatAdapter ?? liveChat;

  const busy = status === "submitted" || status === "streaming";

  const closePanel = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => launcherRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePanel();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []
      );
      if (focusable.length === 0) {
        event.preventDefault();
        closeRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, closePanel]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({
      behavior: "smooth",
      block: "end",
    });
  }, [messages, status]);

  const submitText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      clearError();
      setWasCancelled(false);
      void sendMessage({ text: trimmed });
      setInput("");
    },
    [busy, clearError, sendMessage]
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitText(input);
  }

  function handleAdopt(cabin: CabinRecommendation) {
    adoptDraft({
      cabinId: cabin.cabinId,
      startDate: cabin.startDate,
      endDate: cabin.endDate,
      numGuests: cabin.numGuests,
    });
    closePanel();
    router.push(`/cabins/${cabin.cabinId}#reservation`);
  }

  async function handleStop() {
    await stop();
    setWasCancelled(true);
  }

  function handleRetry() {
    clearError();
    setWasCancelled(false);
    void regenerate();
  }

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-accent-500 px-5 py-3 font-semibold text-primary-950 shadow-2xl transition hover:bg-accent-400 focus:outline-none focus:ring-2 focus:ring-accent-300 focus:ring-offset-2 focus:ring-offset-primary-950"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="ai-concierge-panel"
      >
        <span aria-hidden="true">✦</span>
        Ask AI concierge
      </button>

      {open ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            tabIndex={-1}
            className="absolute inset-0 h-full w-full bg-black/60"
            aria-label="Close AI concierge"
            onClick={closePanel}
          />
          <section
            ref={dialogRef}
            id="ai-concierge-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-concierge-title"
            className="absolute inset-x-0 bottom-0 flex max-h-[88vh] flex-col rounded-t-2xl border border-primary-700 bg-primary-950 shadow-2xl md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[30rem] md:rounded-none md:rounded-l-2xl"
          >
            <header className="flex items-start justify-between border-b border-primary-800 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-400">
                  Live inventory assistant
                </p>
                <h2 id="ai-concierge-title" className="text-2xl font-semibold">
                  AI Concierge
                </h2>
                <p className="mt-1 text-xs text-primary-400">
                  Recommendations only. You review and submit every reservation.
                </p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={closePanel}
                className="rounded p-2 text-2xl text-primary-300 hover:bg-primary-800 hover:text-primary-50 focus:outline-none focus:ring-2 focus:ring-accent-400"
                aria-label="Close AI concierge"
              >
                ×
              </button>
            </header>

            <div
              className="flex-1 space-y-4 overflow-y-auto px-4 py-5"
              aria-live="polite"
              aria-busy={busy}
            >
              {messages.length === 0 ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-primary-800 bg-primary-900 p-4 text-sm text-primary-200">
                    Tell me your dates, number of guests, total budget, and preferences. I will check current cabins and trusted prices.
                  </div>
                  <div className="space-y-2">
                    {suggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => submitText(suggestion)}
                        className="w-full rounded-lg border border-primary-700 px-3 py-2 text-left text-sm text-primary-200 hover:border-accent-500 hover:text-accent-300 focus:outline-none focus:ring-2 focus:ring-accent-400"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {messages.map((message) => (
                <div
                  key={message.id}
                  className={message.role === "user" ? "ml-8" : "mr-2"}
                >
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary-500">
                    {message.role === "user" ? "You" : "Concierge"}
                  </p>
                  <div className="space-y-3">
                    {message.parts.map((part, index) => {
                      const key = `${message.id}-${index}`;
                      switch (part.type) {
                        case "text":
                          return (
                            <p
                              key={key}
                              className={`whitespace-pre-wrap rounded-lg px-4 py-3 text-sm leading-6 ${
                                message.role === "user"
                                  ? "bg-accent-500 text-primary-950"
                                  : "border border-primary-800 bg-primary-900 text-primary-100"
                              }`}
                            >
                              {part.text}
                            </p>
                          );
                        case "tool-searchAvailableCabins":
                          if (part.state === "output-available") {
                            return (
                              <div key={part.toolCallId} className="space-y-3">
                                <ToolStatus label="Availability" state={part.state} />
                                {part.output.recommendations.length ? (
                                  part.output.recommendations.map((cabin) => (
                                    <CabinRecommendationCard
                                      key={cabin.cabinId}
                                      cabin={cabin}
                                      onAdopt={handleAdopt}
                                    />
                                  ))
                                ) : (
                                  <div className="rounded-md border border-amber-500/50 bg-amber-950/30 p-4 text-sm text-amber-100">
                                    No cabins match those dates and party size. Try different dates or fewer guests.
                                  </div>
                                )}
                              </div>
                            );
                          }
                          return (
                            <ToolStatus
                              key={part.toolCallId}
                              label="Availability"
                              state={part.state}
                              errorText={part.state === "output-error" ? part.errorText : undefined}
                            />
                          );
                        case "tool-getCabinDetails":
                          if (part.state === "output-available") {
                            return (
                              <div key={part.toolCallId} className="space-y-3">
                                <ToolStatus label="Cabin details" state={part.state} />
                                {part.output.cabin ? (
                                  <>
                                    <CabinRecommendationCard
                                      cabin={part.output.cabin}
                                      onAdopt={handleAdopt}
                                      compact
                                      allowAdopt={part.output.available === true}
                                    />
                                    {part.output.available === null ? (
                                      <p className="rounded-md border border-primary-700 bg-primary-900 p-3 text-sm text-primary-300">
                                        Add check-in and checkout dates to verify live availability before adopting this cabin.
                                      </p>
                                    ) : part.output.available === false ? (
                                      <p className="rounded-md border border-amber-500/50 p-3 text-sm text-amber-100">
                                        This cabin is not available for the requested stay or party size.
                                      </p>
                                    ) : null}
                                  </>
                                ) : (
                                  <p className="rounded-md border border-amber-500/50 p-3 text-sm text-amber-100">
                                    That cabin could not be found.
                                  </p>
                                )}
                              </div>
                            );
                          }
                          return (
                            <ToolStatus
                              key={part.toolCallId}
                              label="Cabin details"
                              state={part.state}
                              errorText={part.state === "output-error" ? part.errorText : undefined}
                            />
                          );
                        case "tool-compareCabins":
                          if (part.state === "output-available") {
                            return (
                              <div key={part.toolCallId} className="space-y-3">
                                <ToolStatus label="Comparison" state={part.state} />
                                <CabinComparison
                                  comparison={part.output}
                                  onAdopt={handleAdopt}
                                />
                              </div>
                            );
                          }
                          return (
                            <ToolStatus
                              key={part.toolCallId}
                              label="Comparison"
                              state={part.state}
                              errorText={part.state === "output-error" ? part.errorText : undefined}
                            />
                          );
                        case "tool-getHotelPolicy":
                          if (part.state === "output-available") {
                            return (
                              <div
                                key={part.toolCallId}
                                className="rounded-lg border border-primary-700 bg-primary-900 p-4 text-sm"
                              >
                                <h3 className="mb-2 font-semibold text-accent-300">Hotel policy</h3>
                                <ul className="space-y-1 text-primary-200">
                                  {part.output.facts.map((fact) => (
                                    <li key={fact}>• {fact}</li>
                                  ))}
                                </ul>
                                <p className="mt-2 text-[11px] text-primary-500">
                                  Sources: {part.output.sourceIds.join(" · ")}
                                </p>
                              </div>
                            );
                          }
                          return (
                            <ToolStatus
                              key={part.toolCallId}
                              label="Hotel policy"
                              state={part.state}
                              errorText={part.state === "output-error" ? part.errorText : undefined}
                            />
                          );
                        default:
                          return null;
                      }
                    })}
                  </div>
                </div>
              ))}

              {busy ? (
                <p className="text-sm text-primary-400" role="status">
                  Concierge is working…
                </p>
              ) : null}
              {wasCancelled ? (
                <div className="rounded-md border border-primary-700 bg-primary-900 p-3 text-sm text-primary-300">
                  Response cancelled. You can edit your request and try again.
                </div>
              ) : null}
              {error ? (
                <div className="rounded-md border border-red-400/50 bg-red-950/40 p-3 text-sm text-red-100" role="alert">
                  <p>
                    The concierge could not finish that request. Check your connection and try again.
                  </p>
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="mt-2 rounded bg-red-100 px-3 py-1.5 font-semibold text-red-950 focus:outline-none focus:ring-2 focus:ring-white"
                  >
                    Retry last request
                  </button>
                </div>
              ) : null}
              <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSubmit} className="border-t border-primary-800 p-4">
              <label htmlFor="concierge-input" className="sr-only">
                Message the AI concierge
              </label>
              <textarea
                id="concierge-input"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submitText(input);
                  }
                }}
                rows={3}
                maxLength={2_000}
                placeholder="Dates, guests, total budget, preferences…"
                className="w-full resize-none rounded-lg border border-primary-700 bg-primary-900 px-3 py-2 text-sm text-primary-50 placeholder:text-primary-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <p className="text-xs text-primary-500">Enter to send · Shift+Enter for a new line</p>
                {busy ? (
                  <button
                    type="button"
                    onClick={() => void handleStop()}
                    className="rounded-md border border-primary-500 px-4 py-2 text-sm font-semibold hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-accent-400"
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!input.trim()}
                    className="rounded-md bg-accent-500 px-4 py-2 text-sm font-semibold text-primary-950 hover:bg-accent-400 focus:outline-none focus:ring-2 focus:ring-accent-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Send
                  </button>
                )}
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
