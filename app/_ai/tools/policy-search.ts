import "server-only";

import { tool } from "ai";

import policyConfig from "@/policy-rag.config.json";
import { embedPolicyQuery } from "@/app/_ai/providers/policy-embedding-model";
import { preparePolicyQuery } from "@/app/_ai/policies/policy-query-privacy";
import { needsStaffWaiverEvidence, STAFF_WAIVER_QUERY } from "@/app/_ai/policies/policy-search-plan";
import {
  matchPolicyChunks,
  type PolicyMatch,
  type PolicyRpcClient,
} from "@/app/_ai/policies/policy-repository";
import {
  policySearchInputSchema,
  type PolicyScope,
  type PolicySearchResult,
} from "@/app/_ai/policies/policy-types";

const INSUFFICIENT: PolicySearchResult = {
  kind: "policy-search",
  status: "insufficient-evidence",
  answerContext: "",
  citations: [],
  truncated: false,
};

export type PolicySearchDependencies = {
  client: PolicyRpcClient;
  allowedScopes?: readonly PolicyScope[];
  embedQuery?: (query: string) => Promise<number[]>;
  search?: (input: {
    client: PolicyRpcClient;
    queryText: string;
    embedding: number[];
  }) => Promise<PolicyMatch[]>;
};

export function createPolicySearchService({
  client,
  allowedScopes = ["public"],
  embedQuery = embedPolicyQuery,
  search = matchPolicyChunks,
}: PolicySearchDependencies) {
  const permitted = new Set<PolicyScope>(allowedScopes);
  return async function searchHotelPolicies({
    question,
  }: {
    question: string;
  }): Promise<PolicySearchResult> {
    const prepared = preparePolicyQuery(question, {
      allowStaffScope: permitted.has("staff"),
    });
    if (!prepared.searchable) return INSUFFICIENT;

    try {
      const needsWaiverSop = permitted.has("staff")
        && needsStaffWaiverEvidence(prepared.sanitized);
      const retrieve = async (queryText: string) => {
        const embedding = await embedQuery(queryText);
        if (
          embedding.length !== policyConfig.embedding.dimensions ||
          embedding.some((item) => !Number.isFinite(item))
        ) throw new Error("Policy evidence unavailable.");
        const matches = await search({ client, queryText, embedding });
        if (matches.some((match) => !permitted.has(match.citation.scope))) {
          throw new Error("Policy evidence unavailable.");
        }
        const bestSimilarity = Math.max(...matches.map((match) => match.semanticSimilarity));
        return matches.filter((match) =>
          match.semanticSimilarity >= policyConfig.retrieval.minimumSemanticSimilarity
          && bestSimilarity - match.semanticSimilarity <= policyConfig.retrieval.maximumSemanticDistanceFromBest
        );
      };
      // Distinct evidence facets, not model-driven retries. Both use the same
      // authenticated RLS client and the same evidence thresholds.
      const [primaryMatches, waiverMatches] = await Promise.all([
        retrieve(prepared.sanitized),
        needsWaiverSop ? retrieve(STAFF_WAIVER_QUERY) : Promise.resolve([]),
      ]);
      const staffMatches = waiverMatches.filter((match) => match.citation.scope === "staff");
      // Public refund-review rules alone do not establish who may waive a fee.
      if (needsWaiverSop && staffMatches.length === 0) return INSUFFICIENT;
      const seen = new Set<string>();
      const relevantMatches = [...staffMatches, ...primaryMatches].filter(({ citation }) => {
        const key = JSON.stringify([citation.documentId, citation.version, citation.section]);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const selected = relevantMatches
        .slice(0, policyConfig.retrieval.matchCount);
      const [first, ...rest] = selected.map((match) => match.citation);
      if (!first) return INSUFFICIENT;
      const answerContext = selected
        .map(
          ({ citation }) =>
            `[${citation.documentId} v${citation.version} — ${citation.section}] ${citation.excerpt}`
        )
        .join("\n\n")
        .slice(0, policyConfig.retrieval.maximumContextCharacters);
      return {
        kind: "policy-search",
        status: "grounded",
        answerContext,
        citations: [first, ...rest],
        truncated:
          relevantMatches.length > policyConfig.retrieval.matchCount ||
          answerContext.length >=
            policyConfig.retrieval.maximumContextCharacters,
      };
    } catch {
      return INSUFFICIENT;
    }
  };
}

export function createPolicySearchTool(dependencies: PolicySearchDependencies) {
  const execute = createPolicySearchService(dependencies);
  return tool({
    description:
      "Search current authorized hotel policies and staff SOPs. Input only the policy question; access scope is determined by the caller's database identity.",
    inputSchema: policySearchInputSchema,
    execute,
  });
}
