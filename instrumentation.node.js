import { ProxyAgent, setGlobalDispatcher } from "undici";

export function register() {
  // 读取常见代理环境变量，优先使用 HTTPS_PROXY
  const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy;

  if (proxyUrl) {
    try {
      const agent = new ProxyAgent(proxyUrl);
      setGlobalDispatcher(agent);
      if (process.env.NODE_ENV !== "production") {
        // 简短确认日志（仅开发环境）
        console.log("[instrumentation] undici proxy set:", proxyUrl);
      }
    } catch (err) {
      if (process.env.NODE_ENV !== "production") {
        console.log("[instrumentation] set proxy failed:", String(err));
      }
    }
  } else if (process.env.NODE_ENV !== "production") {
    console.log("[instrumentation] no proxy env set");
  }
}


