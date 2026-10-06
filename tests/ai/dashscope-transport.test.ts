// @vitest-environment node
import { createDashScopeTransport } from "@/app/_ai/providers/dashscope-transport";
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
