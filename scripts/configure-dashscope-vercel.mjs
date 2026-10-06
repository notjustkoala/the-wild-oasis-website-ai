import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { dashscopeBaseURL } from "./dashscope-client.mjs";
const project = "prj_3iA1n6o6PAnniDEjIeY6htShT6uR";
for (const file of [".env.development.local", ".env.local"]) {
  try { process.loadEnvFile(resolve(file)); } catch (error) { if (error.code !== "ENOENT") throw new Error("Local configuration unavailable."); }
}
const key = process.env.DASHSCOPE_API_KEY?.trim();
if (!key) throw new Error("DashScope server key required.");
const values = { DASHSCOPE_API_KEY: key, DASHSCOPE_BASE_URL: dashscopeBaseURL(), AI_PROVIDER: "dashscope", AI_POLICY_PROVIDER: "dashscope", AI_CONCIERGE_MODEL: "qwen3.7-plus", AI_OPERATIONS_MODEL: "qwen3.7-plus", AI_BOOKING_INSIGHT_MODEL: "qwen3.7-plus" };
for (const [name, value] of Object.entries(values)) {
  const args = ["D:/Temp/wild-oasis-deploy-mucIOR/node_modules/vercel/dist/vc.js", "env", "add", name, "production,preview", "--force", "--yes", "--project", project, "--scope", "team_Antl2xUqtrFwSU0BiHcsskfO", "--global-config", "D:/Temp/wild-oasis-deploy-mucIOR/auth", "--no-color", name === "DASHSCOPE_API_KEY" ? "--sensitive" : "--no-sensitive"];
  const code = await new Promise((done, reject) => {
    const child = spawn(process.execPath, args, { cwd: process.cwd(), env: { ...process.env, VERCEL_TELEMETRY_DISABLED: "1" }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    child.stdout.resume(); child.stderr.resume(); child.on("error", () => reject(new Error("Vercel configuration command failed."))); child.on("close", done); child.stdin.end(value + "\n");
  });
  if (code !== 0) throw new Error(`Vercel configuration failed for ${name}.`);
  console.log(JSON.stringify({ variable: name, environments: ["production", "preview"], configured: true, sensitive: name === "DASHSCOPE_API_KEY" }));
}
