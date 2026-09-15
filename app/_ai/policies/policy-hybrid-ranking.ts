export type HybridRankingConfig = {
  candidateCount: number;
  matchCount: number;
  minimumSemanticSimilarity: number;
  rrfK: number;
  fullTextWeight: number;
  semanticWeight: number;
};

export type HybridCandidate = {
  chunkId: string;
  semanticSimilarity: number;
  lexicalScore: number;
};

export type HybridRankedCandidate<T extends HybridCandidate> = T & {
  semanticRank: number | null;
  lexicalRank: number | null;
  rrfScore: number;
};

export function reciprocalRankFusionScore({
  semanticRank,
  lexicalRank,
  config,
}: {
  semanticRank: number | null;
  lexicalRank: number | null;
  config: Pick<HybridRankingConfig, "rrfK" | "fullTextWeight" | "semanticWeight">;
}) {
  return (
    (semanticRank === null ? 0 : config.semanticWeight / (config.rrfK + semanticRank)) +
    (lexicalRank === null ? 0 : config.fullTextWeight / (config.rrfK + lexicalRank))
  );
}

export function compareHybridRankValues(
  left: { rrfScore: number; semanticSimilarity: number },
  right: { rrfScore: number; semanticSimilarity: number },
  leftTieBreaker: string,
  rightTieBreaker: string,
) {
  return (
    right.rrfScore - left.rrfScore ||
    right.semanticSimilarity - left.semanticSimilarity ||
    leftTieBreaker.localeCompare(rightTieBreaker)
  );
}

// Mirrors match_policy_chunks: two independently capped candidate lists, fixed
// weighted RRF, a semantic evidence floor, and deterministic final ordering.
export function rankHybridPolicyCandidates<T extends HybridCandidate>(
  candidates: T[],
  config: HybridRankingConfig,
): Array<HybridRankedCandidate<T>> {
  const semantic = [...candidates]
    .sort(
      (left, right) =>
        right.semanticSimilarity - left.semanticSimilarity ||
        left.chunkId.localeCompare(right.chunkId),
    )
    .slice(0, config.candidateCount);
  const lexical = candidates
    .filter((candidate) => candidate.lexicalScore > 0)
    .sort(
      (left, right) =>
        right.lexicalScore - left.lexicalScore ||
        left.chunkId.localeCompare(right.chunkId),
    )
    .slice(0, config.candidateCount);
  const semanticRanks = new Map(semantic.map((candidate, index) => [candidate.chunkId, index + 1]));
  const lexicalRanks = new Map(lexical.map((candidate, index) => [candidate.chunkId, index + 1]));
  const candidateIds = new Set([...semanticRanks.keys(), ...lexicalRanks.keys()]);

  return candidates
    .filter(
      (candidate) =>
        candidateIds.has(candidate.chunkId) &&
        candidate.semanticSimilarity >= config.minimumSemanticSimilarity,
    )
    .map((candidate) => {
      const semanticRank = semanticRanks.get(candidate.chunkId) ?? null;
      const lexicalRank = lexicalRanks.get(candidate.chunkId) ?? null;
      return {
        ...candidate,
        semanticRank,
        lexicalRank,
        rrfScore: reciprocalRankFusionScore({ semanticRank, lexicalRank, config }),
      };
    })
    .sort((left, right) => compareHybridRankValues(left, right, left.chunkId, right.chunkId))
    .slice(0, config.matchCount);
}
