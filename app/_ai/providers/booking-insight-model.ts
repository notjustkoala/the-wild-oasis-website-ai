import "server-only";

import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createGateway, type LanguageModel } from "ai";

import { createProxyAwareFetch } from "@/app/_lib/server-fetch";
import { protectOpenAIModel } from "./openai-model";
import { resolveDashScopeModel, DASHSCOPE_GENERATION_MODEL } from "./dashscope-model";
import { dashscopeBaseURL } from "@/scripts/dashscope-client.mjs";
import {
  ConciergeProviderConfigurationError,
  DEFAULT_AI_PROVIDER,
  DEFAULT_OPENAI_CONCIERGE_MODEL,
  DEFAULT_GATEWAY_CONCIERGE_MODEL,
  DEFAULT_GOOGLE_CONCIERGE_MODEL,
  type ConciergeProvider,
} from "@/app/_ai/providers/concierge-model";

export const DEFAULT_GOOGLE_BOOKING_INSIGHT_MODEL = DEFAULT_GOOGLE_CONCIERGE_MODEL;
export const DEFAULT_GATEWAY_BOOKING_INSIGHT_MODEL = DEFAULT_GATEWAY_CONCIERGE_MODEL;

export type BookingInsightProviderConfiguration = {
  provider: ConciergeProvider;
  modelId: string;
};

export function resolveBookingInsightModelIdentity(
  env: NodeJS.ProcessEnv = process.env
): BookingInsightProviderConfiguration {
  const provider = env.AI_PROVIDER?.trim().toLowerCase() || DEFAULT_AI_PROVIDER;
  if (provider !== "google" && provider !== "gateway" && provider !== "openai" && provider !== "dashscope") {
    throw new ConciergeProviderConfigurationError(
      "unknown-provider",
      'AI_PROVIDER must be "dashscope", "openai", "google", or "gateway".'
    );
  }

  const configured = env.AI_BOOKING_INSIGHT_MODEL?.trim();
  const modelId =
    configured ||
    (provider === "dashscope" ? DASHSCOPE_GENERATION_MODEL : provider === "openai" ? DEFAULT_OPENAI_CONCIERGE_MODEL : provider === "google"
      ? DEFAULT_GOOGLE_BOOKING_INSIGHT_MODEL
      : DEFAULT_GATEWAY_BOOKING_INSIGHT_MODEL);

  if (provider === "dashscope") {
    if (modelId !== DASHSCOPE_GENERATION_MODEL) throw new ConciergeProviderConfigurationError("invalid-dashscope-model", "The DashScope generation model must be qwen3.7-plus.");
  } else if (provider === "openai") {
    if (modelId !== DEFAULT_OPENAI_CONCIERGE_MODEL) throw new ConciergeProviderConfigurationError("invalid-openai-model", "The OpenAI generation model must be gpt-6-luna.");
  } else if (provider === "google") {
    if (!/^gemini-[a-z0-9][a-z0-9._-]*$/i.test(modelId)) {
      throw new ConciergeProviderConfigurationError(
        "invalid-google-model",
        "AI_BOOKING_INSIGHT_MODEL must be a direct Google Gemini model ID."
      );
    }
  } else {
    if (!/^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*$/i.test(modelId)) {
      throw new ConciergeProviderConfigurationError(
        "invalid-gateway-model",
        "AI_BOOKING_INSIGHT_MODEL must use provider/model format for AI Gateway."
      );
    }
  }

  return { provider, modelId };
}

export function resolveBookingInsightProviderConfiguration(
  env: NodeJS.ProcessEnv = process.env
): BookingInsightProviderConfiguration {
  const configuration = resolveBookingInsightModelIdentity(env);
  if (configuration.provider === "dashscope") {
    if (!env.DASHSCOPE_API_KEY?.trim()) throw new ConciergeProviderConfigurationError("missing-dashscope-key", "DASHSCOPE_API_KEY is required when AI_PROVIDER=dashscope.");
    try { dashscopeBaseURL(env); } catch { throw new ConciergeProviderConfigurationError("invalid-dashscope-url", "DASHSCOPE_BASE_URL is invalid."); }
  }
  if (configuration.provider === "openai" && !env.OPENAI_API_KEY?.trim()) throw new ConciergeProviderConfigurationError("missing-openai-key", "OPENAI_API_KEY is required when AI_PROVIDER=openai.");
  if (
    configuration.provider === "google" &&
    !env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()
  ) {
    throw new ConciergeProviderConfigurationError(
      "missing-google-key",
      "GOOGLE_GENERATIVE_AI_API_KEY is required when AI_PROVIDER=google."
    );
  }
  if (
    configuration.provider === "gateway" &&
    !env.AI_GATEWAY_API_KEY?.trim() &&
    !env.VERCEL_OIDC_TOKEN?.trim()
  ) {
    throw new ConciergeProviderConfigurationError(
      "missing-gateway-credential",
      "AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN is required for AI Gateway."
    );
  }
  return configuration;
}

export function resolveBookingInsightModel(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: {
    fetch?: typeof globalThis.fetch;
    createGoogleProvider?: typeof createGoogle;
    createOpenAIProvider?: typeof createOpenAI;
  } = {}
): LanguageModel {
  const config = resolveBookingInsightProviderConfiguration(env);
  if (config.provider === "dashscope") return resolveDashScopeModel(env, dependencies);
  if (config.provider === "openai") return protectOpenAIModel((dependencies.createOpenAIProvider ?? createOpenAI)({ apiKey: env.OPENAI_API_KEY!.trim(), fetch: dependencies.fetch ?? createProxyAwareFetch(env) }).responses(config.modelId));
  if (config.provider === "google") {
    const google = (dependencies.createGoogleProvider ?? createGoogle)({
      apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY!.trim(),
      fetch: dependencies.fetch ?? createProxyAwareFetch(env),
    });
    return google(config.modelId);
  }
  return createGateway({ apiKey: env.AI_GATEWAY_API_KEY?.trim() || undefined })(
    config.modelId
  );
}
