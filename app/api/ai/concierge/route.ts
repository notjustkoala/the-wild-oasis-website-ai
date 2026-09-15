import { createAgentUIStreamResponse } from "ai";

import { createConciergeAgent } from "@/app/_ai/agents/concierge-agent";
import {
  readBoundedConciergeJson,
  scopeConciergePolicyTurn,
  validateConciergeRequestBody,
} from "@/app/_ai/concierge-request";
import {
  CONCIERGE_RECOVERABLE_ERROR,
  CONCIERGE_TIMEOUT,
  createConciergeAbortRecoveryTransform,
} from "@/app/_ai/concierge-stream";
import { getConciergeProviderConfigurationError } from "@/app/_ai/providers/concierge-model";

export const dynamic = "force-dynamic";
export const maxDuration = 100;

export async function POST(request: Request) {
  const parsed = await readBoundedConciergeJson(request);
  if (!parsed.ok) {
    return Response.json(
      { error: parsed.message },
      { status: parsed.status }
    );
  }

  const validated = validateConciergeRequestBody(parsed.body);
  if (!validated.ok) {
    return Response.json({ error: validated.message }, { status: 400 });
  }

  if (getConciergeProviderConfigurationError()) {
    return Response.json(
      {
        error:
          "The AI concierge is not configured yet. Check its server-only provider settings and try again.",
      },
      { status: 503 }
    );
  }

  try {
    const turn = scopeConciergePolicyTurn(validated.uiMessages);
    const agent = createConciergeAgent({
      currentPolicyQuestion: turn.currentPolicyQuestion,
    });
    return await createAgentUIStreamResponse({
      agent,
      uiMessages: turn.uiMessages,
      abortSignal: request.signal,
      timeout: CONCIERGE_TIMEOUT,
      experimental_transform: createConciergeAbortRecoveryTransform(
        request.signal
      ),
      onError: () =>
        CONCIERGE_RECOVERABLE_ERROR,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json(
      { error: "The concierge is temporarily unavailable. Please try again." },
      { status: 503 }
    );
  }
}
