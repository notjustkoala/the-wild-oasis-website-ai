import process from "node:process";

import { createClient } from "@supabase/supabase-js";

const STAFF_DOCUMENT_ID = "exception-handling-sop";
const EMBEDDING_DIMENSIONS = 768;

function loadLocalEnv() {
  for (const file of [".env.development.local", ".env.local"]) {
    try {
      process.loadEnvFile(file);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

function createServerClient(url, key) {
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

function requireEnvironment() {
  const url = process.env.SUPABASE_URL?.trim();
  const publishableKey = (
    process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_KEY
  )?.trim();
  const secretKey = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();

  if (!url || !publishableKey || !secretKey) {
    throw new Error(
      "SUPABASE_URL, a publishable key, and a server-only secret are required."
    );
  }
  if (publishableKey === secretKey) {
    throw new Error("The guest and server-only Supabase keys must be different.");
  }

  return { url, publishableKey, secretKey };
}

function assertNoError(error) {
  if (error) throw new Error("The remote policy access check failed.");
}

export async function verifyPolicyAccess({ guestClient, serviceClient }) {
  const { data: serviceDocuments, error: serviceDocumentError } =
    await serviceClient
      .from("policy_documents")
      .select("document_id,scope,is_current")
      .eq("document_id", STAFF_DOCUMENT_ID)
      .eq("is_current", true);
  assertNoError(serviceDocumentError);

  if (
    serviceDocuments?.length !== 1 ||
    serviceDocuments[0]?.scope !== "staff"
  ) {
    throw new Error("The current staff policy document is missing remotely.");
  }

  const { count: serviceChunkCount, error: serviceChunkError } =
    await serviceClient
      .from("policy_chunks")
      .select("chunk_id", { count: "exact", head: true })
      .eq("document_id", STAFF_DOCUMENT_ID);
  assertNoError(serviceChunkError);
  if (!serviceChunkCount) {
    throw new Error("The staff policy document has no remote chunks.");
  }

  const { data: guestDocuments, error: guestDocumentError } = await guestClient
    .from("policy_documents")
    .select("document_id,scope")
    .eq("document_id", STAFF_DOCUMENT_ID);
  assertNoError(guestDocumentError);
  if (guestDocuments?.length) {
    throw new Error("The guest role can read staff policy metadata.");
  }

  const { count: guestChunkCount, error: guestChunkError } = await guestClient
    .from("policy_chunks")
    .select("chunk_id", { count: "exact", head: true })
    .eq("document_id", STAFF_DOCUMENT_ID);
  assertNoError(guestChunkError);
  if (guestChunkCount !== 0) {
    throw new Error("The guest role can read staff policy chunks.");
  }

  // Exercise the exact SECURITY INVOKER RPC exposed to the concierge. The
  // synthetic non-zero vector avoids an embedding-provider call; this check is
  // about database visibility, not ranking quality.
  const queryEmbedding = Array.from(
    { length: EMBEDDING_DIMENSIONS },
    (_, index) => (index === 0 ? 1 : 0)
  );
  const { data: guestMatches, error: guestRpcError } = await guestClient.rpc(
    "match_policy_chunks",
    {
      query_text: "exception handling SOP",
      query_embedding: queryEmbedding,
      result_count: 6,
      minimum_similarity: 0,
    }
  );
  assertNoError(guestRpcError);
  if (
    !Array.isArray(guestMatches) ||
    guestMatches.some(
      (match) =>
        match?.scope !== "public" ||
        match?.document_id === STAFF_DOCUMENT_ID
    )
  ) {
    throw new Error("The guest policy RPC exposed a staff policy result.");
  }

  return {
    staffDocuments: serviceDocuments.length,
    staffChunks: serviceChunkCount,
    guestVisibleStaffDocuments: guestDocuments?.length ?? 0,
    guestVisibleStaffChunks: guestChunkCount,
    guestRpcStaffMatches: 0,
  };
}

const invokedPath = process.argv[1]?.replaceAll("\\", "/");
if (invokedPath && import.meta.url.endsWith(invokedPath)) {
  loadLocalEnv();
  try {
    const { url, publishableKey, secretKey } = requireEnvironment();
    const result = await verifyPolicyAccess({
      guestClient: createServerClient(url, publishableKey),
      serviceClient: createServerClient(url, secretKey),
    });
    console.log(`Policy access verified: ${JSON.stringify(result)}`);
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "The remote policy access check failed."
    );
    process.exitCode = 1;
  }
}
