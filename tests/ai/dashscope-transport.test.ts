// @vitest-environment node
import { createDashScopeTransport, dashscopeConnectFallback } from "@/app/_ai/providers/dashscope-transport";
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("undici", async importOriginal => ({
  ...await importOriginal<typeof import("undici")>(), fetch: fetchMock,
}));
const url = "https://model.example.invalid/chat/completions";
const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
function failure(code: string) { return Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("Private provider details"), { code }) }); }
beforeEach(() => { fetchMock.mockReset(); vi.spyOn(console, "info").mockImplementation(() => {}); vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

it("recovers once from a connection timeout before sending the request", async () => {
  fetchMock.mockRejectedValueOnce(failure("UND_ERR_CONNECT_TIMEOUT")).mockResolvedValueOnce(new Response("ok"));
  const response = await createDashScopeTransport(env)(url, { method: "POST", body: "bounded request" });
  expect(await response.text()).toBe("ok");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls.map(call => call[1].body)).toEqual(["bounded request", "bounded request"]);
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/Private provider details|model\.example/);
});
it("fails after two connection attempts", async () => {
  fetchMock.mockRejectedValue(failure("UND_ERR_CONNECT_TIMEOUT"));
  await expect(createDashScopeTransport(env)(url)).rejects.toThrow("The model connection could not complete this request.");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it.each(["UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET", "ECONNRESET"])("never replays an uncertain or already-started request: %s", async code => {
  fetchMock.mockRejectedValue(failure(code));
  await expect(createDashScopeTransport(env)(url)).rejects.toThrow("The model connection could not complete this request.");
  expect(fetchMock).toHaveBeenCalledOnce();
});
it.each([429, 503])("returns HTTP %s without a transport replay", async status => {
  fetchMock.mockResolvedValue(new Response("provider response", { status }));
  expect((await createDashScopeTransport(env)(url)).status).toBe(status);
  expect(fetchMock).toHaveBeenCalledOnce();
});
it("does not retry after the caller cancels", async () => {
  const controller = new AbortController();
  fetchMock.mockImplementation(async () => { controller.abort(); throw failure("UND_ERR_CONNECT_TIMEOUT"); });
  await expect(createDashScopeTransport(env)(url, { signal: controller.signal })).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledOnce();
});

it("recovers a Beijing workspace connect timeout through the verified same-region chat endpoint", async () => {
  const primary = "https://ws-fixture.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions";
  fetchMock.mockRejectedValueOnce(failure("UND_ERR_CONNECT_TIMEOUT")).mockResolvedValueOnce(new Response("recovered"));
  const body = JSON.stringify({ model: "qwen3.7-plus", messages: [{ role: "user", content: "fixture" }] });
  const response = await createDashScopeTransport(env)(primary, { method: "POST", body, headers: { Authorization: "Bearer fixture-only-key" } });
  expect(await response.text()).toBe("recovered");
  expect(fetchMock.mock.calls.map(call => call[0])).toEqual([primary, "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"]);
  expect(fetchMock.mock.calls.map(call => call[1].body)).toEqual([body, body]);
  expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain("fixture-only-key");
});
it.each([
  "https://ws-fixture.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
  "https://trial.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
  "https://ws-fixture.cn-beijing.maas.aliyuncs.com.attacker.invalid/compatible-mode/v1/chat/completions",
  "https://user:password@ws-fixture.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
])("never changes region/trial/arbitrary endpoint: %s", input => {
  expect(dashscopeConnectFallback(input)).toBeUndefined();
});
it("keeps the embedding model, input and dimensions unchanged when recovering a pre-connect failure", async()=>{
  const primary="https://ws-fixture.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/embeddings";
  fetchMock.mockRejectedValueOnce(failure("UND_ERR_CONNECT_TIMEOUT")).mockResolvedValueOnce(Response.json({data:[{embedding:[1,2,3]}]}));
  const body=JSON.stringify({model:"text-embedding-v4",input:["fixture"],dimensions:768});
  await createDashScopeTransport(env)(primary,{method:"POST",body});
  expect(fetchMock.mock.calls.map(call=>call[0])).toEqual([primary,"https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings"]);
  expect(fetchMock.mock.calls.map(call=>call[1].body)).toEqual([body,body]);
});
it("does not switch endpoints after headers or response data could have been sent", async () => {
  const primary = "https://ws-fixture.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions";
  fetchMock.mockRejectedValue(failure("UND_ERR_HEADERS_TIMEOUT"));
  await expect(createDashScopeTransport(env)(primary, { method: "POST", body: "fixture" })).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledOnce();
});
it("never replays a non-reusable request body", async () => {
  fetchMock.mockRejectedValue(failure("UND_ERR_CONNECT_TIMEOUT"));
  await expect(createDashScopeTransport(env)(url, { method: "POST", body: new ReadableStream() })).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledOnce();
});
it("does not retry or switch hosts when an active response stream later fails", async () => {
  const primary = "https://ws-fixture.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions";
  fetchMock.mockResolvedValue(new Response(new ReadableStream({start(controller){controller.error(failure("UND_ERR_SOCKET"));}})));
  const response=await createDashScopeTransport(env)(primary,{method:"POST",body:"fixture"});
  await expect(response.text()).rejects.toThrow();expect(fetchMock).toHaveBeenCalledOnce();
});
