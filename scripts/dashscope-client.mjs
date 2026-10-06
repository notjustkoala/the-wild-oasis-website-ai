export const DEFAULT_DASHSCOPE_BASE_URL = "https://ws-yndfm25xs823xj89.cn-beijing.maas.aliyuncs.com/compatible-mode/v1";
export const DASHSCOPE_GENERATION_MODEL = "qwen3.7-plus";
export const DASHSCOPE_EMBEDDING_MODEL = "text-embedding-v4";

export function dashscopeBaseURL(env = process.env) {
  let url;
  try { url = new URL(env.DASHSCOPE_BASE_URL?.trim() || DEFAULT_DASHSCOPE_BASE_URL); }
  catch { throw new Error("Invalid DASHSCOPE_BASE_URL."); }
  const approvedHost = /^ws-[a-z0-9]+\.cn-beijing\.maas\.aliyuncs\.com$/.test(url.hostname) || url.hostname === "dashscope.aliyuncs.com";
  if (!approvedHost || url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || url.pathname.replace(/\/$/, "") !== "/compatible-mode/v1") {
    throw new Error("DASHSCOPE_BASE_URL must be a Beijing HTTPS OpenAI-compatible endpoint.");
  }
  return `${url.origin}/compatible-mode/v1`;
}

// The official Chat API supports strict JSON Schema and function tools. Disable
// its default thinking mode explicitly to keep the interactive reply responsive.
// Embedding usage may contain total_tokens only; normalize this input-only count
// for the installed SDK without inventing a count when usage is absent.
export function dashscopeFetch(fetch, baseURL) {
  const allowed = new Set([`${baseURL}/chat/completions`, `${baseURL}/embeddings`]);
  return async (input, init) => {
    const url = String(input);
    if (!allowed.has(url)) throw new Error("Unexpected DashScope API endpoint.");
    let body = init?.body;
    if (url.endsWith("/chat/completions") && typeof body === "string") {
      const request = JSON.parse(body);
      request.enable_thinking = false;
      delete request.reasoning_effort;
      delete request.service_tier;
      delete request.verbosity;
      delete request.store;
      body = JSON.stringify(request);
    }
    const response = await fetch(input, { ...init, body, redirect: "error" });
    if (!url.endsWith("/embeddings") || !response.ok) return response;
    const payload = await response.json();
    const tokens = payload.usage?.prompt_tokens ?? payload.usage?.total_tokens;
    if (Number.isSafeInteger(tokens) && tokens >= 0) payload.usage = { prompt_tokens: tokens };
    else delete payload.usage;
    if (Array.isArray(payload.data)) {
      const indices = payload.data.map(item => item.index);
      if (indices.every(Number.isSafeInteger)) {
        if (new Set(indices).size !== indices.length || indices.some(index => index < 0 || index >= indices.length)) throw new Error("Invalid embedding indices.");
        payload.data.sort((a, b) => a.index - b.index);
      }
    }
    const headers = new Headers(response.headers);
    headers.delete("content-length"); headers.delete("content-encoding");
    return Response.json(payload, { status: response.status, headers });
  };
}

export function dashscopeTransportEnvironment(env = process.env) {
  return { ...env, AI_HTTPS_PROXY: env.DASHSCOPE_HTTPS_PROXY || "", HTTPS_PROXY: "", HTTP_PROXY: "", https_proxy: "", http_proxy: "" };
}
