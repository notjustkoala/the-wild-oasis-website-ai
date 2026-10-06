import "server-only";
import { Agent, fetch as undiciFetch, type RequestInfo, type RequestInit } from "undici";
import { createProxyAwareFetch } from "@/app/_lib/server-fetch";
import { dashscopeTransportEnvironment } from "@/scripts/dashscope-client.mjs";

// Use a dedicated IPv4 connection pool instead of Next's enhanced fetch/cache
// path. Model POST/SSE requests must never be cached or buffered as page data.
const dispatcher = new Agent({ connect: { family: 4, timeout: 10_000 }, headersTimeout: 25_000, bodyTimeout: 30_000, keepAliveTimeout: 10_000, keepAliveMaxTimeout: 20_000 });
function isConnectTimeout(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const detail = current as { code?: unknown; cause?: unknown };
    if (detail.code === "UND_ERR_CONNECT_TIMEOUT") return true;
    current = detail.cause;
  }
  return false;
}
export function createDashScopeTransport(env: NodeJS.ProcessEnv = process.env): typeof globalThis.fetch {
  const direct: typeof globalThis.fetch = async (input, init) => undiciFetch(input as RequestInfo, { ...(init as RequestInit), dispatcher }) as unknown as Promise<Response>;
  const fetch = env.DASHSCOPE_HTTPS_PROXY?.trim() ? createProxyAwareFetch(dashscopeTransportEnvironment(env)) : direct;
  return async (input, init) => {
    const endpoint = String(input).endsWith("/embeddings") ? "embedding" : "chat";
    // A connect timeout occurs before a request can reach the model. Retry it
    // once, but never replay a header/body timeout, HTTP failure or active stream.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const start = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new DOMException("Model response headers timed out.", "TimeoutError")), 25_000);
      const signal = init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
      try {
        const response = await fetch(input, { ...init, signal, cache: "no-store" });
        console.info(JSON.stringify({ event: "dashscope-transport", endpoint, status: response.status, headersMs: Date.now() - start }));
        return response;
      } catch (error) {
        const connectTimeout = isConnectTimeout(error);
        const retrying = attempt === 1 && connectTimeout && !signal.aborted;
        console.warn(JSON.stringify({ event: "dashscope-transport", endpoint, failed: true, phase: connectTimeout ? "connect" : "request", attempt, retrying, headersMs: Date.now() - start }));
        if (retrying) continue;
        throw new Error("The model connection could not complete this request.", { cause: error });
      } finally { clearTimeout(timer); }
    }
    throw new Error("The model connection could not complete this request.");
  };
}
