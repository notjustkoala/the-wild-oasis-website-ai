import "server-only";
import { createOpenAI } from "@ai-sdk/openai";
import { createProxyAwareFetch } from "@/app/_lib/server-fetch";
import { dashscopeBaseURL, dashscopeFetch, DASHSCOPE_GENERATION_MODEL, dashscopeTransportEnvironment } from "@/scripts/dashscope-client.mjs";
import { protectOpenAIModel } from "./openai-model";

export { DASHSCOPE_GENERATION_MODEL };
export function resolveDashScopeModel(env: NodeJS.ProcessEnv, dependencies: { fetch?: typeof globalThis.fetch; createOpenAIProvider?: typeof createOpenAI } = {}) {
  const baseURL = dashscopeBaseURL(env);
  const apiKey = env.DASHSCOPE_API_KEY?.trim();
  if (!apiKey) throw new Error("DASHSCOPE_API_KEY is required.");
  const provider = (dependencies.createOpenAIProvider ?? createOpenAI)({
    apiKey, baseURL, name: "dashscope",
    fetch: dashscopeFetch(dependencies.fetch ?? createProxyAwareFetch(dashscopeTransportEnvironment(env)), baseURL),
  });
  return protectOpenAIModel(provider.chat(DASHSCOPE_GENERATION_MODEL), { provider: "dashscope" });
}
