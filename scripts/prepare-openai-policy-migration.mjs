import process from "node:process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadPolicyDocuments, PROJECT_ROOT } from "./policy-content.mjs";
import { createPolicyIngestionPlan, generatePolicyEmbeddings, policyIngestionPayloads } from "./ingest-policies.mjs";

export const POLICY_MIGRATION_PROJECT = "fadfglcobmxxsawxlmpb";
export const EMBEDDING_INPUT_USD_PER_MILLION = 0.02;
const ARTIFACT_DIRECTORY = resolve(PROJECT_ROOT, "output/openai-policy-migration");

export async function prepareOpenAIPolicyMigration({ args = process.argv.slice(2), env = process.env, generate = generatePolicyEmbeddings, write = true } = {}) {
  const [mode, flag, rawBudget] = args;
  if (mode !== "--dry-run" && mode !== "--prepare") throw new Error("Use --dry-run or --prepare --max-usd <budget>.");
  if (mode === "--dry-run" && args.length !== 1 || mode === "--prepare" && (args.length !== 3 || flag !== "--max-usd")) throw new Error("Invalid migration preparation arguments.");
  const { config, documents } = await loadPolicyDocuments();
  const chunks = documents.flatMap(document => document.chunks);
  const byteBound = documents.reduce((sum, document) => sum + document.chunks.reduce((total, chunk) => total + Buffer.byteLength(`${document.title}\n${chunk.section}\n${chunk.content}`, "utf8") + 8, 0), 0);
  const estimatedInputUSD = byteBound * EMBEDDING_INPUT_USD_PER_MILLION / 1_000_000;
  const summary = { project: POLICY_MIGRATION_PROJECT, model: config.embedding.model, dimensions: config.embedding.dimensions, documents: documents.length, chunks: chunks.length, estimatedInputUSD, estimateBasis: "UTF-8 byte allowance; actual usage must be reported by the provider" };
  if (mode === "--dry-run") return { mode, ...summary };
  const maxUSD = Number(rawBudget);
  if (!Number.isFinite(maxUSD) || maxUSD <= 0 || estimatedInputUSD > maxUSD) throw new Error("A sufficient positive embedding budget is required before preparation.");
  if (env === process.env) {
    for (const file of [".env.development.local", ".env.local"]) {
      try { process.loadEnvFile(resolve(PROJECT_ROOT, file)); }
      catch (error) { if (error?.code !== "ENOENT") throw new Error("Local environment could not be loaded."); }
    }
  }
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is required locally; do not put the key in command arguments.");
  const plan = createPolicyIngestionPlan(documents, { documents: [], chunks: [] }, config);
  const usage = await generate(plan, config, apiKey, { env });
  const payloads = policyIngestionPayloads(plan, config);
  const payloadHash = createHash("sha256").update(JSON.stringify(payloads)).digest("hex");
  const inputTokens = Number.isSafeInteger(usage?.inputTokens) && usage.inputTokens >= 0 ? usage.inputTokens : null;
  const actualInputUSD = inputTokens === null ? null : inputTokens * EMBEDDING_INPUT_USD_PER_MILLION / 1_000_000;
  const artifact = { schemaVersion: 1, generatedAt: new Date().toISOString(), ...summary, maxUSD, inputTokens, actualInputUSD, payloadHash, payloads };
  if (write) {
    await mkdir(ARTIFACT_DIRECTORY, { recursive: true });
    await writeFile(resolve(ARTIFACT_DIRECTORY, "prepared-corpus.json"), JSON.stringify(artifact), "utf8");
  }
  return { mode, ...summary, inputTokens, actualInputUSD, payloadHash, databaseWrites: 0 };
}

const invokedPath = process.argv[1]?.replaceAll("\\", "/");
if (invokedPath && import.meta.url.endsWith(invokedPath)) {
  prepareOpenAIPolicyMigration().then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(error instanceof Error ? error.message : "Migration preparation failed."); process.exitCode = 1;
  });
}
