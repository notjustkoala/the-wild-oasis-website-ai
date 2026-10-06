export function policyEmbeddingProfile(config, env = process.env) {
  const provider = env.AI_POLICY_PROVIDER?.trim().toLowerCase() || (env.AI_PROVIDER?.trim().toLowerCase() === "dashscope" ? "dashscope" : "openai");
  if (provider !== "openai" && provider !== "dashscope") throw new Error("AI_POLICY_PROVIDER must be openai or dashscope.");
  const embedding = provider === "openai" ? config.embedding : config.embeddingProfiles?.dashscope;
  const model = provider === "openai" ? "text-embedding-3-small" : "text-embedding-v4";
  if (embedding?.model !== model || embedding.dimensions !== 768 || typeof embedding.documentInstructionVersion !== "string" || typeof embedding.queryInstructionVersion !== "string") throw new Error("Policy embedding profile is invalid.");
  return { provider, embedding };
}

export function policyRetrievalConfiguration(config, env = process.env) {
  const { provider } = policyEmbeddingProfile(config, env);
  return { ...config.retrieval, ...(provider === "dashscope" ? config.retrievalProfiles?.dashscope : {}) };
}
