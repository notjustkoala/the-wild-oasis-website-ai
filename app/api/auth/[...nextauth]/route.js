import { ProxyAgent, setGlobalDispatcher } from "undici";

// 在路由加载时设置 undici 全局代理（开发环境）
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
      console.log("[auth-route] undici proxy set:", proxyUrl);
    }
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.log("[auth-route] set proxy failed:", String(err));
    }
  }
}

export { GET, POST } from "@/app/_lib/auth";
