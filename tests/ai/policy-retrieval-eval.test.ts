import {
  rankHybridPolicyCandidates,
  type HybridRankingConfig,
} from "@/app/_ai/policies/policy-hybrid-ranking";
import cases from "./policy-rag-cases.json";
import { preparePolicyQuery } from "@/app/_ai/policies/policy-query-privacy";
import config from "../../policy-rag.config.json";
import { loadPolicyDocuments } from "../../scripts/policy-content.mjs";

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

const tunedConfig: HybridRankingConfig = config.retrieval;
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

function retrieve(query: string, caller: "guest" | "staff", corpus: CorpusItem[], ranking: HybridRankingConfig) {
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

function measure(corpus: CorpusItem[], ranking: HybridRankingConfig) {
  let supported = 0;
  let recalled = 0;
  let recallSum = 0;
  let leakageCount = 0;
  let unsupportedAnswerCount = 0;
  const missedCaseIds: string[] = [];
  for (const testCase of cases) {
    const results = retrieve(testCase.query, testCase.caller as "guest" | "staff", corpus, ranking);
    const ids = new Set(results.map((item) => item.documentId));
    if (testCase.expectedDocumentIds.length) {
      supported += 1;
      recallSum += testCase.expectedDocumentIds.filter((id) => ids.has(id)).length / testCase.expectedDocumentIds.length;
      if (testCase.expectedDocumentIds.every((id) => ids.has(id))) recalled += 1;
      else missedCaseIds.push(testCase.id);
    } else if (results.length) {
      unsupportedAnswerCount += 1;
    }
    if (testCase.caller === "guest") leakageCount += results.filter((item) => item.scope === "staff").length;
    expect(results.some((item) => item.version === 0)).toBe(false);
  }
  return { k: ranking.matchCount, recallAtK: recallSum / supported, allRequiredDocumentHitRate: recalled / supported, leakageCount, unsupportedAnswerCount, missedCaseIds };
}

describe("policy retrieval evaluation", () => {
  it("locks the provisional chunk, embedding, threshold, candidate, and RRF parameters", () => {
    expect(config).toMatchObject({
      embedding: { model: "gemini-embedding-2", dimensions: 768, documentInstructionVersion: "policy-document-v1", queryInstructionVersion: "policy-query-v1" },
      chunking: { version: "heading-paragraph-v1", maxCharacters: 900, overlapCharacters: 120 },
      retrieval: { matchCount: 5, candidateCount: 30, minimumSemanticSimilarity: 0.55, maximumSemanticDistanceFromBest: 0.04, rrfK: 50, fullTextWeight: 1, semanticWeight: 1 },
    });
  });

  it("records baseline and tuned metrics through the production-equivalent hybrid/RRF core", async () => {
    const loaded = await loadPolicyDocuments();
    // The JS parser validates these metadata fields but cannot infer them from
    // its dynamic front-matter map at the TypeScript import boundary.
    const documents = loaded.documents as unknown as LoadedDocument[];
    const corpus: CorpusItem[] = documents.flatMap((document) => document.chunks.map((chunk) => {
      const content = `${document.title}\n${chunk.section}\n${chunk.content}`;
      return {
        chunkId: chunk.chunkId,
        documentId: document.id,
        version: document.version,
        scope: document.scope,
        content,
        isCurrent: true,
        embedding: fixedEmbedding(content),
      };
    }));
    corpus.push({
      chunkId: "pet-policy@0:old-conflict",
      documentId: "pet-policy",
      version: 0,
      scope: "public",
      content: "Old conflicting rule: pets up to 30kg.",
      isCurrent: false,
      embedding: fixedEmbedding("Old conflicting rule: pets up to 30kg."),
    });

    const metrics = {
      baseline: measure(corpus, baselineConfig),
      tuned: measure(corpus, tunedConfig),
    };
    // This deterministic harness validates ranking behavior. Gemini embeddings and
    // the deployed pgvector/FTS plan remain explicit human-environment checks.
    console.info("Local synthetic ranking metrics (not Gemini/DB calibration):", JSON.stringify(metrics));
    expect(metrics).toMatchObject({
      baseline: { k: 1, recallAtK: 13 / 18, allRequiredDocumentHitRate: 11 / 18, leakageCount: 0, unsupportedAnswerCount: 0 },
      tuned: { k: 5, recallAtK: 17.5 / 18, allRequiredDocumentHitRate: 17 / 18, leakageCount: 0, unsupportedAnswerCount: 0 },
    });
    expect(metrics.tuned.recallAtK).toBeGreaterThanOrEqual(metrics.baseline.recallAtK);
  });

  it("fuses independent candidate lists, honors weights and caps, and rejects low semantic evidence", () => {
    const candidates = [
      { chunkId: "semantic", semanticSimilarity: 0.9, lexicalScore: 0 },
      { chunkId: "both", semanticSimilarity: 0.8, lexicalScore: 2 },
      { chunkId: "lexical", semanticSimilarity: 0.7, lexicalScore: 3 },
      { chunkId: "unsupported", semanticSimilarity: 0.1, lexicalScore: 4 },
    ];
    const ranking = { ...tunedConfig, candidateCount: 3, matchCount: 3 };
    expect(rankHybridPolicyCandidates(candidates, ranking).map((item) => item.chunkId)).toEqual(["both", "lexical", "semantic"]);
    expect(rankHybridPolicyCandidates(candidates, { ...ranking, fullTextWeight: 0 }).map((item) => item.chunkId)).toEqual(["semantic", "both", "lexical"]);
    expect(rankHybridPolicyCandidates(candidates, { ...ranking, candidateCount: 1 }).map((item) => item.chunkId)).toEqual(["semantic"]);
    expect(rankHybridPolicyCandidates(candidates, { ...ranking, matchCount: 1 })).toHaveLength(1);
  });
});
