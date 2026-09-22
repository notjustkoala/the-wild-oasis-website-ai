import { convertToModelMessages, createAgentUIStreamResponse } from "ai";

import { createOperationsAgent, OPERATIONS_INSTRUCTIONS } from "@/app/_ai/agents/operations-agent";
import { observedRoute } from "@/app/_ai/observability/route";
import { CONCIERGE_TIMEOUT, createConciergeAbortRecoveryTransform } from "@/app/_ai/concierge-stream";
import { authorizeOperationsStaff } from "@/app/_ai/operations-auth";
import { operationsCors } from "@/app/_ai/operations-cors";
import { readOperationsRequest } from "@/app/_ai/operations-request";
import { getConciergeProviderConfigurationError } from "@/app/_ai/providers/concierge-model";

export const dynamic = "force-dynamic";
export const maxDuration = 100;

function json(body: unknown, status: number, headers: Headers) {
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { status, headers });
}

export async function POST(request: Request) {
  const cors = operationsCors(request);
  const observation = observedRoute("operations", OPERATIONS_INSTRUCTIONS, cors.headers);
  const { run, fail } = observation;
  if (!cors.ok) return fail("Origin is not allowed.", 403, "unauthorized", "denied");
  let authorization;
  try { authorization = await authorizeOperationsStaff(request); }
  catch { return fail("The operations service is temporarily unavailable.", 503, "provider-unavailable"); }
  if (!authorization.ok) return fail(authorization.message, authorization.status, "unauthorized", "denied");
  const referenceDate = new Date();
  const parsed = await readOperationsRequest(request, referenceDate);
  if (!parsed.ok) return fail(parsed.message, parsed.status, "invalid-request", "denied");
  if (getConciergeProviderConfigurationError()) {
    return fail("The operations copilot is not configured.", 503, "configuration");
  }
  const limited = await observation.limit(authorization.user.id);
  if (limited) return limited;
  run.watch(request.signal);
  try {
    const agent = createOperationsAgent({
      client: authorization.client,
      actorId: authorization.user.id,
      referenceDate,
      currentPolicyQuestion: parsed.currentPolicyQuestion,
      observer: run,
    });
    if (request.headers.get("accept")?.includes("application/json")) {
      const modelMessages = await convertToModelMessages(parsed.uiMessages, {
        tools: agent.tools,
        ignoreIncompleteToolCalls: true,
      });
      const result = await agent.generate({
        messages: modelMessages,
        abortSignal: request.signal,
        timeout: CONCIERGE_TIMEOUT,
      });
      await run.finish(result.finishReason === "error" ? "failed" : "completed", result.finishReason === "error" ? "provider-unavailable" : null);
      return json({
        traceId: run.traceId,
        feedbackToken: cors.headers.get("X-AI-Feedback-Token"),
        text: result.text,
        steps: result.steps.map((step) => ({
          stepNumber: step.stepNumber,
          text: step.text,
          status: result.finishReason === "error"
            ? "failed"
            : step.toolCalls.length > step.toolResults.length
              ? "interrupted"
              : "completed",
          toolCalls: step.toolCalls.map((call) => ({
            toolName: call.toolName,
            input: call.input,
          })),
          toolResults: step.toolResults.map((toolResult) => ({
            toolName: toolResult.toolName,
            output: toolResult.output,
          })),
        })),
      }, 200, cors.headers);
    }
    const response = await createAgentUIStreamResponse({
      agent,
      uiMessages: parsed.uiMessages,
      abortSignal: request.signal,
      timeout: CONCIERGE_TIMEOUT,
      experimental_transform: [run.transform(request.signal), createConciergeAbortRecoveryTransform(request.signal)],
      onError: () => `The operations copilot could not complete this request. Reference: ${run.traceId}`,
    });
    response.headers.forEach((value, key) => cors.headers.set(key, value));
    cors.headers.set("Cache-Control", "no-store");
    return new Response(response.body, { status: response.status, headers: cors.headers });
  } catch (error) {
    const timeout = error instanceof Error && /timeout|abort/i.test(error.name);
    return fail("The operations copilot is temporarily unavailable. Continue with Bookings or Dashboard.", timeout ? 504 : 503, request.signal.aborted ? "cancelled" : timeout ? "timeout" : "provider-unavailable", request.signal.aborted ? "cancelled" : timeout ? "timeout" : "failed");
  }
}

export function OPTIONS(request: Request) {
  const cors = operationsCors(request);
  return cors.ok
    ? new Response(null, { status: 204, headers: cors.headers })
    : json({ error: "Origin is not allowed." }, 403, cors.headers);
}
