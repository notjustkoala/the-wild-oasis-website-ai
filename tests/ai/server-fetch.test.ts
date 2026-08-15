import {
  createProxyAwareFetch,
  resolveServerProxyUrl,
} from "@/app/_lib/server-fetch";

function env(values: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...values };
}

describe("server proxy-aware fetch", () => {
  it("resolves valid proxies in documented priority order", () => {
    expect(
      resolveServerProxyUrl(
        env({
          AI_HTTPS_PROXY: "http://ai-only:7890",
          HTTPS_PROXY: "http://https:7890",
          HTTP_PROXY: "http://http:7890",
        })
      )
    ).toBe("http://ai-only:7890/");
    expect(
      resolveServerProxyUrl(
        env({ HTTPS_PROXY: "http://https:7890", HTTP_PROXY: "http://http:7890" })
      )
    ).toBe("http://https:7890/");
    expect(resolveServerProxyUrl(env({ http_proxy: "http://lower:7890" }))).toBe(
      "http://lower:7890/"
    );
    expect(
      resolveServerProxyUrl(
        env({
          AI_HTTPS_PROXY: "http://ai-only:7890",
          HTTPS_PROXY: "http://shared:7890",
        }),
        false
      )
    ).toBe("http://shared:7890/");
  });

  it("uses native fetch without a valid http/https proxy", () => {
    const nativeFetch = vi.fn() as unknown as typeof fetch;
    expect(createProxyAwareFetch(env(), { nativeFetch })).toBe(nativeFetch);
    expect(
      createProxyAwareFetch(env({ HTTPS_PROXY: "socks5://127.0.0.1:7890" }), {
        nativeFetch,
      })
    ).toBe(nativeFetch);
    expect(
      createProxyAwareFetch(env({ HTTPS_PROXY: "not a url" }), { nativeFetch })
    ).toBe(nativeFetch);
  });

  it("passes the proxy dispatcher to undici fetch without networking", async () => {
    const dispatcher = { dispatch: vi.fn(), close: vi.fn(), destroy: vi.fn() };
    const createProxyAgent = vi.fn(() => dispatcher as never);
    const response = new Response("ok");
    const proxyFetch = vi.fn(async () => response);
    const proxyAwareFetch = createProxyAwareFetch(
      env({ HTTPS_PROXY: "http://127.0.0.1:7890" }),
      { createProxyAgent, proxyFetch }
    );

    await expect(
      proxyAwareFetch("https://generativelanguage.googleapis.com/v1beta", {
        method: "POST",
      })
    ).resolves.toBe(response);
    expect(createProxyAgent).toHaveBeenCalledWith("http://127.0.0.1:7890/");
    expect(proxyFetch).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta",
      expect.objectContaining({ method: "POST", dispatcher })
    );
  });
});
