import process from "node:process";

import { createGoogle } from "@ai-sdk/google";
import { createClient } from "@supabase/supabase-js";
import { embedMany } from "ai";
import { fetch as undiciFetch, ProxyAgent } from "undici";

import { loadPolicyDocuments } from "./policy-content.mjs";

const MODES = new Set(["--dry-run", "--apply"]);

export function parsePolicyIngestionMode(args) {
  const modes = args.filter((argument) => MODES.has(argument));
  if (modes.length !== 1 || args.some((argument) => !MODES.has(argument))) {
    throw new Error("Use exactly one mode: --dry-run or --apply.");
  }
  return modes[0];
}

function loadLocalEnv() {
  for (const file of [".env.development.local", ".env.local"]) {
    try {
      process.loadEnvFile(file);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

function isLegacyServiceRoleJwt(value) {
  const segments = value.split(".");
  if (segments.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8"));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

export function resolvePolicyIngestionEnvironment(env, apply) {
  const url = env.SUPABASE_URL?.trim();
  const secretKey = (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!url) throw new Error("SUPABASE_URL is required.");

  if (!secretKey) throw new Error(`A server-only Supabase secret is required for ${apply ? "--apply" : "--dry-run"}.`);
  const knownPublicKeys = [env.SUPABASE_PUBLISHABLE_KEY, env.SUPABASE_KEY, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY]
    .map((value) => value?.trim())
    .filter(Boolean);
  if (
    secretKey.startsWith("sb_publishable_") ||
    /^(?:anon(?:ymous)?|publishable)(?:[-_:]|$)/i.test(secretKey) ||
    knownPublicKeys.includes(secretKey) ||
    (secretKey.split(".").length === 3 && !isLegacyServiceRoleJwt(secretKey))
  ) {
    throw new Error(`A public or anonymous Supabase key cannot be used for ${apply ? "--apply" : "--dry-run"}.`);
  }
  if (!apply) return { url, key: secretKey, googleKey: null };
  const googleKey = env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (!googleKey) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is required for --apply.");
  return { url, key: secretKey, googleKey };
}

function parseStoredEmbedding(value) {
  if (Array.isArray(value)) return value.map(Number);
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(Number) : null;
  } catch {
    return null;
  }
}

export async function readPolicyRemoteState(client) {
  const [{ data: documents, error: documentError }, { data: chunks, error: chunkError }] = await Promise.all([
    client.from("policy_documents").select("document_id,version,content_hash,is_current,embedding_model,embedding_dimensions"),
    client.from("policy_chunks").select("chunk_id,document_id,document_version,content_hash,embedding_instruction_version"),
  ]);
  if (documentError || chunkError) throw new Error("Policy database state could not be read.");
  return { documents: Array.isArray(documents) ? documents : [], chunks: Array.isArray(chunks) ? chunks : [] };
}

export function createPolicyIngestionPlan(localDocuments, remote, config) {
  const current = new Map(remote.documents.filter((row) => row.is_current).map((row) => [row.document_id, row]));
  const documentVersions = new Map(remote.documents.map((row) => [`${row.document_id}@${row.version}`, row]));
  const reusable = new Map();
  for (const row of remote.chunks) {
    const parent = documentVersions.get(`${row.document_id}@${row.document_version}`);
    if (
      parent?.embedding_model === config.embedding.model &&
      Number(parent?.embedding_dimensions) === config.embedding.dimensions &&
      row.embedding_instruction_version === config.embedding.documentInstructionVersion
    ) {
      reusable.set(`${row.content_hash}|${config.embedding.model}|${config.embedding.dimensions}|${config.embedding.documentInstructionVersion}`, row.chunk_id);
    }
  }

  const localIds = new Set(localDocuments.map((document) => document.id));
  const documents = localDocuments.map((document) => {
    const existing = current.get(document.id);
    const sameVersion = documentVersions.get(`${document.id}@${document.version}`);
    if (sameVersion && sameVersion.content_hash !== document.contentHash) {
      throw new Error(`Policy ${document.id} changed without a version bump.`);
    }
    if (remote.documents.some((row) => row.document_id === document.id && Number(row.version) > document.version)) {
      throw new Error(`Policy ${document.id} cannot reactivate an older version.`);
    }
    const unchanged = Number(existing?.version) === document.version && existing?.content_hash === document.contentHash;
    const chunks = document.chunks.map((chunk) => {
      const reuseSourceChunkId = reusable.get(`${chunk.contentHash}|${config.embedding.model}|${config.embedding.dimensions}|${config.embedding.documentInstructionVersion}`);
      return { ...chunk, reuseSourceChunkId, action: reuseSourceChunkId ? "reuse" : "embed" };
    });
    return { ...document, action: unchanged ? "unchanged" : existing ? "update" : "insert", chunks };
  });
  const deactivate = [...current.keys()].filter((documentId) => !localIds.has(documentId)).sort();
  const changedChunks = documents.filter((document) => document.action !== "unchanged").flatMap((document) => document.chunks);
  return {
    documents,
    deactivate,
    summary: {
      insert: documents.filter((document) => document.action === "insert").length,
      update: documents.filter((document) => document.action === "update").length,
      unchanged: documents.filter((document) => document.action === "unchanged").length,
      deactivate: deactivate.length,
      embed: changedChunks.filter((chunk) => chunk.action === "embed").length,
      reuse: changedChunks.filter((chunk) => chunk.action === "reuse").length,
    },
  };
}

export async function hydrateReusablePolicyEmbeddings(client, plan, config) {
  const reusableChunks = plan.documents
    .filter((document) => document.action !== "unchanged")
    .flatMap((document) => document.chunks.filter((chunk) => chunk.action === "reuse"));
  const sourceIds = [...new Set(reusableChunks.map((chunk) => chunk.reuseSourceChunkId).filter(Boolean))];
  if (!sourceIds.length) return;

  let response;
  try {
    response = await client.from("policy_chunks").select("chunk_id,embedding").in("chunk_id", sourceIds);
  } catch {
    throw new Error("Reusable policy embeddings could not be read.");
  }
  if (response.error) throw new Error("Reusable policy embeddings could not be read.");
  const embeddings = new Map();
  for (const row of Array.isArray(response.data) ? response.data : []) {
    const embedding = parseStoredEmbedding(row.embedding);
    if (embedding?.length === config.embedding.dimensions && embedding.every(Number.isFinite)) {
      embeddings.set(row.chunk_id, embedding);
    }
  }
  for (const chunk of reusableChunks) {
    const embedding = embeddings.get(chunk.reuseSourceChunkId);
    if (!embedding) throw new Error("Reusable policy embeddings could not be read.");
    chunk.embedding = embedding;
  }
}

function proxyAwareFetch(env) {
  const proxyUrl = [env.AI_HTTPS_PROXY, env.HTTPS_PROXY, env.HTTP_PROXY, env.https_proxy, env.http_proxy]
    .map((value) => value?.trim())
    .find(Boolean);
  if (!proxyUrl) return globalThis.fetch;
  let parsed;
  try { parsed = new URL(proxyUrl); } catch { return globalThis.fetch; }
  if (!["http:", "https:"].includes(parsed.protocol)) return globalThis.fetch;
  const dispatcher = new ProxyAgent(parsed.toString());
  return async (input, init) => undiciFetch(input, { ...init, dispatcher });
}

export async function generatePolicyEmbeddings(plan, config, apiKey, dependencies = {}) {
  const pending = plan.documents
    .filter((document) => document.action !== "unchanged")
    .flatMap((document) => document.chunks.filter((chunk) => chunk.action === "embed").map((chunk) => ({ document, chunk })));
  if (!pending.length) return;
  try {
    const google = (dependencies.createGoogleProvider ?? createGoogle)({ apiKey, fetch: dependencies.fetch ?? proxyAwareFetch(dependencies.env ?? process.env) });
    const result = await (dependencies.embedValues ?? embedMany)({
      model: google.embedding(config.embedding.model),
      values: pending.map(({ document, chunk }) => `${document.title}\n${chunk.section}\n${chunk.content}`),
      maxParallelCalls: 2,
      providerOptions: { google: { outputDimensionality: config.embedding.dimensions, taskType: "RETRIEVAL_DOCUMENT" } },
    });
    if (result.embeddings.length !== pending.length || result.embeddings.some((embedding) => embedding.length !== config.embedding.dimensions || embedding.some((item) => !Number.isFinite(item)))) {
      throw new Error("invalid embedding response");
    }
    pending.forEach(({ chunk }, index) => { chunk.embedding = result.embeddings[index]; });
  } catch {
    throw new Error("Policy embeddings could not be generated.");
  }
}

export async function applyPolicyIngestionPlan(client, plan, config) {
  for (const document of plan.documents.filter((item) => item.action !== "unchanged")) {
    if (document.chunks.some((chunk) => !Array.isArray(chunk.embedding))) throw new Error("Policy synchronization could not be prepared.");
    const { error } = await client.rpc("sync_policy_document", {
      document_payload: {
        document_id: document.id,
        version: document.version,
        title: document.title,
        scope: document.scope,
        effective_date: document.effectiveDate,
        source_path: document.sourcePath,
        content_hash: document.contentHash,
        embedding_model: config.embedding.model,
        embedding_dimensions: config.embedding.dimensions,
      },
      chunk_payloads: document.chunks.map((chunk) => ({
        chunk_id: chunk.chunkId,
        chunk_index: chunk.chunkIndex,
        heading_path: chunk.headingPath,
        section: chunk.section,
        content: chunk.content,
        content_hash: chunk.contentHash,
        embedding: chunk.embedding,
        embedding_instruction_version: config.embedding.documentInstructionVersion,
      })),
    });
    if (error) throw new Error("Policy database synchronization failed.");
  }
  for (const documentId of plan.deactivate) {
    const { error } = await client.rpc("sync_policy_document", { document_payload: { document_id: documentId, deactivate: true }, chunk_payloads: [] });
    if (error) throw new Error("Policy database synchronization failed.");
  }
}

export async function runPolicyIngestion({
  args = process.argv.slice(2),
  env = process.env,
  clientFactory = createClient,
  loadDocuments = loadPolicyDocuments,
  readRemoteState = readPolicyRemoteState,
  hydrateReusableEmbeddings = hydrateReusablePolicyEmbeddings,
  generateEmbeddings = generatePolicyEmbeddings,
  applyPlan = applyPolicyIngestionPlan,
} = {}) {
  const mode = parsePolicyIngestionMode(args);
  if (env === process.env) loadLocalEnv();
  const runtime = resolvePolicyIngestionEnvironment(env, mode === "--apply");
  const { config, documents } = await loadDocuments();
  let client;
  try {
    client = clientFactory(runtime.url, runtime.key, { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } });
  } catch {
    throw new Error("The policy database client could not be created.");
  }
  let remote;
  try {
    remote = await readRemoteState(client);
  } catch {
    throw new Error("Policy database state could not be read.");
  }
  const plan = createPolicyIngestionPlan(documents, remote, config);
  if (mode === "--apply") {
    try {
      await hydrateReusableEmbeddings(client, plan, config);
    } catch {
      throw new Error("Reusable policy embeddings could not be read.");
    }
    try {
      await generateEmbeddings(plan, config, runtime.googleKey, { env });
    } catch {
      throw new Error("Policy embeddings could not be generated.");
    }
    try {
      await applyPlan(client, plan, config);
    } catch {
      throw new Error("Policy database synchronization failed.");
    }
  }
  return { mode, summary: plan.summary };
}

const invokedPath = process.argv[1]?.replaceAll("\\", "/");
if (invokedPath && import.meta.url.endsWith(invokedPath)) {
  runPolicyIngestion().then(({ mode, summary }) => {
    console.log(`Policy ingest ${mode}: ${JSON.stringify(summary)}`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "Policy ingestion failed.");
    process.exitCode = 1;
  });
}
