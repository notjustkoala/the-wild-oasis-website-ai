import "server-only";

import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createGateway, type LanguageModel } from "ai";

import { createProxyAwareFetch } from "@/app/_lib/server-fetch";
import { protectOpenAIModel } from "./openai-model";
import { resolveDashScopeModel, DASHSCOPE_GENERATION_MODEL } from "./dashscope-model";
import { dashscopeBaseURL } from "@/scripts/dashscope-client.mjs";

export const DEFAULT_AI_PROVIDER = "google" as const;
export const DEFAULT_GOOGLE_CONCIERGE_MODEL = "gemini-3.8-flash";
export const DEFAULT_GATEWAY_CONCIERGE_MODEL = "openai/gpt-5.6-terra";
export const DEFAULT_OPENAI_CONCIERGE_MODEL = "gpt-6-luna";
export const CONCIERGE_MODEL_MAX_RETRIES = 4;

export type ConciergeProvider = "google" | "gateway" | "openai" | "dashscope";

export type ConciergeProviderConfiguration = {
  provider: ConciergeProvider;
  modelId: string;
};

export type ConciergeProviderErrorCode =
  | "unknown-provider"
  | "invalid-google-model"
  | "invalid-gateway-model"
  | "missing-google-key"
  | "invalid-openai-model"
  | "missing-openai-key"
  | "missing-dashscope-key"
  | "invalid-dashscope-model"
  | "invalid-dashscope-url"
  | "missing-gateway-credential";

export class ConciergeProviderConfigurationError extends Error {
  constructor(
    readonly code: ConciergeProviderErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ConciergeProviderConfigurationError";
  }
}

function readProvider(env: NodeJS.ProcessEnv): ConciergeProvider {
  const provider = env.AI_PROVIDER?.trim().toLowerCase() || DEFAULT_AI_PROVIDER;
  if (provider !== "google" && provider !== "gateway" && provider !== "openai" && provider !== "dashscope") {
    throw new ConciergeProviderConfigurationError(
      "unknown-provider",
      'AI_PROVIDER must be "dashscope", "openai", "google", or "gateway".'
    );
  }
  return provider;
}

function readModelId(provider: ConciergeProvider, env: NodeJS.ProcessEnv) {
  const configured = env.AI_CONCIERGE_MODEL?.trim();
  if (provider === "dashscope") {
    if (configured && configured !== DASHSCOPE_GENERATION_MODEL) throw new ConciergeProviderConfigurationError("invalid-dashscope-model", "The DashScope generation model must be qwen3.7-plus.");
    return DASHSCOPE_GENERATION_MODEL;
  }

  if (provider === "openai") {
    const modelId = configured || DEFAULT_OPENAI_CONCIERGE_MODEL;
    if (modelId !== DEFAULT_OPENAI_CONCIERGE_MODEL) throw new ConciergeProviderConfigurationError("invalid-openai-model", "The OpenAI generation model must be gpt-6-luna.");
    return modelId;
  }

  if (provider === "google") {
    const modelId = configured || DEFAULT_GOOGLE_CONCIERGE_MODEL;
    if (!/^gemini-[a-z0-9][a-z0-9._-]*$/i.test(modelId)) {
      throw new ConciergeProviderConfigurationError(
        "invalid-google-model",
        "AI_CONCIERGE_MODEL must be a direct Google Gemini model ID without a provider prefix."
      );
    }
    return modelId;
  }

  const modelId = configured || DEFAULT_GATEWAY_CONCIERGE_MODEL;
  if (!/^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*$/i.test(modelId)) {
    throw new ConciergeProviderConfigurationError(
      "invalid-gateway-model",
      "AI_CONCIERGE_MODEL must use provider/model format for AI Gateway."
    );
  }
  return modelId;
}

export function resolveConciergeProviderConfiguration(
  env: NodeJS.ProcessEnv = process.env
): ConciergeProviderConfiguration {
  const provider = readProvider(env);
  const modelId = readModelId(provider, env);

  if (provider === "dashscope") {
    if (!env.DASHSCOPE_API_KEY?.trim()) throw new ConciergeProviderConfigurationError("missing-dashscope-key", "DASHSCOPE_API_KEY is required when AI_PROVIDER=dashscope.");
    try { dashscopeBaseURL(env); } catch { throw new ConciergeProviderConfigurationError("invalid-dashscope-url", "DASHSCOPE_BASE_URL is invalid."); }
  } else if (provider === "openai") {
    if (!env.OPENAI_API_KEY?.trim()) throw new ConciergeProviderConfigurationError("missing-openai-key", "OPENAI_API_KEY is required when AI_PROVIDER=openai.");
  } else if (provider === "google") {
    if (!env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) {
      throw new ConciergeProviderConfigurationError(
        "missing-google-key",
        "GOOGLE_GENERATIVE_AI_API_KEY is required when AI_PROVIDER=google."
      );
    }
  } else if (
    !env.AI_GATEWAY_API_KEY?.trim() &&
    !env.VERCEL_OIDC_TOKEN?.trim()
  ) {
    throw new ConciergeProviderConfigurationError(
      "missing-gateway-credential",
      "AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN is required when AI_PROVIDER=gateway."
    );
  }

  return { provider, modelId };
}

export function resolveConciergeModel(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: {
    fetch?: typeof globalThis.fetch;
    createGoogleProvider?: typeof createGoogle;
    createOpenAIProvider?: typeof createOpenAI;
  } = {}
): LanguageModel {
  const configuration = resolveConciergeProviderConfiguration(env);
  if (configuration.provider === "dashscope") return resolveDashScopeModel(env, dependencies);

  if (configuration.provider === "openai") {
    return protectOpenAIModel((dependencies.createOpenAIProvider ?? createOpenAI)({
      apiKey: env.OPENAI_API_KEY!.trim(),
      fetch: dependencies.fetch ?? createProxyAwareFetch(env),
    }).responses(configuration.modelId));
  }

  if (configuration.provider === "google") {
    const google = (dependencies.createGoogleProvider ?? createGoogle)({
      apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY!.trim(),
      fetch: dependencies.fetch ?? createProxyAwareFetch(env),
    });
    return google(configuration.modelId);
  }

  const gateway = createGateway({
    apiKey: env.AI_GATEWAY_API_KEY?.trim() || undefined,
  });
  return gateway(configuration.modelId);
}

export function getConciergeProviderConfigurationError(
  env: NodeJS.ProcessEnv = process.env
): ConciergeProviderConfigurationError | null {
  try {
    resolveConciergeProviderConfiguration(env);
    return null;
  } catch (error) {
    if (error instanceof ConciergeProviderConfigurationError) return error;
    throw error;
  }
}
