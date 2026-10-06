import { createAgentUIStreamResponse } from "ai";
import { createConciergeAgent } from "@/app/_ai/agents/concierge-agent";
import { resolveConciergeModel, getConciergeProviderConfigurationError } from "@/app/_ai/providers/concierge-model";
import { resolveOperationsProviderConfiguration } from "@/app/_ai/providers/operations-model";
import { resolveBookingInsightModel } from "@/app/_ai/providers/booking-insight-model";
import { generationOptions } from "@/app/_ai/providers/generation-options";
import { embedPolicyQuery } from "@/app/_ai/providers/policy-embedding-model";
import { generateBookingInsight } from "@/app/_ai/booking-insight-generator";
import { createCurrentBookingInsightIdentity } from "@/app/_ai/booking-insight-identity";
import { createCabinTools, type ConciergeInventoryDataSource } from "@/app/_ai/tools/cabin-tools";
import { createRunObserver } from "@/app/_ai/observability/run";
import { createPolicyIngestionPlan } from "../../scripts/ingest-policies.mjs";

const env = { NODE_ENV: "test" as const, AI_PROVIDER: "openai", OPENAI_API_KEY: "test-key" };
const apiUsage = { input_tokens: 100, input_tokens_details: { cached_tokens: 30, cache_write_tokens: 0 }, output_tokens: 20, output_tokens_details: { reasoning_tokens: 4 }, total_tokens: 120 };
function completed(text: string) {
  return { id: "resp-fixture", object: "response", created_at: 0, model: "gpt-6-luna", status: "completed", output: [{ id: "msg-fixture", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }], usage: apiUsage };
}
beforeEach(() => { vi.stubEnv("AI_PROVIDER", "openai"); vi.stubEnv("OPENAI_API_KEY", "test-key"); });
afterEach(() => { vi.unstubAllEnvs(); });

it("requires an OpenAI key and rejects any Sol model instead of silently switching", () => {
  expect(getConciergeProviderConfigurationError({ NODE_ENV: "test", AI_PROVIDER: "openai", GOOGLE_GENERATIVE_AI_API_KEY: "google-only" })?.code).toBe("missing-openai-key");
  expect(getConciergeProviderConfigurationError({ ...env, AI_CONCIERGE_MODEL: "gpt-6.1-sol" })?.code).toBe("invalid-openai-model");
  expect(resolveOperationsProviderConfiguration(env)).toEqual({ provider: "openai", modelId: "gpt-6-luna" });
  expect(() => resolveOperationsProviderConfiguration({ ...env, AI_OPERATIONS_MODEL: "gemini-3.8-flash" })).toThrow(/gpt-6-luna/);
});

it.each([429, 503])("does not retain private provider request data for a %s failure", async status => {
  const fetch = vi.fn(async () => Response.json({ error: { message: "private@example.invalid api-key-private", code: status === 429 ? "insufficient_quota" : "server_error", type: status === 429 ? "insufficient_quota" : "server_error" } }, { status })) as unknown as typeof globalThis.fetch;
  const model = resolveConciergeModel(env, { fetch });
  if (typeof model === "string") throw new Error("Expected a concrete provider");
  const failure = await Promise.resolve(model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "private guest question" }] }] })).catch(error => error);
  expect(failure.statusCode).toBe(status);
  expect(failure.isRetryable).toBe(status === 503);
  expect(failure.requestBodyValues).toBeUndefined();
  expect(failure.responseBody).toBeUndefined();
  expect(failure.data).toBeUndefined();
  expect(failure.cause).toBeUndefined();
  expect(JSON.stringify(failure)).not.toMatch(/private@example|api-key-private|guest question/);
  expect(fetch).toHaveBeenCalledOnce();
});

it("uses Responses with low reasoning, Standard processing and store=false", async () => {
  const requests: Array<{ url: string; body: any }> = [];
  const fetch = vi.fn(async (url, init) => { requests.push({ url: String(url), body: JSON.parse(String(init?.body)) }); return Response.json(completed("A complete recommendation.")); }) as unknown as typeof globalThis.fetch;
  const model = resolveConciergeModel(env, { fetch });
  const observer = createRunObserver({ surface: "concierge", promptVersion: "fixture", persist: async () => true });
  const answer = await createConciergeAgent({ model, observer }).generate({ prompt: "Recommend a quiet stay." });
  expect(answer.text).toBe("A complete recommendation.");
  expect(requests[0].url).toBe("https://api.openai.com/v1/responses");
  expect(requests[0].body).toMatchObject({ model: "gpt-6-luna", store: false, service_tier: "default", reasoning: { effort: "low" }, max_output_tokens: 6144, text: { verbosity: "low" } });
  expect(requests[0].body).not.toHaveProperty("temperature");
  expect(requests[0].body).not.toHaveProperty("top_p");
  expect(await observer.finish()).toMatchObject({ input_tokens: 100, output_tokens: 20, uncached_input_tokens: 70, cache_read_input_tokens: 30, cache_write_input_tokens: 0, reasoning_tokens: 4 });
});

it("replays a successful function result in the same Responses loop", async () => {
  const source: ConciergeInventoryDataSource = {
    listCabins: vi.fn(async () => [{ id: 1, name: "001", maxCapacity: 2, regularPrice: 250, discount: 0, image: "https://example.invalid/cabin.jpg", description: "Quiet cabin" }]),
    getCabins: vi.fn(async () => []), getCabin: vi.fn(async () => null), getConflictingCabinIds: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({ id: 1, minBookingLength: 3, maxBookingLength: 30, maxGuestsPerBooking: 10, breakfastPrice: 15 })),
  };
  const bodies: any[] = [];
  const fetch = vi.fn(async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    if (bodies.length === 1) return Response.json({ ...completed(""), output: [{ id: "fn-fixture", type: "function_call", call_id: "search-fixture", name: "searchAvailableCabins", arguments: JSON.stringify({ startDate: "2027-01-10", endDate: "2027-01-13", numGuests: 2, maxTotalPrice: 1200, preferences: ["quiet"] }) }] });
    return Response.json(completed("Cabin 001 costs $750 for your stay."));
  }) as unknown as typeof globalThis.fetch;
  const result = await createConciergeAgent({ model: resolveConciergeModel(env, { fetch }), tools: createCabinTools(source) }).generate({ prompt: "2027-01-10 to 2027-01-13, two guests, $1200 budget." });
  expect(result.text).toContain("$750");
  expect(source.listCabins).toHaveBeenCalledOnce();
  expect(bodies).toHaveLength(2);
  expect(bodies[1].input).toEqual(expect.arrayContaining([expect.objectContaining({ type: "function_call_output", call_id: "search-fixture", output: expect.stringContaining('"totalPrice":750') })]));
});

it("serializes a real OpenAI SSE response into the existing UI protocol", async () => {
  const events = [
    { type: "response.created", response: { id: "resp-stream", created_at: 0, model: "gpt-6-luna" } },
    { type: "response.output_item.added", output_index: 0, item: { type: "message", id: "msg-stream" } },
    { type: "response.output_text.delta", item_id: "msg-stream", output_index: 0, delta: "流式说明已完整返回。" },
    { type: "response.output_item.done", output_index: 0, item: { type: "message", id: "msg-stream", role: "assistant", content: [{ type: "output_text", text: "流式说明已完整返回。", annotations: [] }] } },
    { type: "response.completed", response: { usage: apiUsage, status: "completed" } },
  ];
  const fetch = vi.fn(async () => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } })) as unknown as typeof globalThis.fetch;
  const response = await createAgentUIStreamResponse({ agent: createConciergeAgent({ model: resolveConciergeModel(env, { fetch }) }), uiMessages: [{ id: "user", role: "user", parts: [{ type: "text", text: "请简短回答" }] }] });
  const stream = await response.text();
  expect(stream).toContain('"type":"text-delta"');
  expect(stream).toContain("流式说明已完整返回。");
  expect(stream).toContain('"finishReason":"stop"');
  expect(stream).not.toContain('"type":"error"');
});

it("generates a validated Briefing JSON through the Responses structured output schema", async () => {
  const insight = { summary: "Confirm allergen-safe preparation.", riskTags: ["food-allergy"], severity: "high", actionItems: ["Contact the kitchen before arrival."], confidence: 0.8 };
  const bodies: any[] = [];
  const fetch = vi.fn(async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return Response.json(completed(JSON.stringify(insight))); }) as unknown as typeof globalThis.fetch;
  const observer = createRunObserver({ surface: "booking-insight", promptVersion: "fixture", persist: async () => true });
  expect(await generateBookingInsight("Severe peanut allergy.", { env, model: resolveBookingInsightModel(env, { fetch }), observer })).toEqual(insight);
  expect(bodies[0].text.format).toMatchObject({ type: "json_schema", strict: true, schema: { additionalProperties: false } });
  expect(bodies[0].reasoning.effort).toBe("low");
  expect(bodies[0].max_output_tokens).toBe(4096);
});

it("uses the OpenAI embeddings endpoint with an explicit compatible vector dimension", async () => {
  const body: any[] = [];
  const fetch = vi.fn(async (url, init) => {
    expect(String(url)).toBe("https://api.openai.com/v1/embeddings");
    body.push(JSON.parse(String(init?.body)));
    return Response.json({ object: "list", model: "text-embedding-3-small", data: [{ object: "embedding", index: 0, embedding: Array(768).fill(0.01) }], usage: { prompt_tokens: 4, total_tokens: 4 } });
  }) as unknown as typeof globalThis.fetch;
  expect(await embedPolicyQuery("pet policy", { env, fetch })).toHaveLength(768);
  expect(body[0]).toMatchObject({ model: "text-embedding-3-small", dimensions: 768 });
  expect(() => generationOptions("concierge", { ...env, AI_CONCIERGE_REASONING_EFFORT: "invalid" })).toThrow();
});

it("invalidates Briefing cache identity when reasoning effort changes", () => {
  const low = createCurrentBookingInsightIdentity("allergy", env);
  const medium = createCurrentBookingInsightIdentity("allergy", { ...env, AI_BOOKING_INSIGHT_REASONING_EFFORT: "medium" });
  expect(low.model).toBe("gpt-6-luna");
  expect(low.sourceHash).not.toBe(medium.sourceHash);
  expect(low.promptVersion).not.toBe(medium.promptVersion);
});

it("forces re-embedding on a model change even when dimensions, content and versions are unchanged", () => {
  const doc = { id: "pet-policy", version: 1, contentHash: "same", chunks: [{ chunkId: "pet-policy@1:1", contentHash: "same-chunk" }] };
  const plan = createPolicyIngestionPlan([doc], { documents: [{ document_id: "pet-policy", version: 1, content_hash: "same", is_current: true, embedding_model: "gemini-embedding-2", embedding_dimensions: 768 }], chunks: [{ chunk_id: "pet-policy@1:1", document_id: "pet-policy", document_version: 1, content_hash: "same-chunk", embedding_instruction_version: "policy-document-v1" }] }, { embedding: { model: "text-embedding-3-small", dimensions: 768, documentInstructionVersion: "openai-policy-document-v1" } });
  expect(plan.summary).toMatchObject({ update: 1, unchanged: 0, embed: 1, reuse: 0 });
});
