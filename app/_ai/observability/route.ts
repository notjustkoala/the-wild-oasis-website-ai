import "server-only";
import { createHash } from "node:crypto";
import { createRunObserver, type ErrorCode, type Surface, type RunStatus } from "./run";
import { enforceRateLimit, traceHeaders } from "./access";
import { resolveConciergeProviderConfiguration } from "@/app/_ai/providers/concierge-model";
import { resolveOperationsProviderConfiguration } from "@/app/_ai/providers/operations-model";
import { generationOptions } from "@/app/_ai/providers/generation-options";

export function observedRoute(surface: Surface, instructions: string, headers = new Headers()) {
  let model = "unconfigured", provider: string | undefined;
  try { const config = surface === "operations" ? resolveOperationsProviderConfiguration() : resolveConciergeProviderConfiguration(); model = config.modelId; provider = config.provider; } catch { /* safe metadata only */ }
  let settings: ReturnType<typeof generationOptions> = {};
  try { settings = generationOptions(surface); } catch { /* agent config validation handles the failure */ }
  const run = createRunObserver({ surface, model, provider, reasoningEffort: settings.providerOptions?.openai.reasoningEffort, serviceTier: settings.providerOptions?.openai.serviceTier, promptVersion: `${surface}-${createHash("sha256").update(instructions + JSON.stringify(settings)).digest("hex").slice(0, 12)}` });
  traceHeaders(run.traceId, surface).forEach((value, key) => headers.set(key, value));
  const json = (body: object, status = 200) => Response.json({ ...body, traceId: run.traceId }, { status, headers });
  async function fail(error: string, status: number, code: ErrorCode, state: RunStatus = "failed") { headers.delete("X-AI-Feedback-Token"); await run.finish(state, code); return json({ error }, status); }
  return {
    run, headers, json, fail,
    async limit(actorId?: string) {
      const result = await enforceRateLimit(surface, actorId);
      if (result.ok) return null;
      if (result.retryAfter) headers.set("Retry-After", String(result.retryAfter));
      return fail(result.status === 429 ? "Too many AI requests. Please wait or continue without AI." : "AI is temporarily unavailable. Please continue with the standard booking tools.", result.status, result.status === 429 ? "rate-limited" : "store-unavailable", result.status === 429 ? "rate-limited" : "failed");
    },
  };
}
