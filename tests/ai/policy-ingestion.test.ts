import {
  applyPolicyIngestionPlan,
  createPolicyIngestionPlan,
  generatePolicyEmbeddings,
  hydrateReusablePolicyEmbeddings,
  readPolicyRemoteState,
  resolvePolicyIngestionEnvironment,
  runPolicyIngestion,
} from "../../scripts/ingest-policies.mjs";

const config = {
  embedding: {
    model: "gemini-embedding-2",
    dimensions: 3,
    documentInstructionVersion: "document-v1",
  },
};

function document(overrides: Record<string, unknown> = {}) {
  return {
    id: "pet-policy",
    title: "Pet policy",
    scope: "public",
    version: 2,
    effectiveDate: "2026-08-30",
    sourcePath: "content/policies/public/pet-policy.md",
    body: "Policy body",
    contentHash: "document-v2",
    chunks: [
      { chunkId: "pet-policy@2:001", chunkIndex: 0, headingPath: ["Pet policy", "Limits"], section: "Limits", content: "One dog.", contentHash: "same-chunk" },
      { chunkId: "pet-policy@2:002", chunkIndex: 1, headingPath: ["Pet policy", "Fee"], section: "Fee", content: "Fee applies.", contentHash: "new-chunk" },
    ],
    ...overrides,
  };
}

describe("policy ingestion", () => {
  it("plans an idempotent repeat without embedding or synchronization", async () => {
    const local = document({ version: 1, contentHash: "same-document" });
    const plan = createPolicyIngestionPlan([local], {
      documents: [{ document_id: "pet-policy", version: 1, content_hash: "same-document", is_current: true, embedding_model: "gemini-embedding-2", embedding_dimensions: 3 }],
      chunks: [],
    }, config);
    expect(plan.summary).toEqual({ insert: 0, update: 0, unchanged: 1, deactivate: 0, embed: 0, reuse: 0 });

    const generateEmbeddings = vi.fn();
    const applyPlan = vi.fn();
    await runPolicyIngestion({
      args: ["--apply"],
      env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_test", GOOGLE_GENERATIVE_AI_API_KEY: "google-secret" },
      clientFactory: vi.fn(() => ({})),
      loadDocuments: vi.fn(async () => ({ config, documents: [local] })),
      readRemoteState: vi.fn(async () => ({ documents: [{ document_id: "pet-policy", version: 1, content_hash: "same-document", is_current: true, embedding_model: "gemini-embedding-2", embedding_dimensions: 3 }], chunks: [] })),
      generateEmbeddings,
      applyPlan,
    } as never);
    expect(generateEmbeddings).toHaveBeenCalledOnce();
    expect(applyPlan).toHaveBeenCalledOnce();
    expect(generateEmbeddings.mock.calls[0][0].summary.embed).toBe(0);
    expect(applyPlan.mock.calls[0][1].documents[0].action).toBe("unchanged");
  });

  it("reuses matching vectors and embeds only changed chunks", async () => {
    const plan = createPolicyIngestionPlan([document()], {
      documents: [{ document_id: "pet-policy", version: 1, content_hash: "old-document", is_current: true, embedding_model: "gemini-embedding-2", embedding_dimensions: 3 }],
      chunks: [{ chunk_id: "old-pet-chunk", document_id: "pet-policy", document_version: 1, content_hash: "same-chunk", embedding_instruction_version: "document-v1" }],
    }, config);
    expect(plan.summary).toMatchObject({ update: 1, embed: 1, reuse: 1 });

    const inQuery = vi.fn(async () => ({ data: [{ chunk_id: "old-pet-chunk", embedding: "[0.1,0.2,0.3]" }], error: null }));
    const select = vi.fn(() => ({ in: inQuery }));
    await hydrateReusablePolicyEmbeddings({ from: vi.fn(() => ({ select })) }, plan, config);
    expect(select).toHaveBeenCalledWith("chunk_id,embedding");
    expect(inQuery).toHaveBeenCalledWith("chunk_id", ["old-pet-chunk"]);

    const embedValues = vi.fn(async ({ values, providerOptions }) => ({ embeddings: values.map(() => [0.4, 0.5, 0.6]), providerOptions }));
    await generatePolicyEmbeddings(plan, config, "google-secret", {
      createGoogleProvider: vi.fn(() => ({ embedding: vi.fn(() => "model") })),
      embedValues,
      fetch: vi.fn(),
      env: {},
    });
    expect(embedValues).toHaveBeenCalledOnce();
    expect(embedValues.mock.calls[0][0].values).toHaveLength(1);
    expect(embedValues.mock.calls[0][0].providerOptions.google).toEqual({ outputDimensionality: 3, taskType: "RETRIEVAL_DOCUMENT" });
    expect(plan.documents[0].chunks[0].embedding).toEqual([0.1, 0.2, 0.3]);
    expect(plan.documents[0].chunks[1].embedding).toEqual([0.4, 0.5, 0.6]);
  });

  it("fails before any current-version switch when embedding fails", async () => {
    const applyPlan = vi.fn();
    await expect(runPolicyIngestion({
      args: ["--apply"],
      env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_test", GOOGLE_GENERATIVE_AI_API_KEY: "google-secret" },
      clientFactory: vi.fn(() => ({})),
      loadDocuments: vi.fn(async () => ({ config, documents: [document()] })),
      readRemoteState: vi.fn(async () => ({ documents: [], chunks: [] })),
      generateEmbeddings: vi.fn(async () => { throw new Error("provider detail secret-value"); }),
      applyPlan,
    } as never)).rejects.toThrow("Policy embeddings could not be generated.");
    expect(applyPlan).not.toHaveBeenCalled();
    try {
      await runPolicyIngestion({
        args: ["--apply"],
        env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_test", GOOGLE_GENERATIVE_AI_API_KEY: "google-secret" },
        clientFactory: vi.fn(() => ({})),
        loadDocuments: vi.fn(async () => ({ config, documents: [document()] })),
        readRemoteState: vi.fn(async () => ({ documents: [], chunks: [] })),
        generateEmbeddings: vi.fn(async () => { throw new Error("provider detail secret-value [0.1,0.2,0.3]"); }),
      } as never);
    } catch (error) {
      expect(String(error)).not.toMatch(/secret-value|google-secret|0\.1/);
    }
  });

  it("keeps dry-run read-only and never invokes the embedding provider", async () => {
    const generateEmbeddings = vi.fn();
    const applyPlan = vi.fn();
    const result = await runPolicyIngestion({
      args: ["--dry-run"],
      env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_test" },
      clientFactory: vi.fn(() => ({})),
      loadDocuments: vi.fn(async () => ({ config, documents: [document()] })),
      readRemoteState: vi.fn(async () => ({ documents: [], chunks: [] })),
      generateEmbeddings,
      applyPlan,
    } as never);
    expect(result.mode).toBe("--dry-run");
    expect(generateEmbeddings).not.toHaveBeenCalled();
    expect(applyPlan).not.toHaveBeenCalled();
  });

  it("reads only metadata during remote planning", async () => {
    const selections: string[] = [];
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(async (selection: string) => {
          selections.push(selection);
          return { data: [], error: null };
        }),
      })),
    };
    await readPolicyRemoteState(client);
    expect(selections).toHaveLength(2);
    expect(selections[1]).not.toMatch(/(?:^|,)embedding(?:,|$)/);
    expect(selections[1]).toContain("embedding_instruction_version");
  });

  it("rejects publishable and anonymous credentials for apply without leaking them", () => {
    const secret = "sb_publishable_do-not-log";
    expect(() => resolvePolicyIngestionEnvironment({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: secret, GOOGLE_GENERATIVE_AI_API_KEY: "google-secret" }, true)).toThrow(/public or anonymous/i);
    try {
      resolvePolicyIngestionEnvironment({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: secret, GOOGLE_GENERATIVE_AI_API_KEY: "google-secret" }, true);
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it("requires a server-only credential for dry-run and rejects a public key", () => {
    expect(() => resolvePolicyIngestionEnvironment({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" }, false)).toThrow(/server-only.*dry-run/i);
    expect(() => resolvePolicyIngestionEnvironment({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: "sb_publishable_test" }, false)).toThrow(/public or anonymous.*dry-run/i);
  });

  it("sends each document through one atomic RPC and deactivates removed policies", async () => {
    const plan = createPolicyIngestionPlan([document()], { documents: [{ document_id: "removed-policy", version: 1, content_hash: "old", is_current: true, embedding_model: "gemini-embedding-2", embedding_dimensions: 3 }], chunks: [] }, config);
    plan.documents[0].chunks.forEach((chunk: { embedding?: number[] }) => { chunk.embedding = [0.1, 0.2, 0.3]; });
    const rpc = vi.fn(async (_name: string, _payload: Record<string, unknown>) => ({ error: null }));
    await applyPolicyIngestionPlan({ rpc }, plan, config);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0][0]).toBe("sync_policy_document");
    expect(rpc.mock.calls[1][1].document_payload).toEqual({ document_id: "removed-policy", deactivate: true });
  });

  it("requires a version bump when current content changes", () => {
    expect(() => createPolicyIngestionPlan([document({ version: 1 })], {
      documents: [{ document_id: "pet-policy", version: 1, content_hash: "old-document", is_current: true }],
      chunks: [],
    }, config)).toThrow(/version bump/i);
  });

  it("rejects conflicting historical versions and rollback before any provider or write", () => {
    const remote = {
      documents: [
        { document_id: "pet-policy", version: 1, content_hash: "historical", is_current: false },
        { document_id: "pet-policy", version: 3, content_hash: "latest", is_current: false },
      ],
      chunks: [],
    };
    expect(() => createPolicyIngestionPlan([document({ version: 1 })], remote, config)).toThrow(/version bump/i);
    expect(() => createPolicyIngestionPlan([document({ version: 1, contentHash: "historical" })], remote, config)).toThrow(/older version/i);
    expect(() => createPolicyIngestionPlan([document()], remote, config)).toThrow(/older version/i);
  });
});
