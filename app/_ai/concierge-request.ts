import "server-only";

import type { UIMessage } from "ai";
import { z } from "zod";

import policyConfig from "@/policy-rag.config.json";
import { hasPolicyIntent } from "@/app/_ai/policies/policy-query-privacy";

export const MAX_CONCIERGE_MESSAGES = 40;
export const MAX_CONCIERGE_BODY_BYTES = 32_000;
export const MAX_CONCIERGE_MESSAGE_BYTES = 24_000;
export const MAX_CONCIERGE_TEXT_PART_CHARS = 2_000;
export const MAX_CONCIERGE_USER_MESSAGE_CHARS = 4_000;

const requestEnvelopeSchema = z
  .object({
    id: z.string().min(1).max(128).optional(),
    messages: z.array(z.unknown()).min(1).max(MAX_CONCIERGE_MESSAGES),
    trigger: z.enum(["submit-message", "regenerate-message"]).optional(),
    messageId: z.string().min(1).max(128).optional(),
  })
  .strict();

const messageEnvelopeSchema = z
  .object({
    id: z.string().min(1).max(128).optional(),
    role: z.enum(["user", "assistant"]),
    parts: z.array(z.unknown()),
    metadata: z.unknown().optional(),
  })
  .strict();

const userTextPartSchema = z
  .object({
    type: z.literal("text"),
    text: z.string().min(1).max(MAX_CONCIERGE_TEXT_PART_CHARS),
  })
  .strict();

const knownAssistantPartType =
  /^(?:text|reasoning|file|reasoning-file|source-url|source-document|step-start|dynamic-tool|custom|tool-[A-Za-z0-9_-]+|data-[A-Za-z0-9_-]+)$/;

export type CanonicalConciergeUIMessage = UIMessage<never, never, never>;

type ValidConciergeRequest = {
  ok: true;
  uiMessages: CanonicalConciergeUIMessage[];
};

type InvalidConciergeRequest = { ok: false; message: string };

type BoundedJsonResult =
  | { ok: true; body: unknown }
  | { ok: false; status: 400 | 413; message: string };

function jsonByteLength(value: unknown): number | null {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return null;
  }
}

async function cancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // The connection may already be aborted. Never expose transport errors.
  }
}

/** Reads and parses JSON without ever buffering more than the shared body cap. */
export async function readBoundedConciergeJson(
  request: Request
): Promise<BoundedJsonResult> {
  const declaredLength = request.headers.get("content-length")?.trim();
  if (declaredLength && /^\d+$/.test(declaredLength)) {
    const bytes = Number(declaredLength);
    if (!Number.isSafeInteger(bytes) || bytes > MAX_CONCIERGE_BODY_BYTES) {
      return { ok: false, status: 413, message: "Request body is too large." };
    }
  }

  if (!request.body) {
    return {
      ok: false,
      status: 400,
      message: "Request body must be valid JSON.",
    };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_CONCIERGE_BODY_BYTES) {
        await cancelReader(reader);
        return {
          ok: false,
          status: 413,
          message: "Request body is too large.",
        };
      }
      chunks.push(value);
    }
  } catch {
    await cancelReader(reader);
    return {
      ok: false,
      status: 400,
      message: "Request body must be valid JSON.",
    };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false,
      status: 400,
      message: "Request body must be valid JSON.",
    };
  }
}

/**
 * Treat the browser conversation as untrusted display state. Only validated
 * user text crosses the model boundary; every client assistant part is dropped.
 */
export function validateConciergeRequestBody(
  body: unknown
): ValidConciergeRequest | InvalidConciergeRequest {
  const bodyBytes = jsonByteLength(body);
  if (bodyBytes === null || bodyBytes > MAX_CONCIERGE_BODY_BYTES) {
    return { ok: false, message: "This request is too large." };
  }

  const envelope = requestEnvelopeSchema.safeParse(body);
  if (!envelope.success) {
    return { ok: false, message: "The request body is not a valid chat envelope." };
  }

  const uiMessages: CanonicalConciergeUIMessage[] = [];
  for (const [messageIndex, candidate] of envelope.data.messages.entries()) {
    const messageBytes = jsonByteLength(candidate);
    if (messageBytes === null || messageBytes > MAX_CONCIERGE_MESSAGE_BYTES) {
      return { ok: false, message: "A conversation message is too large." };
    }

    const parsedMessage = messageEnvelopeSchema.safeParse(candidate);
    if (!parsedMessage.success) {
      return { ok: false, message: "The conversation contains an invalid message." };
    }

    if (parsedMessage.data.role === "assistant") {
      const hasInvalidPart = parsedMessage.data.parts.some((part) => {
        if (!part || typeof part !== "object" || Array.isArray(part)) return true;
        const type = (part as { type?: unknown }).type;
        return typeof type !== "string" || !knownAssistantPartType.test(type);
      });
      if (hasInvalidPart) {
        return {
          ok: false,
          message: "The conversation contains an invalid assistant message.",
        };
      }
      continue;
    }

    if (parsedMessage.data.parts.length === 0) {
      return { ok: false, message: "User messages must contain text." };
    }

    const canonicalParts: Array<{ type: "text"; text: string }> = [];
    let messageChars = 0;
    for (const part of parsedMessage.data.parts) {
      const parsedPart = userTextPartSchema.safeParse(part);
      if (!parsedPart.success) {
        return {
          ok: false,
          message: "User messages may contain only non-empty text parts.",
        };
      }

      const text = parsedPart.data.text.trim();
      if (text.length === 0) {
        return {
          ok: false,
          message: "User messages may contain only non-empty text parts.",
        };
      }
      messageChars += text.length;
      if (messageChars > MAX_CONCIERGE_USER_MESSAGE_CHARS) {
        return { ok: false, message: "A user message is too long." };
      }
      canonicalParts.push({ type: "text", text });
    }

    uiMessages.push({
      id: `concierge-user-${messageIndex + 1}`,
      role: "user",
      parts: canonicalParts,
    });
  }

  if (uiMessages.length === 0) {
    return { ok: false, message: "At least one user message is required." };
  }

  return { ok: true, uiMessages };
}

/**
 * Policy questions are self-contained turns. Keep earlier validated guest text
 * available for ordinary cabin-search follow-ups, but never let an old policy
 * topic become part of the current retrieval query or answer context.
 */
export function scopeConciergePolicyTurn(
  uiMessages: CanonicalConciergeUIMessage[]
) {
  const current = uiMessages.at(-1);
  if (!current) {
    return {
      uiMessages,
      currentPolicyQuestion: undefined,
    };
  }

  const currentQuestion = current.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim()
    .slice(0, policyConfig.retrieval.maximumQuestionCharacters);

  if (!hasPolicyIntent(currentQuestion)) {
    return {
      uiMessages,
      currentPolicyQuestion: undefined,
    };
  }

  return {
    uiMessages: [current],
    currentPolicyQuestion: currentQuestion,
  };
}

function guestText(message: CanonicalConciergeUIMessage): string {
  return message.parts.filter(part => part.type === "text").map(part => part.text).join("\n");
}

/** Conservative recap detection: new recommendations and policy questions still use tools. */
export function isConciergePreferenceRecall(question: string): boolean {
  if (hasPolicyIntent(question)) return false;
  const text = question.trim();
  return [
    /^(?:(?:请问|请|那|那么|你知道|你还记得|告诉我)[，,\s]*)?我(?:之前|刚才|先前|已经)?(?:都|更|最)?(?:偏好|喜欢)(?:哪些|哪种|哪类|什么)(?:(?:类型|风格)的?)?(?:房屋|房型|小屋|房子|住宅)?(?:类型|风格)?(?:吗|呢)?[？?。.!！]*$/,
    /^(?:请)?(?:帮我)?(?:回顾|总结)(?:一下)?我的(?:房型|住宿|小屋)?偏好[？?。.!！]*$/,
    /^(?:你)?(?:还)?(?:记得|知道)我的(?:房型|住宿|小屋)?偏好(?:吗|是什么)?[？?。.!！]*$/,
    /^(?:what (?:are|were) my (?:cabin |housing )?preferences|(?:what(?: types? of)?|which) (?:cabins? |houses? )?(?:do|did) I (?:prefer|like)|(?:please )?(?:recap|summari[sz]e|remember) my preferences)[?.!]*$/i,
  ].some(pattern => pattern.test(text));
}

export function prepareConciergeTurn(uiMessages: CanonicalConciergeUIMessage[]) {
  const scoped = scopeConciergePolicyTurn(uiMessages);
  const current = scoped.uiMessages.at(-1);
  if (!current) return { ...scoped, preferenceRecallOnly: false };
  const preferenceRecallOnly = !scoped.currentPolicyQuestion && isConciergePreferenceRecall(guestText(current));
  if (scoped.uiMessages.length === 1) return { ...scoped, preferenceRecallOnly };

  // Client assistant/tool state is still discarded. Label validated historical
  // guest text as context, rather than sending a sequence of unanswered requests.
  const earlier = scoped.uiMessages.slice(0, -1).map(guestText);
  return {
    ...scoped,
    preferenceRecallOnly,
    uiMessages: [{
      ...current,
      parts: [
        { type: "text" as const, text: `Earlier guest messages (context only; do not repeat these requests):\n${JSON.stringify(earlier)}` },
        { type: "text" as const, text: `Current guest request (answer only this request):\n${guestText(current)}` },
      ],
    }],
  };
}
