import { convertToModelMessages, createAgentUIStreamResponse } from "ai";

import { createOperationsAgent } from "@/app/_ai/agents/operations-agent";
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
  if (!cors.ok) return json({ error: "Origin is not allowed." }, 403, cors.headers);
  const authorization = await authorizeOperationsStaff(request);
  if (!authorization.ok) return json({ error: authorization.message }, authorization.status, cors.headers);
  const referenceDate = new Date();
  const parsed = await readOperationsRequest(request, referenceDate);
  if (!parsed.ok) return json({ error: parsed.message }, parsed.status, cors.headers);
  if (getConciergeProviderConfigurationError()) {
    return json({ error: "The operations copilot is not configured." }, 503, cors.headers);
  }
  try {
    const agent = createOperationsAgent({
      client: authorization.client,
      actorId: authorization.user.id,
      referenceDate,
    });
    if (request.headers.get("accept")?.includes("application/json")) {
      const modelMessages = await convertToModelMessages(parsed.uiMessages, {
        tools: agent.tools,
        ignoreIncompleteToolCalls: true,
      });
      const result = await agent.generate({
        messages: modelMessages,
        abortSignal: request.signal,
        timeout: { totalMs: 90_000 },
      });
      return json({
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
      timeout: { totalMs: 90_000 },
      onError: () => "The operations copilot could not complete this request.",
    });
    response.headers.forEach((value, key) => cors.headers.set(key, value));
    cors.headers.set("Cache-Control", "no-store");
    return new Response(response.body, { status: response.status, headers: cors.headers });
  } catch {
    return json({ error: "The operations copilot is temporarily unavailable." }, 503, cors.headers);
  }
}

export function OPTIONS(request: Request) {
  const cors = operationsCors(request);
  return cors.ok
    ? new Response(null, { status: 204, headers: cors.headers })
    : json({ error: "Origin is not allowed." }, 403, cors.headers);
}
