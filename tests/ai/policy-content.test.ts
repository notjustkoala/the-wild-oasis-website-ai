import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  loadPolicyConfig,
  loadPolicyDocuments,
  parsePolicyDocument,
} from "../../scripts/policy-content.mjs";

const source = (metadata = "", body = "## Rules\n\nA stable policy paragraph.") => `---
id: test-policy
title: Test policy
scope: public
version: 1
effectiveDate: 2026-08-30${metadata}
---

${body}
`;

describe("policy content", () => {
  it("loads the seven governed documents with integer versions and stable chunks", async () => {
    const first = await loadPolicyDocuments();
    const second = await loadPolicyDocuments();
    expect(first.documents).toHaveLength(7);
    expect(first.documents.every((document) => Number.isInteger(document.version) && document.version > 0)).toBe(true);
    expect(first.documents.map((document) => document.contentHash)).toEqual(second.documents.map((document) => document.contentHash));
    expect(first.documents.flatMap((document) => document.chunks.map((chunk) => chunk.chunkId))).toEqual(second.documents.flatMap((document) => document.chunks.map((chunk) => chunk.chunkId)));
  });

  it("rejects unknown, duplicate, non-scalar, invalid-date, and non-integer metadata", async () => {
    const config = await loadPolicyConfig();
    expect(() => parsePolicyDocument(source("\nowner: ops"), "content/policies/public/test-policy.md", config)).toThrow(/unknown/i);
    expect(() => parsePolicyDocument(source("\nid: duplicate"), "content/policies/public/test-policy.md", config)).toThrow(/duplicate/i);
    expect(() => parsePolicyDocument(source().replace("title: Test policy", "title: [nested]"), "content/policies/public/test-policy.md", config)).toThrow(/plain scalars/i);
    expect(() => parsePolicyDocument(source().replace("2026-08-30", "2026-02-31"), "content/policies/public/test-policy.md", config)).toThrow(/effectivedate/i);
    expect(() => parsePolicyDocument(source().replace("version: 1", "version: 1.0.0"), "content/policies/public/test-policy.md", config)).toThrow(/positive integer/i);
  });

  it("rejects directory scope mismatches, filename mismatches, missing H2, and public staff terminology", async () => {
    const config = await loadPolicyConfig();
    expect(() => parsePolicyDocument(source(), "content/policies/staff/test-policy.md", config)).toThrow(/scope/i);
    expect(() => parsePolicyDocument(source(), "content/policies/public/wrong.md", config)).toThrow(/file name/i);
    expect(() => parsePolicyDocument(source("", "No heading."), "content/policies/public/test-policy.md", config)).toThrow(/h2/i);
    expect(() => parsePolicyDocument(source("", "## Rules\n\nEscalate to staff."), "content/policies/public/test-policy.md", config)).toThrow(/staff-only/i);
    for (const internalText of ["Manager approval is required.", "Use the employee-only queue.", "Follow the private workflow.", "Send this to the back office."]) {
      expect(() => parsePolicyDocument(source("", `## Rules\n\n${internalText}`), "content/policies/public/test-policy.md", config)).toThrow(/staff-only/i);
    }
  });

  it("bounds long overlapping chunks and hashes instruction versions", async () => {
    const config = await loadPolicyConfig();
    const longText = `${"paragraph policy text ".repeat(90)}\n\n${"second paragraph ".repeat(90)}`;
    const document = parsePolicyDocument(source("", `## Rules\n\n${longText}`), "content/policies/public/test-policy.md", config);
    expect(document.chunks.length).toBeGreaterThan(2);
    expect(document.chunks.every((chunk) => chunk.content.length <= config.chunking.maxCharacters)).toBe(true);
    const changed = structuredClone(config);
    changed.embedding.queryInstructionVersion = "policy-query-v2";
    expect(parsePolicyDocument(source(), "content/policies/public/test-policy.md", changed).contentHash).not.toBe(parsePolicyDocument(source(), "content/policies/public/test-policy.md", config).contentHash);
  });

  it("checks public titles and IDs for internal terminology", async () => {
    const config = await loadPolicyConfig();
    expect(() => parsePolicyDocument(source().replace("title: Test policy", "title: Staff SOP"), "content/policies/public/test-policy.md", config)).toThrow(/staff-only/i);
    expect(() => parsePolicyDocument(source().replace("id: test-policy", "id: staff-policy"), "content/policies/public/staff-policy.md", config)).toThrow(/staff-only/i);
  });

  it("invalidates reused embeddings when their title input changes", async () => {
    const config = await loadPolicyConfig();
    const original = parsePolicyDocument(source(), "content/policies/public/test-policy.md", config);
    const renamed = parsePolicyDocument(source().replace("title: Test policy", "title: Revised policy").replace("version: 1", "version: 2"), "content/policies/public/test-policy.md", config);
    expect(renamed.chunks[0].contentHash).not.toBe(original.chunks[0].contentHash);
  });

  it("rejects duplicate IDs across the content tree", async () => {
    const root = await mkdtemp(join(tmpdir(), "policy-content-"));
    await mkdir(join(root, "content", "policies", "public"), { recursive: true });
    await writeFile(join(root, "policy-rag.config.json"), JSON.stringify(await loadPolicyConfig()));
    await writeFile(join(root, "content", "policies", "public", "test-policy.md"), source());
    await writeFile(join(root, "content", "policies", "public", "duplicate.md"), source().replace("id: test-policy", "id: duplicate"));
    const first = await loadPolicyDocuments({ root });
    expect(first.documents).toHaveLength(2);
    await writeFile(join(root, "content", "policies", "public", "duplicate.md"), source());
    await expect(loadPolicyDocuments({ root })).rejects.toThrow(/file name|duplicate/i);
  });
});
