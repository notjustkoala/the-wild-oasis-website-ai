import {
  rankHybridPolicyCandidates,
  type HybridRankingConfig,
} from "@/app/_ai/policies/policy-hybrid-ranking";

import { preparePolicyQuery } from "@/app/_ai/policies/policy-query-privacy";
import config from "../../../policy-rag.config.json";
import { loadPolicyDocuments } from "../../../scripts/policy-content.mjs";
import { createPolicySearchService } from "@/app/_ai/tools/policy-search";

const FIXED_FEATURES = [
  ["pet", "pets", "dog", "cat", "animal", "20 kg", "25 kg", "宠物", "动物", "猫", "狗"],
  ["cancel", "cancellation", "refund", "no-show", "7 days", "48 hours", "取消", "退款", "未到店", "原路"],
  ["check-in", "check-out", "arrival", "departure", "15:00", "11:00", "入住", "退房", "延迟退房"],
  ["payment", "paid", "charged", "card", "collect", "original payment", "付款", "支付", "扣款", "paid back"],
  ["accessib", "mobility", "hearing", "visual", "service animal", "72 hours", "无障碍", "服务性动物"],
  ["breakfast", "dietary", "allerg", "religious", "早餐", "饮食", "过敏"],
  ["exception", "waiver", "escalat", "approval", "high priority", "severe", "internal", "sop", "例外", "豁免", "升级", "严重"],
] as const;

type CorpusItem = {
  chunkId: string;
  documentId: string;
  version: number;
  scope: "public" | "staff";
  content: string;
  isCurrent: boolean;
  embedding: number[];
};

type LoadedDocument = {
  id: string;
  title: string;
  version: number;
  scope: "public" | "staff";
  chunks: Array<{ chunkId: string; section: string; content: string }>;
};

export const tunedConfig: HybridRankingConfig = config.retrieval;
const baselineConfig: HybridRankingConfig = {
  ...config.retrieval,
  candidateCount: 8,
  matchCount: 1,
  minimumSemanticSimilarity: 0.7,
  fullTextWeight: 0,
};

function fixedEmbedding(value: string) {
  const normalized = value.toLocaleLowerCase();
  return FIXED_FEATURES.map((terms) => Number((terms as readonly string[]).some((term) => normalized.includes(term))));
}

function cosineSimilarity(left: number[], right: number[]) {
  const dot = left.reduce((sum, value, index) => sum + value * right[index], 0);
  const leftMagnitude = Math.sqrt(left.reduce((sum, value) => sum + value * value, 0));
  const rightMagnitude = Math.sqrt(right.reduce((sum, value) => sum + value * value, 0));
  return leftMagnitude && rightMagnitude ? dot / (leftMagnitude * rightMagnitude) : 0;
}

function simpleLexemes(value: string): string[] {
  return value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function fixedFullTextScore(query: string, content: string) {
  const queryLexemes = simpleLexemes(query);
  const contentLexemes = simpleLexemes(content);
  if (!queryLexemes.length || !queryLexemes.every((term) => contentLexemes.includes(term))) return 0;
  return queryLexemes.reduce(
    (score, term) => score + contentLexemes.filter((candidate) => candidate === term).length,
    0,
  );
}

export function retrieve(query: string, caller: "guest" | "staff", corpus: CorpusItem[], ranking: HybridRankingConfig) {
  const prepared = preparePolicyQuery(query, {
    allowStaffScope: caller === "staff",
  });
  if (!prepared.searchable) return [];
  const queryEmbedding = fixedEmbedding(prepared.sanitized);
  const visible = corpus.filter((item) => item.isCurrent && (caller === "staff" || item.scope === "public"));
  return rankHybridPolicyCandidates(visible.map((item) => ({
    ...item,
    semanticSimilarity: cosineSimilarity(queryEmbedding, item.embedding),
    lexicalScore: fixedFullTextScore(prepared.sanitized, item.content),
  })), ranking);
}


export async function loadCorpus() { const loaded = await loadPolicyDocuments(); return (loaded.documents as unknown as LoadedDocument[]).flatMap(document => document.chunks.map(chunk => { const content = `${document.title}\n${chunk.section}\n${chunk.content}`; return {chunkId: chunk.chunkId, documentId: document.id, version: document.version, scope: document.scope, content, isCurrent: true, embedding: fixedEmbedding(content)}; })); }

// Fixed retrieval adapter tests production policy service orchestration and scope
// enforcement; it is deliberately not an embedding-quality evaluation. The
// historical rank-only benchmark remains in policy-retrieval-eval.test.ts.
export async function searchPolicyFixture(question: string, caller: "guest" | "staff") {
  const { documents } = await loadPolicyDocuments();
  const topicIds = ["pet-policy", "cancellation-refund", "check-in-check-out", "payment-policy", "accessibility", "breakfast-dietary", "exception-handling-sop"];
  const service = createPolicySearchService({
    client: { rpc: async () => { throw new Error("Offline policy fixture cannot call RPC"); } } as never,
    allowedScopes: caller === "staff" ? ["public", "staff"] : ["public"],
    embedQuery: async () => Array(768).fill(0),
    search: async ({ queryText }) => {
      const features = fixedEmbedding(queryText);
      return (documents as unknown as LoadedDocument[]).filter(document => features[topicIds.indexOf(document.id)] && (caller === "staff" || document.scope === "public"))
        .map(document => ({ semanticSimilarity: 1, rrfScore: 1, citation: { documentId: document.id, title: document.title, section: document.chunks[0].section, version: document.version, effectiveDate: "2026-08-01", excerpt: document.chunks[0].content.slice(0, 420), scope: document.scope } }));
    },
  });
  return service({ question });
}
