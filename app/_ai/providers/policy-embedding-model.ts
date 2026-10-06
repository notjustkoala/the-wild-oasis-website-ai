import "server-only";

import { createOpenAI } from "@ai-sdk/openai";
import { embed } from "ai";

import policyConfig from "@/policy-rag.config.json";
import { createProxyAwareFetch } from "@/app/_lib/server-fetch";

export const POLICY_EMBEDDING_MODEL = "text-embedding-3-small" as const;
export const POLICY_EMBEDDING_DIMENSIONS = 768 as const;

export type PolicyQueryEmbeddingDependencies = {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
  createOpenAIProvider?: typeof createOpenAI;
  embedValue?: typeof embed;
};

export function assertPolicyEmbeddingConfiguration() {
  if (
    policyConfig.embedding.model !== POLICY_EMBEDDING_MODEL ||
    policyConfig.embedding.dimensions !== POLICY_EMBEDDING_DIMENSIONS
  ) {
    throw new Error("Policy embedding configuration is invalid.");
  }
  return policyConfig.embedding;
}

export async function embedPolicyQuery(
  query: string,
  dependencies: PolicyQueryEmbeddingDependencies = {}
) {
  const embeddingConfig = assertPolicyEmbeddingConfiguration();
  const env = dependencies.env ?? process.env;
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("Policy search is temporarily unavailable.");

  const openai = (dependencies.createOpenAIProvider ?? createOpenAI)({
    apiKey,
    fetch: dependencies.fetch ?? createProxyAwareFetch(env),
  });
  const result = await (dependencies.embedValue ?? embed)({
    model: openai.embedding(embeddingConfig.model),
    value: query,
    providerOptions: {
      openai: {
        dimensions: embeddingConfig.dimensions,
      },
    },
  });
  if (
    result.embedding.length !== embeddingConfig.dimensions ||
    result.embedding.some((item) => !Number.isFinite(item))
  ) {
    throw new Error("Policy search is temporarily unavailable.");
  }
  return result.embedding;
}
