import "server-only";

import { APICallError, wrapLanguageModel, type LanguageModel } from "ai";
import { CONCIERGE_DAILY_QUOTA_MESSAGE } from "@/app/_ai/concierge-error-messages";

function isDailyQuotaFailure(error: unknown): boolean {
  if (!APICallError.isInstance(error) || error.statusCode !== 429) return false;
  const data = error.data as { error?: { status?: unknown; details?: unknown } } | undefined;
  if (data?.error?.status !== "RESOURCE_EXHAUSTED" || !Array.isArray(data.error.details)) return false;
  return data.error.details.slice(0, 32).some(detail => {
    if (!detail || typeof detail !== "object" || !Array.isArray(detail.violations)) return false;
    return detail.violations.slice(0, 32).some((violation: unknown) =>
      violation !== null && typeof violation === "object" && "quotaId" in violation &&
      typeof violation.quotaId === "string" && /PerDay(?:Per|[-_]|$)/.test(violation.quotaId)
    );
  });
}

export class ConciergeDailyQuotaError extends APICallError {
  constructor() {
    super({
      message: CONCIERGE_DAILY_QUOTA_MESSAGE,
      url: "https://generativelanguage.googleapis.com",
      requestBodyValues: undefined,
      statusCode: 429,
      isRetryable: false,
    });
  }
}

/** A daily quota cannot recover during this request's bounded retry window. */
export function withConciergeQuotaProtection(model: LanguageModel) {
  if (typeof model === "string") return model;
  const protect = async <T>(call: () => PromiseLike<T>): Promise<T> => {
    try { return await call(); }
    catch (error) {
      if (isDailyQuotaFailure(error)) throw new ConciergeDailyQuotaError();
      throw error;
    }
  };
  return wrapLanguageModel({
    model,
    middleware: {
      wrapGenerate: ({ doGenerate }) => protect(doGenerate),
      wrapStream: ({ doStream }) => protect(doStream),
    },
  });
}
