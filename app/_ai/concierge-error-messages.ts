// Public, allow-listed messages shared by the server serializer and the UI.
export const CONCIERGE_DAILY_QUOTA_MESSAGE =
  "The AI service's daily usage limit has been reached. Please try again after the quota resets or browse cabins without AI.";
export const CONCIERGE_RATE_LIMIT_MESSAGE =
  "The AI service is receiving too many requests. Please wait before trying again or browse cabins without AI.";
export const CONCIERGE_ACCOUNT_QUOTA_MESSAGE =
  "The AI account's usage allowance is exhausted. Please contact the site team or browse cabins without AI.";

export function conciergePublicErrorMessage(error: Error): string | undefined {
  let message = error.message;
  try {
    const body: unknown = JSON.parse(message);
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string") message = body.error;
  } catch { /* SSE errors are plain text; HTTP failures may be JSON. */ }
  return [CONCIERGE_DAILY_QUOTA_MESSAGE, CONCIERGE_RATE_LIMIT_MESSAGE, CONCIERGE_ACCOUNT_QUOTA_MESSAGE].find(candidate =>
    message === candidate || new RegExp(`^${escapeRegExp(candidate)} Reference: [0-9a-f-]{36}$`, "i").test(message)
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
