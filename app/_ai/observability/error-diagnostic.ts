import "server-only";

const safeErrorNames = new Set([
  "Error",
  "AbortError",
  "TimeoutError",
  "TypeError",
  "AI_APICallError",
  "AI_RetryError",
  "AI_NoOutputGeneratedError",
  "AI_NoObjectGeneratedError",
  "AI_InvalidToolInputError",
  "AI_NoSuchToolError",
  "AI_ToolExecutionError",
  "AI_TypeValidationError",
  "AI_JSONParseError",
  "AI_InvalidResponseDataError",
]);

const safeNetworkCodes = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_ABORTED",
]);

type SafeGenerationErrorCode =
  | "client-cancelled"
  | "timeout"
  | "provider-rate-limit"
  | "provider-http"
  | "network-error"
  | "generation-error";

export type SafeGenerationErrorDiagnostic = {
  errorName: string;
  code: SafeGenerationErrorCode;
  status: number | null;
  retryable: boolean | null;
};

export const FALLBACK_GENERATION_ERROR_DIAGNOSTIC: SafeGenerationErrorDiagnostic = Object.freeze({
  errorName: "UnknownError",
  code: "generation-error",
  status: null,
  retryable: null,
});

const MAX_ERROR_NODES = 8;
const MAX_ERROR_DEPTH = 4;

function readProperty(value: object, property: string): unknown {
  try {
    return Reflect.get(value, property);
  } catch {
    return undefined;
  }
}

function inspectGenerationError(
  error: unknown,
  clientAborted: boolean,
): SafeGenerationErrorDiagnostic {
  if (clientAborted) {
    return {
      ...FALLBACK_GENERATION_ERROR_DIAGNOSTIC,
      code: "client-cancelled",
    };
  }

  let errorName = "UnknownError";
  let status: number | null = null;
  let retryable: boolean | null = null;
  let timedOut = false;
  let networkError = false;
  const seen = new Set<unknown>();
  const pending: Array<{ value: unknown; depth: number }> = [{ value: error, depth: 0 }];
  let inspectedNodes = 0;

  while (pending.length > 0 && inspectedNodes < MAX_ERROR_NODES) {
    const next = pending.shift();
    if (!next) break;
    const { value: current, depth } = next;
    if (
      current === null ||
      (typeof current !== "object" && typeof current !== "function") ||
      seen.has(current)
    ) continue;
    seen.add(current);
    inspectedNodes += 1;

    const name = readProperty(current, "name");
    const statusCode = readProperty(current, "statusCode");
    const isRetryable = readProperty(current, "isRetryable");
    const networkCode = readProperty(current, "code");

    if (errorName === "UnknownError" && typeof name === "string" && safeErrorNames.has(name)) {
      errorName = name;
    }
    if (name === "AbortError" || name === "TimeoutError") timedOut = true;
    if (
      status === null &&
      typeof statusCode === "number" &&
      Number.isInteger(statusCode) &&
      statusCode >= 400 &&
      statusCode <= 599
    ) status = statusCode;
    if (retryable === null && typeof isRetryable === "boolean") retryable = isRetryable;
    if (typeof networkCode === "string" && safeNetworkCodes.has(networkCode)) networkError = true;

    if (depth < MAX_ERROR_DEPTH) {
      pending.push(
        { value: readProperty(current, "cause"), depth: depth + 1 },
        { value: readProperty(current, "lastError"), depth: depth + 1 },
      );
    }
  }

  const code: SafeGenerationErrorCode = timedOut
    ? "timeout"
    : status === 429
      ? "provider-rate-limit"
      : status !== null
        ? "provider-http"
        : networkError
          ? "network-error"
          : "generation-error";

  return { errorName, code, status, retryable };
}

export function safeGenerationErrorDiagnostic(
  error: unknown,
  clientAborted = false,
): SafeGenerationErrorDiagnostic {
  try {
    return inspectGenerationError(error, clientAborted);
  } catch {
    return clientAborted
      ? { ...FALLBACK_GENERATION_ERROR_DIAGNOSTIC, code: "client-cancelled" }
      : { ...FALLBACK_GENERATION_ERROR_DIAGNOSTIC };
  }
}
