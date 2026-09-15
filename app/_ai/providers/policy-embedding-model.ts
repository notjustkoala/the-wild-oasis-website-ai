import "server-only";

import { createGoogle } from "@ai-sdk/google";
import { embed } from "ai";

import policyConfig from "@/policy-rag.config.json";
import { createProxyAwareFetch } from "@/app/_lib/server-fetch";

export const POLICY_EMBEDDING_MODEL = "gemini-embedding-2" as const;
export const POLICY_EMBEDDING_DIMENSIONS = 768 as const;

export type PolicyQueryEmbeddingDependencies = {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
  createGoogleProvider?: typeof createGoogle;
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
  const apiKey = env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (!apiKey) throw new Error("Policy search is temporarily unavailable.");

  const google = (dependencies.createGoogleProvider ?? createGoogle)({
    apiKey,
    fetch: dependencies.fetch ?? createProxyAwareFetch(env),
  });
  const result = await (dependencies.embedValue ?? embed)({
    model: google.embedding(embeddingConfig.model),
    value: query,
    providerOptions: {
      google: {
        outputDimensionality: embeddingConfig.dimensions,
        taskType: "RETRIEVAL_QUERY",
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
