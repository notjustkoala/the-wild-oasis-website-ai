import { createServer, type ServerResponse } from "node:http";

// A real chunked HTTP stream, controlled by the test. No model or database.
export async function createStreamFixture() {
  let response: ServerResponse | undefined;
  let received!: () => void;
  let closed!: () => void;
  const ready = new Promise<void>((resolve) => { received = resolve; });
  const disconnected = new Promise<void>((resolve) => { closed = resolve; });
  const server = createServer((request, outgoing) => {
    outgoing.setHeader("Access-Control-Allow-Origin", request.headers.origin || "*");
    outgoing.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    outgoing.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    if (request.method === "OPTIONS") { outgoing.writeHead(204); outgoing.end(); return; }
    request.resume();
    response = outgoing;
    outgoing.writeHead(200, {
      "Content-Type": "text/event-stream", "Cache-Control": "no-store",
      "x-vercel-ai-ui-message-stream": "v1",
      "x-ai-trace-id": "00000000-0000-4000-8000-000000000005",
      "Access-Control-Expose-Headers": "X-AI-Trace-Id",
    });
    outgoing.flushHeaders();
    outgoing.on("close", closed);
    received();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No fixture port.");
  return {
    url: `http://127.0.0.1:${address.port}/stream`, ready, disconnected,
    async write(...events: unknown[]) {
      await ready;
      for (const event of events) response!.write(`data: ${JSON.stringify(event)}\n\n`);
    },
    async finish() { await ready; response!.end("data: [DONE]\n\n"); },
    async disconnect() { await ready; response!.destroy(); },
    async close() { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); },
  };
}
