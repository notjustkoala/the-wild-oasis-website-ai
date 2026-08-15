import "server-only";

import { createGoogle } from "@ai-sdk/google";
import { createGateway, type LanguageModel } from "ai";

import { createProxyAwareFetch } from "@/app/_lib/server-fetch";

export const DEFAULT_AI_PROVIDER = "google" as const;
export const DEFAULT_GOOGLE_CONCIERGE_MODEL = "gemini-3.6-flash";
export const DEFAULT_GATEWAY_CONCIERGE_MODEL = "openai/gpt-5.6-terra";

export type ConciergeProvider = "google" | "gateway";

export type ConciergeProviderConfiguration = {
  provider: ConciergeProvider;
  modelId: string;
};

export type ConciergeProviderErrorCode =
  | "unknown-provider"
  | "invalid-google-model"
  | "invalid-gateway-model"
  | "missing-google-key"
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
  if (provider !== "google" && provider !== "gateway") {
    throw new ConciergeProviderConfigurationError(
      "unknown-provider",
      'AI_PROVIDER must be either "google" or "gateway".'
    );
  }
  return provider;
}

function readModelId(provider: ConciergeProvider, env: NodeJS.ProcessEnv) {
  const configured = env.AI_CONCIERGE_MODEL?.trim();

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

  if (provider === "google") {
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
  } = {}
): LanguageModel {
  const configuration = resolveConciergeProviderConfiguration(env);

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
