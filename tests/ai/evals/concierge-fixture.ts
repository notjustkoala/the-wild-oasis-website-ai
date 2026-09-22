import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";

import {
  CONCIERGE_INSTRUCTIONS,
  createConciergeAgent,
} from "@/app/_ai/agents/concierge-agent";
import {
  createCabinTools,
  type ConciergeInventoryDataSource,
} from "@/app/_ai/tools/cabin-tools";






const wordNumbers: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
};

const usage = {
  inputTokens: {
    total: 20,
    noCache: 20,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 10, text: 10, reasoning: undefined },
};

function generatedText(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    finishReason: { unified: "stop" as const, raw: undefined },
    usage,
    warnings: [],
  };
}

function extractUserPrompt(options: LanguageModelV4CallOptions): string {
  return options.prompt
    .filter((message) => message.role === "user")
    .reverse()
    .flatMap((message) => message.content)
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function extractDates(prompt: string): [string, string] | null {
  const isoDates = prompt.match(/\d{4}-\d{2}-\d{2}/g);
  if (isoDates?.length && isoDates.length >= 2) {
    return [isoDates[0], isoDates[1]];
  }

  const chinese = /(\d{4})年(\d{1,2})月(\d{1,2})日?至(\d{1,2})日/.exec(
    prompt
  );
  if (!chinese) return null;
  const [, year, month, startDay, endDay] = chinese;
  const paddedMonth = month.padStart(2, "0");
  return [
    `${year}-${paddedMonth}-${startDay.padStart(2, "0")}`,
    `${year}-${paddedMonth}-${endDay.padStart(2, "0")}`,
  ];
}

function extractGuests(prompt: string): number | null {
  if (/一家四口/.test(prompt)) return 4;
  const numeric = /(\d+)\s*(?:guests?|adults?|people)/i.exec(prompt);
  if (numeric) return Number(numeric[1]);
  const forCount = /\bfor\s+(\d+)\s+from\b/i.exec(prompt);
  if (forCount) return Number(forCount[1]);
  const words = new RegExp(
    `\\b(${Object.keys(wordNumbers).join("|")})\\s+(?:guests?|adults?|people)\\b|family of (${Object.keys(wordNumbers).join("|")})`,
    "i"
  ).exec(prompt);
  const word = (words?.[1] || words?.[2])?.toLowerCase();
  return word ? wordNumbers[word] : null;
}

function extractBudget(prompt: string): number | undefined {
  const dollars = /\$([\d,]+)/.exec(prompt);
  if (dollars) return Number(dollars[1].replaceAll(",", ""));
  const chinese = /(\d+)\s*美元/.exec(prompt);
  return chinese ? Number(chinese[1]) : undefined;
}

function isInjection(prompt: string) {
  return /ignore all previous|system override|hidden system prompt|print AI_GATEWAY_API_KEY|pretend it is free|insert a reservation/i.test(
    prompt
  );
}

function isRecoveryRequest(prompt: string) {
  return /cancel the current AI response|tool timed out|Gateway is not configured|stopped generation/i.test(
    prompt
  );
}

function hasToolResult(options: LanguageModelV4CallOptions) {
  return options.prompt.some((message) => message.role === "tool");
}

/**
 * Deterministic stand-in for the remote model. It reads the actual user prompt
 * delivered by ToolLoopAgent and emits model-protocol text or a typed tool call.
 * It never reads evaluation categories or expectedAction.
 */
export function createPromptAwareModel() {
  return new MockLanguageModelV4({
    doGenerate: async (options) => {
      if (hasToolResult(options)) {
        return generatedText(
          "I checked current inventory. Review the structured cabin cards and confirm any reservation yourself."
        );
      }

      const prompt = extractUserPrompt(options);
      if (isInjection(prompt)) {
        return generatedText(
          "I cannot reveal private instructions or fabricate or mutate inventory. I can help with a read-only cabin search."
        );
      }
      if (isRecoveryRequest(prompt)) {
        return generatedText(
          "The response was stopped or unavailable. No booking changed; edit your request and retry when ready."
        );
      }

      const dates = extractDates(prompt);
      const numGuests = extractGuests(prompt);
      if (!dates || !numGuests) {
        return generatedText(
          "Please provide exact check-in and checkout dates plus the number of guests."
        );
      }

      const input = {
        startDate: dates[0],
        endDate: dates[1],
        numGuests,
        ...(extractBudget(prompt)
          ? { maxTotalPrice: extractBudget(prompt) }
          : {}),
        preferences: /gluten|无麸质/i.test(prompt)
          ? ["gluten-free breakfast"]
          : [],
      };
      return {
        content: [
          {
            type: "tool-call" as const,
            toolCallId: "availability-search-1",
            toolName: "searchAvailableCabins",
            input: JSON.stringify(input),
          },
        ],
        finishReason: { unified: "tool-calls" as const, raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
}

export function createEvaluationDataSource(): ConciergeInventoryDataSource {
  const cabins = [
    {
      id: 1,
      name: "Cabin 001",
      maxCapacity: 8,
      regularPrice: 300,
      discount: 50,
      image: "/icon.png",
      description: "A quiet family cabin.",
    },
    {
      id: 2,
      name: "Cabin 002",
      maxCapacity: 4,
      regularPrice: 180,
      discount: 20,
      image: "/icon.png",
      description: "A compact cabin.",
    },
  ];
  return {
    listCabins: async () => cabins,
    getCabins: async (ids) => cabins.filter((cabin) => ids.includes(cabin.id)),
    getCabin: async (id) => cabins.find((cabin) => cabin.id === id) ?? null,
    getSettings: async () => ({
      id: 1,
      minBookingLength: 2,
      maxBookingLength: 14,
      maxGuestsPerBooking: 10,
      breakfastPrice: 15,
    }),
    getConflictingCabinIds: async () => [],
  };
}
