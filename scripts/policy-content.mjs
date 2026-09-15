import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(SCRIPT_DIR, "..");
export const POLICY_ROOT = join(PROJECT_ROOT, "content", "policies");
const ALLOWED_FIELDS = new Set(["id", "title", "scope", "version", "effectiveDate"]);
const PUBLIC_ONLY_FORBIDDEN = /\b(?:admin(?:istrator)?|back[ -]?office|employee[ -]?only|escalat(?:e|ion|ed)|internal|manager(?:ial)? approval|private workflow|staff|sop)\b/i;

export function normalizePolicyText(value) {
  return value.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim();
}

export function hashPolicyValue(value) {
  return createHash("sha256").update(normalizePolicyText(value), "utf8").digest("hex");
}

export async function loadPolicyConfig(root = PROJECT_ROOT) {
  const config = JSON.parse(await readFile(join(root, "policy-rag.config.json"), "utf8"));
  if (config?.embedding?.model !== "gemini-embedding-2" || config?.embedding?.dimensions !== 768) {
    throw new Error("Policy embedding configuration must use gemini-embedding-2 with 768 dimensions.");
  }
  const { maxCharacters, overlapCharacters } = config.chunking ?? {};
  if (!Number.isInteger(maxCharacters) || maxCharacters < 300 || maxCharacters > 2_000) {
    throw new Error("chunking.maxCharacters must be an integer from 300 to 2000.");
  }
  if (!Number.isInteger(overlapCharacters) || overlapCharacters < 0 || overlapCharacters >= maxCharacters) {
    throw new Error("chunking.overlapCharacters must be smaller than maxCharacters.");
  }
  const retrieval = config.retrieval ?? {};
  if (!Number.isInteger(retrieval.matchCount) || retrieval.matchCount < 1 || retrieval.matchCount > 10) {
    throw new Error("retrieval.matchCount must be an integer from 1 to 10.");
  }
  if (typeof retrieval.minimumSemanticSimilarity !== "number" || retrieval.minimumSemanticSimilarity < 0 || retrieval.minimumSemanticSimilarity > 1) {
    throw new Error("retrieval.minimumSemanticSimilarity must be between 0 and 1.");
  }
  if (typeof retrieval.maximumSemanticDistanceFromBest !== "number" || retrieval.maximumSemanticDistanceFromBest < 0 || retrieval.maximumSemanticDistanceFromBest > 1) {
    throw new Error("retrieval.maximumSemanticDistanceFromBest must be between 0 and 1.");
  }
  return config;
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseFrontMatter(source, sourcePath) {
  const normalized = source.replace(/\r\n?/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(normalized);
  if (!match) throw new Error(`${sourcePath}: expected YAML front matter enclosed by ---.`);
  const metadata = {};
  for (const line of match[1].split("\n")) {
    const field = /^([A-Za-z][A-Za-z0-9]*):\s*(.*?)\s*$/.exec(line);
    if (!field) throw new Error(`${sourcePath}: invalid front matter line.`);
    const [, key, value] = field;
    if (!ALLOWED_FIELDS.has(key)) throw new Error(`${sourcePath}: unknown front matter field "${key}".`);
    if (Object.hasOwn(metadata, key)) throw new Error(`${sourcePath}: duplicate front matter field "${key}".`);
    if (/^[\[{]|[\]}]$/.test(value) || /^['"]|['"]$/.test(value)) {
      throw new Error(`${sourcePath}: front matter values must be plain scalars.`);
    }
    metadata[key] = value;
  }
  for (const key of ALLOWED_FIELDS) {
    if (!metadata[key]) throw new Error(`${sourcePath}: missing front matter field "${key}".`);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.id)) throw new Error(`${sourcePath}: invalid policy id.`);
  if (!/^[1-9]\d*$/.test(metadata.version)) throw new Error(`${sourcePath}: version must be a positive integer.`);
  if (!isIsoDate(metadata.effectiveDate)) {
    throw new Error(`${sourcePath}: effectiveDate must be YYYY-MM-DD.`);
  }
  if (metadata.scope !== "public" && metadata.scope !== "staff") throw new Error(`${sourcePath}: invalid scope.`);
  return { metadata: { ...metadata, version: Number(metadata.version) }, body: normalizePolicyText(match[2]) };
}

function splitSections(body, sourcePath) {
  const headings = [...body.matchAll(/^##\s+(.+)$/gm)];
  if (!headings.length) throw new Error(`${sourcePath}: at least one stable H2 section is required.`);
  const preamble = body.slice(0, headings[0].index).trim();
  if (preamble) throw new Error(`${sourcePath}: content before the first H2 is not allowed.`);
  return headings.map((heading, index) => {
    const start = heading.index + heading[0].length;
    const end = headings[index + 1]?.index ?? body.length;
    const content = normalizePolicyText(body.slice(start, end));
    if (!content) throw new Error(`${sourcePath}: H2 "${heading[1]}" is empty.`);
    return { heading: heading[1].trim(), content };
  });
}

function splitLongText(text, maxCharacters, overlapCharacters) {
  const chunks = [];
  const normalized = normalizePolicyText(text);
  let offset = 0;
  while (offset < normalized.length) {
    const hardEnd = Math.min(offset + maxCharacters, normalized.length);
    let end = hardEnd;
    if (hardEnd < normalized.length) {
      const window = normalized.slice(offset, hardEnd);
      const paragraphBreak = window.lastIndexOf("\n\n");
      const sentenceBreak = Math.max(window.lastIndexOf(". "), window.lastIndexOf("。"));
      const wordBreak = window.lastIndexOf(" ");
      const preferred = Math.max(paragraphBreak >= maxCharacters * 0.5 ? paragraphBreak + 2 : -1, sentenceBreak >= maxCharacters * 0.6 ? sentenceBreak + 1 : -1, wordBreak >= maxCharacters * 0.75 ? wordBreak : -1);
      if (preferred > 0) end = offset + preferred;
    }
    const chunk = normalized.slice(offset, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= normalized.length) break;
    const nextOffset = Math.max(end - overlapCharacters, offset + 1);
    offset = nextOffset;
    while (offset < end && /\s/.test(normalized[offset])) offset += 1;
  }
  return chunks;
}

export function parsePolicyDocument(source, sourcePath, config) {
  const { metadata, body } = parseFrontMatter(source, sourcePath);
  const normalizedPath = sourcePath.split(sep).join("/");
  const expectedScope = normalizedPath.includes("/staff/") ? "staff" : normalizedPath.includes("/public/") ? "public" : null;
  if (!expectedScope || metadata.scope !== expectedScope) throw new Error(`${sourcePath}: scope does not match its directory.`);
  if (basename(normalizedPath, ".md") !== metadata.id) throw new Error(`${sourcePath}: policy id must match the file name.`);
  if (metadata.scope === "public" && PUBLIC_ONLY_FORBIDDEN.test(`${metadata.id}\n${metadata.title}\n${body}`)) {
    throw new Error(`${sourcePath}: public policy contains staff-only terminology.`);
  }
  const sections = splitSections(body, sourcePath);
  const chunks = sections.flatMap(({ heading, content }) =>
    splitLongText(content, config.chunking.maxCharacters, config.chunking.overlapCharacters)
      .map((chunkContent) => ({ heading, content: chunkContent }))
  ).map((chunk, chunkIndex) => ({
    chunkId: `${metadata.id}@${metadata.version}:${String(chunkIndex + 1).padStart(3, "0")}`,
    chunkIndex,
    headingPath: [metadata.title, chunk.heading],
    section: chunk.heading,
    content: chunk.content,
    contentHash: hashPolicyValue(JSON.stringify({
      title: metadata.title,
      content: chunk.content,
      heading: chunk.heading,
      chunkingVersion: config.chunking.version,
      documentInstructionVersion: config.embedding.documentInstructionVersion,
      queryInstructionVersion: config.embedding.queryInstructionVersion,
    })),
  }));
  const normalizedMetadata = {
    id: metadata.id,
    title: metadata.title,
    scope: metadata.scope,
    version: metadata.version,
    effectiveDate: metadata.effectiveDate,
  };
  const contentHash = hashPolicyValue(JSON.stringify({ metadata: normalizedMetadata, body, config: {
    chunkingVersion: config.chunking.version,
    documentInstructionVersion: config.embedding.documentInstructionVersion,
    queryInstructionVersion: config.embedding.queryInstructionVersion,
    model: config.embedding.model,
    dimensions: config.embedding.dimensions,
  } }));
  return { ...metadata, sourcePath: normalizedPath, body, contentHash, chunks };
}

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
  }
  return files;
}

export async function loadPolicyDocuments({ root = PROJECT_ROOT, policyRoot = join(root, "content", "policies") } = {}) {
  const config = await loadPolicyConfig(root);
  const files = await markdownFiles(policyRoot);
  const documents = [];
  const ids = new Set();
  const versions = new Set();
  for (const file of files) {
    const sourcePath = relative(root, file);
    const document = parsePolicyDocument(await readFile(file, "utf8"), sourcePath, config);
    const versionKey = `${document.id}@${document.version}`;
    if (ids.has(document.id)) throw new Error(`${sourcePath}: duplicate policy id "${document.id}".`);
    if (versions.has(versionKey)) throw new Error(`${sourcePath}: duplicate policy version "${versionKey}".`);
    ids.add(document.id);
    versions.add(versionKey);
    documents.push(document);
  }
  if (!documents.length) throw new Error("No policy documents were found.");
  return { config, documents: documents.sort((a, b) => a.id.localeCompare(b.id)) };
}
