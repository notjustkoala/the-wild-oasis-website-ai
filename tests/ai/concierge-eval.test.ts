import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";

import {
  CONCIERGE_INSTRUCTIONS,
  createConciergeAgent,
} from "@/app/_ai/agents/concierge-agent";
import type { PolicySearchResult } from "@/app/_ai/policies/policy-types";

import "./concierge.eval";

describe("concierge policy grounding contract", () => {
  it("requires policy retrieval, explicit insufficiency, direct citations, and live breakfast pricing", () => {
    expect(CONCIERGE_INSTRUCTIONS).toMatch(/every question about hotel policy[\s\S]*call searchHotelPolicies/i);
    expect(CONCIERGE_INSTRUCTIONS).toMatch(/insufficient-evidence[\s\S]*do not infer or complete a policy from memory/i);
    expect(CONCIERGE_INSTRUCTIONS).toMatch(/citation cards are rendered directly from trusted tool output/i);
    expect(CONCIERGE_INSTRUCTIONS).toMatch(/breakfast-price question needs both searchHotelPolicies[\s\S]*getHotelPolicy/i);
  });

  it("answers only the latest turn and forbids policy-search retries after insufficient evidence", () => {
    expect(CONCIERGE_INSTRUCTIONS).toMatch(
      /answer only the final user message[\s\S]*do not repeat or re-answer an earlier request/i
    );
    expect(CONCIERGE_INSTRUCTIONS).toMatch(
      /search each distinct policy topic[\s\S]*at most once/i
    );
    expect(CONCIERGE_INSTRUCTIONS).toMatch(
      /insufficient-evidence[\s\S]*do not call it again during the current response/i
    );
  });

  it("removes policy search after its first executed step while retaining live-data tools", async () => {
    const usage = {
      inputTokens: {
        total: 20,
        noCache: 20,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: { total: 10, text: 10, reasoning: undefined },
    };
    const availableToolNames = (options: LanguageModelV4CallOptions) =>
      (options.tools ?? []).map((candidate) => candidate.name);
    let policyCallCount = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async (options) => {
        const policyAvailable = availableToolNames(options).includes(
          "searchHotelPolicies"
        );
        if (policyAvailable) {
          policyCallCount += 1;
          return {
            content: [
              {
                type: "tool-call" as const,
                toolCallId: `policy-${policyCallCount}`,
                toolName: "searchHotelPolicies",
                input: JSON.stringify({ question: "入住前 3 天取消如何收费？" }),
              },
            ],
            finishReason: { unified: "tool-calls" as const, raw: undefined },
            usage,
            warnings: [],
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: "未找到可靠政策来源，请联系酒店团队确认。",
            },
          ],
          finishReason: { unified: "stop" as const, raw: undefined },
          usage,
          warnings: [],
        };
      },
    });
    const executePolicySearch = vi.fn(
      async (): Promise<PolicySearchResult> => ({
        kind: "policy-search",
        status: "insufficient-evidence",
        answerContext: "",
        citations: [],
        truncated: false,
      })
    );
    const policySearchTool = tool({
      description: "Search hotel policies.",
      inputSchema: z.object({ question: z.string() }),
      execute: executePolicySearch,
    });
    const agent = createConciergeAgent({
      model,
      policySearchTool,
      currentPolicyQuestion: "几点可以入住，几点退房？",
    });

    const result = await agent.generate({
      prompt: "几点可以入住，几点退房？",
    });

    expect(executePolicySearch).toHaveBeenCalledTimes(1);
    expect(executePolicySearch).toHaveBeenCalledWith(
      { question: "几点可以入住，几点退房？" },
      expect.anything()
    );
    expect(result.steps.flatMap((step) => step.toolCalls)).toHaveLength(1);
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(availableToolNames(model.doGenerateCalls[1])).not.toContain(
      "searchHotelPolicies"
    );
    expect(availableToolNames(model.doGenerateCalls[1])).toEqual(
      expect.arrayContaining([
        "searchAvailableCabins",
        "getCabinDetails",
        "compareCabins",
        "getHotelPolicy",
      ])
    );
  });
});
