import "server-only";

import { createGoogle } from "@ai-sdk/google";
import { createGateway, type LanguageModel } from "ai";

import { createProxyAwareFetch } from "@/app/_lib/server-fetch";
import {
  ConciergeProviderConfigurationError,
  DEFAULT_AI_PROVIDER,
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
  if (provider !== "google" && provider !== "gateway") {
    throw new ConciergeProviderConfigurationError(
      "unknown-provider",
      'AI_PROVIDER must be either "google" or "gateway".'
    );
  }

  const configured = env.AI_BOOKING_INSIGHT_MODEL?.trim();
  const modelId =
    configured ||
    (provider === "google"
      ? DEFAULT_GOOGLE_BOOKING_INSIGHT_MODEL
      : DEFAULT_GATEWAY_BOOKING_INSIGHT_MODEL);

  if (provider === "google") {
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
  } = {}
): LanguageModel {
  const config = resolveBookingInsightProviderConfiguration(env);
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
