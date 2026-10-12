import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Inspect only route metadata. Never print the manifest's preview credentials.
const output = process.env.NEXT_BUILD_OUTPUT_DIR || ".next";
const manifest = JSON.parse(await readFile(resolve(output, "prerender-manifest.json"), "utf8"));
for (const route of ["/", "/about"]) {
  assert.ok(manifest.routes[route], `${route} must be prerendered`);
  assert.equal(manifest.routes[route].initialRevalidateSeconds, false, `${route} must use SSG`);
}
assert.equal(manifest.routes["/cabins"]?.initialRevalidateSeconds, 3600, "Cabin catalogue must use one-hour ISR");
const cabins = Object.entries(manifest.routes).filter(([route]) => /^\/cabins\/\d+$/.test(route));
assert.ok(cabins.length > 0, "generateStaticParams must produce real cabin pages");
for (const [route, metadata] of cabins) {
  assert.equal(metadata.initialRevalidateSeconds, 3600, `${route} must use ISR`);
}
const home = await readFile(resolve(output, "server/app/index.html"), "utf8");
const catalogue = await readFile(resolve(output, "server/app/cabins.html"), "utf8");
assert.ok(home.includes("Welcome to paradise."), "Home must contain its prerendered content");
assert.ok(catalogue.includes("Details &amp; reservation"), "Cabin cards must exist in static HTML, not just a client placeholder");
for (const route of ["/api/guest/session", "/api/cabins/[cabinId]/availability"]) {
  assert.equal(manifest.routes[route], undefined, `${route} must not be prerendered`);
}
process.stdout.write(JSON.stringify({ home: "SSG", about: "SSG", catalogue: "ISR 3600s", cabinPages: cabins.length, dynamicGuestReads: true }) + "\n");
