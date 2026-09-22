export function embeddingConfig(env = process.env) {
  const endpoint = env.AZURE_OPENAI_ENDPOINT?.trim();
  const apiKey = env.AZURE_OPENAI_API_KEY?.trim();
  const deployment = env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT?.trim();
  if (!endpoint && !apiKey && !deployment) return null;
  if (!endpoint || !apiKey || !deployment) {
    throw new Error(
      "AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, and AZURE_OPENAI_EMBEDDING_DEPLOYMENT must be configured together.",
    );
  }
  return {
    endpoint: endpoint.replace(/\/$/, ""),
    apiKey,
    deployment,
    apiVersion: env.AZURE_OPENAI_API_VERSION?.trim() || "2024-10-21",
  };
}

export async function createEmbedding(text, config = embeddingConfig()) {
  if (!config) return null;
  const response = await fetch(
    `${config.endpoint}/openai/deployments/${encodeURIComponent(config.deployment)}/embeddings?api-version=${encodeURIComponent(config.apiVersion)}`,
    {
      method: "POST",
      headers: { "api-key": config.apiKey, "content-type": "application/json" },
      body: JSON.stringify({ input: text }),
    },
  );
  if (!response.ok) throw new Error(`Embedding provider failed (${response.status}).`);
  const result = await response.json();
  const vector = result.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length !== 1536) {
    throw new Error("Embedding provider returned an unsupported vector dimension.");
  }
  return vector;
}
