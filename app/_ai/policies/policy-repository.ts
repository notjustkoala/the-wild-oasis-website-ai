import "server-only";

import policyConfig from "@/policy-rag.config.json";
import {
  policyCitationSchema,
  type PolicyCitation,
} from "@/app/_ai/policies/policy-types";
import { compareHybridRankValues } from "@/app/_ai/policies/policy-hybrid-ranking";

export const POLICY_REPOSITORY_ERROR =
  "Policy search is temporarily unavailable.";

export type PolicyMatch = {
  citation: PolicyCitation;
  semanticSimilarity: number;
  rrfScore: number;
};

export type PolicyRpcClient = {
  rpc: (
    functionName: "match_policy_chunks",
    parameters: {
      query_text: string;
      query_embedding: number[];
      result_count: number;
      minimum_similarity: number;
    }
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

function boundedText(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function parseMatch(value: unknown): PolicyMatch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const citation = policyCitationSchema.safeParse({
    documentId: boundedText(row.document_id, 120),
    title: boundedText(row.title, 160),
    section: boundedText(row.section, 200),
    version: row.version,
    effectiveDate: boundedText(row.effective_date, 10),
    excerpt: boundedText(
      row.content,
      policyConfig.retrieval.maximumExcerptCharacters
    ),
    scope: row.scope,
  });
  const semanticSimilarity = Number(row.semantic_similarity);
  const rrfScore = Number(row.rrf_score);
  if (
    !citation.success ||
    !Number.isFinite(semanticSimilarity) ||
    semanticSimilarity < -1 ||
    semanticSimilarity > 1 ||
    !Number.isFinite(rrfScore) ||
    rrfScore < 0
  ) {
    return null;
  }
  return { citation: citation.data, semanticSimilarity, rrfScore };
}

export async function matchPolicyChunks({
  client,
  queryText,
  embedding,
}: {
  client: PolicyRpcClient;
  queryText: string;
  embedding: number[];
}): Promise<PolicyMatch[]> {
  try {
    if (!client || typeof client.rpc !== "function") {
      throw new Error(POLICY_REPOSITORY_ERROR);
    }
    const { data, error } = await client.rpc("match_policy_chunks", {
      query_text: queryText.slice(
        0,
        policyConfig.retrieval.maximumQuestionCharacters
      ),
      query_embedding: embedding,
      result_count: Math.min(policyConfig.retrieval.matchCount + 1, 6),
      minimum_similarity:
        policyConfig.retrieval.minimumSemanticSimilarity,
    });
    if (error || !Array.isArray(data)) throw new Error(POLICY_REPOSITORY_ERROR);
    const parsed = data.map(parseMatch);
    if (parsed.some((item) => item === null)) {
      throw new Error(POLICY_REPOSITORY_ERROR);
    }
    return (parsed as PolicyMatch[])
      .sort((left, right) => compareHybridRankValues(
        left,
        right,
        left.citation.documentId,
        right.citation.documentId,
      ))
      .slice(0, policyConfig.retrieval.matchCount + 1);
  } catch {
    throw new Error(POLICY_REPOSITORY_ERROR);
  }
}
