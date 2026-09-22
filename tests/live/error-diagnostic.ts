const names = new Set(["AI_APICallError", "AI_RetryError", "AI_NoOutputGeneratedError", "AI_NoObjectGeneratedError", "AI_InvalidToolInputError", "AI_NoSuchToolError", "AI_ToolExecutionError", "AI_TypeValidationError", "AI_JSONParseError", "AI_InvalidResponseDataError", "AbortError", "TimeoutError", "TypeError"]);
const networkCodes = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "EPIPE", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_ABORTED"]);
export function safeErrorDiagnostic(error: unknown) {
  const chain: Array<{ name: string; statusCode: number | null; code: string | null }> = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current) && chain.length < 4) {
    seen.add(current);
    const value = current as { name?: unknown; statusCode?: unknown; code?: unknown; cause?: unknown; lastError?: unknown };
    chain.push({ name: typeof value.name === "string" && names.has(value.name) ? value.name : "UnknownError", statusCode: typeof value.statusCode === "number" && Number.isInteger(value.statusCode) && value.statusCode >= 100 && value.statusCode <= 599 ? value.statusCode : null, code: typeof value.code === "string" && networkCodes.has(value.code) ? value.code : null });
    current = value.cause ?? value.lastError;
  }
  return { category: chain.some(row => row.name === "AbortError" || row.name === "TimeoutError") ? "timeout" : chain.some(row => row.statusCode === 429) ? "provider-rate-limit" : chain.some(row => row.statusCode !== null) ? "provider-http" : chain.some(row => row.code !== null) ? "network-error" : "generation-error", chain };
}
