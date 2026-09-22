import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const skippedDirectories = new Set([
  ".git",
  ".next",
  ".next-e2e",
  "coverage",
  "dist",
  "node_modules",
  "output",
  "test-results",
]);

async function collectMarkdown(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectMarkdown(absolute)));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) files.push(absolute);
  }
  return files;
}

function localDestinations(markdown) {
  const withoutFences = markdown.replace(/```[\s\S]*?```/g, "");
  const destinations = [];
  const pattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of withoutFences.matchAll(pattern)) {
    const raw = match[1].trim();
    const destination = raw.startsWith("<")
      ? raw.slice(1, raw.indexOf(">"))
      : raw.split(/\s+["']/)[0];
    if (!destination || destination.startsWith("#")) continue;
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(destination)) continue;
    destinations.push(destination.split("#", 1)[0].split("?", 1)[0]);
  }
  return destinations.filter(Boolean);
}

const failures = [];
const markdownFiles = await collectMarkdown(root);
let checked = 0;

for (const markdownFile of markdownFiles) {
  const markdown = await readFile(markdownFile, "utf8");
  for (const encodedDestination of localDestinations(markdown)) {
    checked += 1;
    let destination;
    try {
      destination = decodeURIComponent(encodedDestination);
    } catch {
      failures.push(`${path.relative(root, markdownFile)} -> invalid URI: ${encodedDestination}`);
      continue;
    }
    const target = destination.startsWith("/")
      ? path.join(root, destination.slice(1))
      : path.resolve(path.dirname(markdownFile), destination);
    try {
      await stat(target);
    } catch {
      failures.push(`${path.relative(root, markdownFile)} -> ${encodedDestination}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`Markdown link check failed (${failures.length}/${checked} local links):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`Markdown link check passed: ${checked} local links across ${markdownFiles.length} files.`);
}
