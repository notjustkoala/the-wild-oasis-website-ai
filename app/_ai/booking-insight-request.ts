import "server-only";

export const MAX_BOOKING_INSIGHT_BODY_BYTES = 8_192;

export type BoundedJsonResult =
  | { ok: true; body: unknown }
  | { ok: false; status: 400 | 413; message: string };

export async function readBoundedBookingInsightJson(
  request: Request
): Promise<BoundedJsonResult> {
  const declaredLength = request.headers.get("content-length")?.trim();
  if (declaredLength && /^\d+$/.test(declaredLength)) {
    const bytes = Number(declaredLength);
    if (!Number.isSafeInteger(bytes) || bytes > MAX_BOOKING_INSIGHT_BODY_BYTES) {
      return { ok: false, status: 413, message: "Request body is too large." };
    }
  }

  if (!request.body) {
    return { ok: false, status: 400, message: "Request body must be valid JSON." };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BOOKING_INSIGHT_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413, message: "Request body is too large." };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, message: "Request body must be valid JSON." };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return {
      ok: true,
      body: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    };
  } catch {
    return { ok: false, status: 400, message: "Request body must be valid JSON." };
  }
}
