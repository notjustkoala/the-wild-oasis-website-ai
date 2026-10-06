import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, streamText, embed, Output, tool, isStepCount } from "ai";
import { z } from "zod";
import { dashscopeBaseURL, dashscopeFetch, DASHSCOPE_GENERATION_MODEL, DASHSCOPE_EMBEDDING_MODEL } from "./dashscope-client.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export async function checkDashScopeConnection({ args = process.argv.slice(2), env = process.env, fetch = globalThis.fetch } = {}) {
  if (args.length === 1 && args[0] === "--dry-run") return { mode: "dry-run", baseURL: dashscopeBaseURL(env), generation: DASHSCOPE_GENERATION_MODEL, embedding: DASHSCOPE_EMBEDDING_MODEL, dimensions: 768, modelCalls: 0, databaseWrites: 0 };
  if (args.length !== 3 || args[0] !== "--live" || args[1] !== "--max-cny") throw new Error("Use --dry-run or --live --max-cny <positive budget>.");
  const maxCNY = Number(args[2]);
  if (!Number.isFinite(maxCNY) || maxCNY <= 0) throw new Error("A positive test budget is required.");
  if (env === process.env) for (const file of [".env.development.local", ".env.local"]) {
    try { process.loadEnvFile(resolve(root, file)); } catch (error) { if (error?.code !== "ENOENT") throw new Error("Cannot load local configuration."); }
  }
  const apiKey = env.DASHSCOPE_API_KEY?.trim();
  if (!apiKey) throw new Error("Save DASHSCOPE_API_KEY in the ignored server environment file first.");
  const baseURL = dashscopeBaseURL(env);
  let reservedCNY = 0, requests = 0, inputTokens = 0, outputTokens = 0, missingUsage = false;
  const budgetFetch = async (input, init) => {
    const body = JSON.parse(String(init?.body));
    const embedding = String(input).endsWith("/embeddings");
    if (body.model !== (embedding ? DASHSCOPE_EMBEDDING_MODEL : DASHSCOPE_GENERATION_MODEL)) throw new Error("Unexpected model in connection test.");
    const byteAllowance = Buffer.byteLength(JSON.stringify(embedding ? body.input : body.messages), "utf8") * 2 + 1024;
    if (byteAllowance > 200_000 || (!embedding && (!Number.isInteger(body.max_tokens) || body.max_tokens > 1024))) throw new Error("Test request is outside its bounded token allowance.");
    const allowance = embedding ? byteAllowance * 0.5 / 1_000_000 : (byteAllowance * 2 + body.max_tokens * 8) / 1_000_000;
    if (requests >= 8 || reservedCNY + allowance > maxCNY) throw new Error("Test budget allowance exhausted; no additional request sent.");
    reservedCNY += allowance; requests += 1;
    try {
      const response = await fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(45_000)]) });
      if (!response.ok) {
        let code;
        try { const data = await response.json(); code = data?.error?.code ?? data?.code; } catch { /* never print response bodies */ }
        const safeCodes = ["invalid_api_key", "InvalidApiKey", "Arrearage", "AllocationQuota.FreeTierOnly", "BudgetLimitExceeded", "model_not_found", "ModelNotFound", "WorkSpaceNotFound", "Workspace.AccessDenied", "Throttling.RateQuota", "Throttling.AllocationQuota", "insufficient_quota"];
        throw new Error(`DashScope HTTP ${response.status}${safeCodes.includes(code) ? ` (${code})` : ""}.`);
      }
      return response;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("DashScope HTTP")) throw error;
      throw new Error("DashScope connection failed or timed out.");
    }
  };
  const provider = createOpenAI({ apiKey, baseURL, name: "dashscope", fetch: dashscopeFetch(budgetFetch, baseURL) });
  const model = provider.chat(DASHSCOPE_GENERATION_MODEL);
  const settings = { model, maxOutputTokens: 1024, maxRetries: 0, providerOptions: { openai: { strictJsonSchema: true, parallelToolCalls: false, systemMessageMode: "system" } }, abortSignal: AbortSignal.timeout(90_000) };
  const recordUsage = usage => {
    if (!Number.isSafeInteger(usage?.inputTokens) || !Number.isSafeInteger(usage?.outputTokens)) missingUsage = true;
    else { inputTokens += usage.inputTokens; outputTokens += usage.outputTokens; }
  };
  const report = { mode: "live", generation: DASHSCOPE_GENERATION_MODEL, embedding: DASHSCOPE_EMBEDDING_MODEL, dimensions: 768, checks: {}, databaseWrites: 0, toolData: "synthetic read-only fixture; no hotel database access" };
  const stream = streamText({ ...settings, onError: () => {}, prompt: "请用两句话介绍安静木屋度假的体验，最后写：连接测试完成。" });
  let streamed = "", chunks = 0;
  // Consume the full stream, including its error events; a partial reply alone
  // does not pass. Do not invoke the SDK default error logger with raw payloads.
  for await (const part of stream.fullStream) {
    if (part.type === "error") { if (part.error instanceof Error && /^(DashScope HTTP|Test budget)/.test(part.error.message)) throw part.error; throw new Error("DashScope streaming did not complete."); }
    if (part.type === "text-delta") { streamed += part.text; chunks += 1; }
  }
  if (!streamed.includes("连接测试完成") || await stream.finishReason !== "stop") throw new Error("Streaming completion check failed.");
  recordUsage(await stream.totalUsage);
  report.checks.streaming = { completed: true, textChunks: chunks };
  let toolExecutions = 0;
  const toolsResult = await generateText({ ...settings,
    system: "Always call getTestCabin before answering. After receiving the result, state the cabin name and total price. Never invent values.",
    prompt: "查询测试小屋并告诉我三晚总价。",
    tools: { getTestCabin: tool({ description: "Returns a synthetic read-only cabin fixture for connection testing.", inputSchema: z.object({}).strict(), execute: async () => { toolExecutions += 1; return { name: "001", nights: 3, totalPrice: 750, currency: "USD" }; } }) },
    stopWhen: isStepCount(2), prepareStep: ({ steps }) => steps.length ? { toolChoice: "none" } : { toolChoice: { type: "tool", toolName: "getTestCabin" } },
  });
  if (toolExecutions !== 1 || !toolsResult.text.includes("750") || toolsResult.finishReason !== "stop") throw new Error("Tool result round-trip failed.");
  recordUsage(toolsResult.totalUsage); report.checks.functionCalling = { completed: true, executions: toolExecutions };
  const recap = await generateText({ ...settings,
    system: "Summarize only stated guest preferences. Do not search cabins or invent preferences.",
    messages: [{ role: "user", content: "两位客人，希望安静些，预算1200美元。" }, { role: "user", content: "我偏好哪些类型的房屋？" }],
  });
  if (!recap.text.includes("安静") || recap.finishReason !== "stop") throw new Error("Preference recap failed.");
  recordUsage(recap.totalUsage); report.checks.preferenceRecap = { completed: true };
  const schema = z.object({ summary: z.string().min(1).max(500), riskTags: z.array(z.enum(["food-allergy", "late-arrival", "pet", "celebration", "extra-bed", "other"])).max(6), severity: z.enum(["low", "medium", "high"]), actionItems: z.array(z.string().min(1).max(300)).min(1).max(8), confidence: z.number().min(0).max(1) }).strict();
  const briefing = await generateText({ ...settings, output: Output.object({ name: "BookingInsight", schema }), system: "Create a concise hotel operations risk briefing. A severe food allergy is a high-priority safety issue. Never invent personal data.", prompt: "Guest reports a severe peanut allergy. Prepare operational actions." });
  const parsed = schema.parse(briefing.output);
  if (!parsed.riskTags.includes("food-allergy") || parsed.severity !== "high") throw new Error("Briefing validation failed.");
  recordUsage(briefing.totalUsage); report.checks.structuredJSON = { completed: true };
  const vector = await embed({ model: provider.embedding(DASHSCOPE_EMBEDDING_MODEL), value: "宠物入住政策 pet policy", providerOptions: { openai: { dimensions: 768 } }, maxRetries: 0, abortSignal: AbortSignal.timeout(30_000) });
  if (vector.embedding.length !== 768 || vector.embedding.some(value => !Number.isFinite(value))) throw new Error("Embedding validation failed.");
  const embeddingTokens = Number.isSafeInteger(vector.usage?.tokens) ? vector.usage.tokens : null;
  report.checks.embedding = { completed: true, dimensions: 768, inputTokens: embeddingTokens };
  const estimatedGenerationCNY = missingUsage ? null : (inputTokens * 2 + outputTokens * 8) / 1_000_000;
  return { ...report, requests, maxCNY, reservedCNY, generationInputTokens: missingUsage ? null : inputTokens, generationOutputTokens: missingUsage ? null : outputTokens, estimatedGenerationCNY, estimatedEmbeddingCNY: embeddingTokens === null ? null : embeddingTokens * 0.5 / 1_000_000, priceBasis: "Beijing list prices; token/byte allowances are estimates, not the provider invoice" };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkDashScopeConnection().then(report => console.log(JSON.stringify(report, null, 2))).catch(error => {
    const message = error instanceof Error && /^(Use --|A positive|Save DASHSCOPE|DashScope HTTP|DashScope connection|Test budget|Invalid DASHSCOPE|DASHSCOPE_BASE_URL|Cannot load)/.test(error.message) ? error.message : "DashScope connection checks failed; no raw response or credentials logged.";
    console.error(message); process.exitCode = 1;
  });
}
