export class FoundryNotConfiguredError extends Error {
  constructor() {
    super(
      "Microsoft Foundry is not configured. Set AZURE_AI_PROJECT_ENDPOINT and authorize a supported Foundry client before enabling hosted agents.",
    );
    this.code = "foundry_not_configured";
    this.status = 503;
  }
}

export function getFoundryConfig(env = process.env) {
  const endpoint = env.AZURE_AI_PROJECT_ENDPOINT?.trim();
  const agentName = env.AZURE_AI_AGENT_NAME?.trim();
  if (!endpoint || !agentName) return null;
  return { endpoint: endpoint.replace(/\/$/, ""), agentName };
}

function responseText(response) {
  if (typeof response?.output_text === "string") return response.output_text.trim();
  return (response?.output || [])
    .flatMap((item) => item?.content || [])
    .filter((item) => item?.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

function responseSources(response) {
  const sources = [];
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      for (const annotation of content?.annotations || []) {
        const documentId = annotation.file_id || annotation.document_id || annotation.source_id;
        const chunkId = annotation.chunk_id || annotation.id || annotation.file_id;
        if (!documentId || !chunkId) continue;
        sources.push({
          provider: "microsoft-foundry",
          documentId: String(documentId),
          chunkId: String(chunkId),
          ...(typeof annotation.quote === "string"
            ? { excerpt: annotation.quote.slice(0, 180) }
            : {}),
          ...(annotation.filename || annotation.url
            ? { citation: annotation.filename || annotation.url }
            : {}),
        });
      }
    }
  }
  return sources;
}

async function createClient(config) {
  const [{ AIProjectClient }, { DefaultAzureCredential }] = await Promise.all([
    import("@azure/ai-projects"),
    import("@azure/identity"),
  ]);
  const project = new AIProjectClient(config.endpoint, new DefaultAzureCredential());
  return project.getOpenAIClient();
}

export function createFoundryProvider(config = getFoundryConfig(), dependencies = {}) {
  if (!config?.endpoint || !config?.agentName) {
    return {
      mode: "local",
      configured: false,
      async run() {
        throw new FoundryNotConfiguredError();
      },
    };
  }
  return {
    mode: "foundry",
    configured: true,
    endpoint: config.endpoint,
    agentName: config.agentName,
    async run(input) {
      const client = dependencies.client || (await createClient(config));
      const response = await client.responses.create(
        { input: input.message },
        {
          body: {
            agent_reference: { name: config.agentName, type: "agent_reference" },
          },
        },
      );
      const answer = responseText(response);
      if (!answer) throw new Error("Microsoft Foundry returned an empty response.");
      return {
        answer,
        sources: responseSources(response),
        responseId: response.id,
      };
    },
  };
}
