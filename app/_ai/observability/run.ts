import "server-only";
import { randomUUID } from "node:crypto";
import type { StreamTextTransform, ToolSet } from "ai";
import { createPrivilegedSupabaseClient } from "@/app/_lib/supabase-server";

export type Surface = "concierge" | "operations" | "booking-insight";
export type RunStatus = "completed" | "failed" | "cancelled" | "timeout" | "denied" | "rate-limited";
export type ErrorCode = "invalid-request" | "unauthorized" | "configuration" | "provider-unavailable" | "tool-error" | "timeout" | "cancelled" | "rate-limited" | "store-unavailable";
export type RunRecord = { trace_id: string; surface: Surface; status: RunStatus; error_code: ErrorCode | null; duration_ms: number; ttft_ms: number | null; input_tokens: number | null; output_tokens: number | null; tool_names: string[]; tool_error_count: number; model: string; prompt_version: string };
const toolNames = new Set(["searchAvailableCabins", "getCabinDetails", "compareCabins", "getHotelPolicy", "searchHotelPolicies", "getArrivals", "getBookingMetrics", "getCabinPerformance", "getBookingRisks", "getBookingDetails", "addBookingInternalNote"]);
const safeName = (value: string) => /^[a-zA-Z0-9._:/-]{1,96}$/.test(value) ? value : "unknown";
const tokens = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
export async function persistRun(record: RunRecord) {
  try {
    const client = createPrivilegedSupabaseClient();
    const { error } = await client.from("ai_runs").insert(record).abortSignal(AbortSignal.timeout(1_500));
    return !error;
  } catch { return false; }
}
export function createRunObserver(options: { surface: Surface; model?: string; promptVersion: string; now?: () => number; persist?: (record: RunRecord) => Promise<unknown>; traceId?: string }) {
  const now = options.now ?? Date.now, start = now();
  const traceId = options.traceId ?? randomUUID();
  const names = new Set<string>();
  let ttft: number | null = null, input: number | null = null, output: number | null = null, toolErrors = 0;
  let missingInput = false, missingOutput = false;
  let pending: { status: RunStatus; code: ErrorCode | null } | undefined;
  let completion: Promise<RunRecord> | undefined;
  const observer = {
    traceId,
    watch(signal?: AbortSignal) {
      const abort = () => { observer.mark("cancelled", "cancelled"); void observer.finish(); };
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
      return () => signal?.removeEventListener("abort", abort);
    },
    step(event: { toolCalls?: Array<{ toolName: string }>; content?: Array<{ type: string }>; usage?: { inputTokens?: number; outputTokens?: number } }) {
      for (const call of event.toolCalls ?? []) if (toolNames.has(call.toolName)) names.add(call.toolName);
      toolErrors += event.content?.filter(part => part.type === "tool-error").length ?? 0;
      if (tokens(event.usage?.inputTokens) === null) missingInput = true;
      if (tokens(event.usage?.outputTokens) === null) missingOutput = true;
      input = missingInput ? null : (input ?? 0) + event.usage!.inputTokens!;
      output = missingOutput ? null : (output ?? 0) + event.usage!.outputTokens!;
    },
    firstText() { if (ttft === null) ttft = Math.max(0, now() - start); },
    mark(status: RunStatus, code: ErrorCode | null) { if (!pending || pending.status === "completed") pending = { status, code }; },
    finish(status: RunStatus = "completed", code: ErrorCode | null = null) {
      if (completion) return completion;
      const final = pending ?? (status !== "completed" || code !== null ? { status, code } : toolErrors ? { status: "failed" as const, code: "tool-error" as const } : { status, code });
      // An interrupted model step may never emit usage. Do not price a partial total.
      if (final.status === "cancelled" || final.status === "timeout" || final.code === "provider-unavailable") { input = null; output = null; }
      const record: RunRecord = { trace_id: traceId, surface: options.surface, status: final.status, error_code: final.code, duration_ms: Math.max(0, now() - start), ttft_ms: ttft, input_tokens: input, output_tokens: output, tool_names: [...names].sort(), tool_error_count: toolErrors, model: safeName(options.model ?? "configured-model"), prompt_version: safeName(options.promptVersion) };
      completion = (async () => { let timer: ReturnType<typeof setTimeout> | undefined; try { await Promise.race([(options.persist ?? persistRun)(record), new Promise(resolve => { timer = setTimeout(resolve, 1_600); })]); } catch { /* telemetry must never replace a response */ } finally { if (timer) clearTimeout(timer); } return record; })();
      return completion;
    },
    transform<TOOLS extends ToolSet>(signal: AbortSignal): StreamTextTransform<TOOLS> {
      return () => new TransformStream({
        transform(chunk, controller) {
          if (chunk.type === "text-delta" && chunk.text) observer.firstText();
          if (chunk.type === "error") observer.mark("failed", "provider-unavailable");
          if (chunk.type === "abort") observer.mark(signal.aborted ? "cancelled" : "timeout", signal.aborted ? "cancelled" : "timeout");
          controller.enqueue(chunk);
        },
        async flush() { await observer.finish(); },
      });
    },
  };
  return observer;
}
export type RunObserver = ReturnType<typeof createRunObserver>;
