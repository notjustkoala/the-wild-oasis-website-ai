import "server-only";

export function operationsCors(request: Request, env: NodeJS.ProcessEnv = process.env) {
  const headers = new Headers({ Vary: "Origin" });
  const origin = request.headers.get("origin");
  if (!origin) return { ok: true as const, headers };
  const configured = new Set(
    (env.AI_ADMIN_ORIGIN ?? "")
      .split(",")
      .map((value) => {
        try { return new URL(value.trim()).origin; } catch { return ""; }
      })
      .filter(Boolean)
  );
  if (env.NODE_ENV !== "production") {
    configured.add("http://localhost:5173");
    configured.add("http://127.0.0.1:5173");
  }
  let normalized = "";
  try { normalized = new URL(origin).origin; } catch { /* reject below */ }
  if (!normalized || normalized !== origin || !configured.has(normalized)) {
    return { ok: false as const, status: 403 as const, headers };
  }
  headers.set("Access-Control-Allow-Origin", normalized);
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Idempotency-Key");
  headers.set("Access-Control-Max-Age", "600");
  return { ok: true as const, headers };
}
