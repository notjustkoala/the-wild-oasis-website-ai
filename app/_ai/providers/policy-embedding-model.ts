import "server-only";

import { createOpenAI } from "@ai-sdk/openai";
import { embed } from "ai";

import policyConfig from "@/policy-rag.config.json";
import { createProxyAwareFetch } from "@/app/_lib/server-fetch";
import { policyEmbeddingProfile } from "@/scripts/policy-embedding-profile.mjs";
import { dashscopeBaseURL, dashscopeFetch, dashscopeTransportEnvironment } from "@/scripts/dashscope-client.mjs";

export const POLICY_EMBEDDING_MODEL = "text-embedding-3-small" as const;
export const POLICY_EMBEDDING_DIMENSIONS = 768 as const;

export type PolicyQueryEmbeddingDependencies = {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
  createOpenAIProvider?: typeof createOpenAI;
  embedValue?: typeof embed;
};

export function assertPolicyEmbeddingConfiguration(env: NodeJS.ProcessEnv = process.env) {
  return policyEmbeddingProfile(policyConfig, env).embedding;
}

export async function embedPolicyQuery(
  query: string,
  dependencies: PolicyQueryEmbeddingDependencies = {}
) {
  const env = dependencies.env ?? process.env;
  const { provider, embedding: embeddingConfig } = policyEmbeddingProfile(policyConfig, env);
  const apiKey = (provider === "dashscope" ? env.DASHSCOPE_API_KEY : env.OPENAI_API_KEY)?.trim();
  if (!apiKey) throw new Error("Policy search is temporarily unavailable.");

  const baseURL = provider === "dashscope" ? dashscopeBaseURL(env) : undefined;
  const fetch = dependencies.fetch ?? createProxyAwareFetch(provider === "dashscope" ? dashscopeTransportEnvironment(env) : env);
  const openai = (dependencies.createOpenAIProvider ?? createOpenAI)({ apiKey, baseURL, fetch: baseURL ? dashscopeFetch(fetch, baseURL) : fetch });
  const result = await (dependencies.embedValue ?? embed)({
    model: openai.embedding(embeddingConfig.model),
    value: query,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(15_000),
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
