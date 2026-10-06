import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPolicyDocuments, PROJECT_ROOT } from "./policy-content.mjs";
import { createPolicyIngestionPlan, generatePolicyEmbeddings, policyIngestionPayloads } from "./ingest-policies.mjs";

export async function prepareDashScopePolicyMigration({ args = process.argv.slice(2), env = process.env, generate = generatePolicyEmbeddings, write = true } = {}) {
  const [mode, flag, rawBudget] = args;
  if (mode !== "--dry-run" && mode !== "--prepare" || mode === "--dry-run" && args.length !== 1 || mode === "--prepare" && (args.length !== 3 || flag !== "--max-cny")) throw new Error("Use --dry-run or --prepare --max-cny <budget>.");
  const { config, documents } = await loadPolicyDocuments({ env: { ...env, AI_POLICY_PROVIDER: "dashscope" } });
  const bytes = documents.reduce((total, document) => total + document.chunks.reduce((sum, chunk) => sum + Buffer.byteLength(`${document.title}\n${chunk.section}\n${chunk.content}`, "utf8") * 2 + 64, 0), 0);
  const estimatedInputCNY = bytes * 0.5 / 1_000_000;
  const summary = { project: "fadfglcobmxxsawxlmpb", provider: "dashscope", model: config.embedding.model, dimensions: 768, documents: documents.length, chunks: documents.flatMap(document => document.chunks).length, estimatedInputCNY, databaseWrites: 0 };
  if (mode === "--dry-run") return { mode, ...summary };
  const maxCNY = Number(rawBudget);
  if (!Number.isFinite(maxCNY) || maxCNY <= 0 || estimatedInputCNY > maxCNY) throw new Error("A sufficient positive embedding budget is required.");
  if (env === process.env) for (const file of [".env.development.local", ".env.local"]) {
    try { process.loadEnvFile(resolve(PROJECT_ROOT, file)); } catch (error) { if (error?.code !== "ENOENT") throw new Error("Cannot load local configuration."); }
  }
  const apiKey = env.DASHSCOPE_API_KEY?.trim();
  if (!apiKey) throw new Error("DASHSCOPE_API_KEY is required locally; never put it in command arguments.");
  const plan = createPolicyIngestionPlan(documents, { documents: [], chunks: [] }, config);
  const usage = await generate(plan, config, apiKey, { env });
  const payloads = policyIngestionPayloads(plan, config);
  const payloadHash = createHash("sha256").update(JSON.stringify(payloads)).digest("hex");
  const inputTokens = Number.isSafeInteger(usage?.inputTokens) && usage.inputTokens >= 0 ? usage.inputTokens : null;
  const estimatedUsageCNY = inputTokens === null ? null : inputTokens * 0.5 / 1_000_000;
  if (write) {
    const directory = resolve(PROJECT_ROOT, "output/dashscope-policy-migration");
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, "prepared-corpus.json"), JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), ...summary, maxCNY, inputTokens, estimatedUsageCNY, payloadHash, payloads }), "utf8");
  }
  return { mode, ...summary, inputTokens, estimatedUsageCNY, payloadHash };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareDashScopePolicyMigration().then(report => console.log(JSON.stringify(report))).catch(error => {
    console.error(error instanceof Error ? error.message : "Policy preparation failed."); process.exitCode = 1;
  });
}
