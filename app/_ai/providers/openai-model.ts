import "server-only";
import { APICallError, wrapLanguageModel, type LanguageModel } from "ai";
import { CONCIERGE_ACCOUNT_QUOTA_MESSAGE } from "@/app/_ai/concierge-error-messages";

export class OpenAIAccountQuotaError extends APICallError {
  constructor() {
    super({ message: CONCIERGE_ACCOUNT_QUOTA_MESSAGE, url: "https://api.openai.com", requestBodyValues: undefined, statusCode: 429, isRetryable: false });
  }
}

// Prevent SDK's default stream logger from retaining request bodies or credentials.
// Preserve status and retry semantics without retaining the original error as cause.
export function protectOpenAIModel(model: Exclude<LanguageModel, string>) {
  const protect = async <T>(call: () => PromiseLike<T>): Promise<T> => {
    try { return await call(); }
    catch (error) {
      if (!APICallError.isInstance(error)) throw error;
      const data = error.data as { error?: { code?: unknown; type?: unknown } } | undefined;
      const accountQuota = error.statusCode === 429 && (data?.error?.code === "insufficient_quota" || data?.error?.type === "insufficient_quota");
      if (accountQuota) throw new OpenAIAccountQuotaError();
      const responseHeaders: Record<string, string> = {};
      for (const name of ["retry-after", "retry-after-ms"]) {
        const value = error.responseHeaders?.[name];
        if (value && /^\d+(?:\.\d+)?$/.test(value)) responseHeaders[name] = value;
      }
      throw new APICallError({
        message: "The AI model service could not complete this request.",
        url: "https://api.openai.com",
        requestBodyValues: undefined,
        statusCode: error.statusCode,
        isRetryable: error.isRetryable,
        responseHeaders,
      });
    }
  };
  return wrapLanguageModel({ model, middleware: { wrapGenerate: ({ doGenerate }) => protect(doGenerate), wrapStream: ({ doStream }) => protect(doStream) } });
}
