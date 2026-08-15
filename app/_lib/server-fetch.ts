import "server-only";

import {
  fetch as undiciFetch,
  ProxyAgent,
  type Dispatcher,
  type RequestInfo as UndiciRequestInfo,
  type RequestInit as UndiciRequestInit,
} from "undici";

type ServerFetchDependencies = {
  nativeFetch?: typeof globalThis.fetch;
  createProxyAgent?: (proxyUrl: string) => Dispatcher;
  proxyFetch?: (
    input: UndiciRequestInfo,
    init: UndiciRequestInit
  ) => Promise<unknown>;
};

const proxyAgents = new Map<string, Dispatcher>();

export function resolveServerProxyUrl(
  env: NodeJS.ProcessEnv = process.env,
  includeAiOverride = true
): string | null {
  const candidates = [
    ...(includeAiOverride ? [env.AI_HTTPS_PROXY] : []),
    env.HTTPS_PROXY,
    env.HTTP_PROXY,
    env.https_proxy,
    env.http_proxy,
  ];

  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (!value) continue;
    try {
      const url = new URL(value);
      if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname) {
        return url.toString();
      }
    } catch {
      // Ignore malformed proxy configuration and continue to the next candidate.
    }
  }

  return null;
}

function getProxyAgent(proxyUrl: string) {
  const cached = proxyAgents.get(proxyUrl);
  if (cached) return cached;
  const dispatcher = new ProxyAgent(proxyUrl);
  proxyAgents.set(proxyUrl, dispatcher);
  return dispatcher;
}

export function createProxyAwareFetch(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: ServerFetchDependencies = {},
  includeAiOverride = true
): typeof globalThis.fetch {
  const proxyUrl = resolveServerProxyUrl(env, includeAiOverride);
  const nativeFetch = dependencies.nativeFetch ?? globalThis.fetch;
  if (!proxyUrl) return nativeFetch;

  const dispatcher = dependencies.createProxyAgent
    ? dependencies.createProxyAgent(proxyUrl)
    : getProxyAgent(proxyUrl);
  const proxyFetch = dependencies.proxyFetch ?? undiciFetch;

  return (async (input, init) => {
    const response = await proxyFetch(input as UndiciRequestInfo, {
      ...(init as UndiciRequestInit),
      dispatcher,
    });
    return response as globalThis.Response;
  }) as typeof globalThis.fetch;
}
