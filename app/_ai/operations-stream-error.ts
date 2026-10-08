import { safeGenerationErrorDiagnostic } from "@/app/_ai/observability/error-diagnostic";

// Public, fixed messages only. The Staff parser recognizes these exact strings
// and never forwards arbitrary errorText/provider bodies to the UI.
export function operationsStreamErrorMessage(error: unknown, traceId: string): string {
  const diagnostic = safeGenerationErrorDiagnostic(error);
  const message = diagnostic.code === "network-error"
    ? "The model service could not be reached. Please try again."
    : diagnostic.code === "timeout"
    ? "The model service took too long to respond. Please try again."
    : diagnostic.code === "provider-rate-limit"
    ? "The model service is rate limited. Please wait and try again."
    : diagnostic.status === 401 || diagnostic.status === 403
    ? "The model service access is unavailable. Please contact an administrator."
    : "The operations copilot could not complete this request. Please try again.";
  return `${message} Reference: ${traceId}`;
}
