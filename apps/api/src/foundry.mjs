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
  if (!endpoint) return null;
  return { endpoint: endpoint.replace(/\/$/, "") };
}

export function createFoundryProvider(config = getFoundryConfig()) {
  if (!config?.endpoint) {
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
    async run() {
      throw new FoundryNotConfiguredError();
    },
  };
}
