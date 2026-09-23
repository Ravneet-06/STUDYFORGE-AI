# Environment variables

`.env.example` is a non-secret template. Empty values are intentional until the corresponding implementation phase is authorized and configured.

| Variable                            | Used by                                       | Secret  |
| ----------------------------------- | --------------------------------------------- | ------- |
| `NODE_ENV`                          | All services                                  | No      |
| `LOG_LEVEL`                         | Backend/worker logging                        | No      |
| `SUPABASE_URL`                      | Backend and auth integration                  | No      |
| `SUPABASE_ANON_KEY`                 | Browser-safe Supabase client, if used         | No      |
| `SUPABASE_SERVICE_ROLE_KEY`         | Backend-only administrative operations        | **Yes** |
| `AZURE_SUBSCRIPTION_ID`             | Azure provisioning and discovery              | No      |
| `AZURE_TENANT_ID`                   | Azure authentication                          | No      |
| `AZURE_RESOURCE_GROUP`              | Azure resource workflows                      | No      |
| `AZURE_AI_PROJECT_ENDPOINT`         | Foundry project operations                    | No      |
| `AZURE_AI_AGENT_NAME`               | Foundry agent reference                       | No      |
| `AZURE_OPENAI_ENDPOINT`             | Model client configuration, if selected       | No      |
| `AZURE_OPENAI_API_KEY`              | Server-side model authentication, if selected | **Yes** |
| `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | Azure OpenAI embedding deployment name        | No      |
| `AZURE_OPENAI_API_VERSION`          | Azure OpenAI embeddings API version           | No      |
| `WEB_ORIGIN`                        | Backend CORS policy                           | No      |
| `API_PORT`                          | Backend listener                              | No      |

Use managed identity or the supported Azure/Supabase secret store in deployed environments. Never place secret values in source files, frontend bundles, Issues, or logs.

When `SUPABASE_URL` and `SUPABASE_ANON_KEY` are both absent, the MVP uses local JSON persistence and the development identity header. When both are configured, API requests must include a Supabase Auth bearer token and database calls use that token so Postgres RLS applies. Partial Supabase configuration is rejected. The service-role key is not needed by the API and must never be sent to the browser. The application does not invent endpoints, keys, deployments, or model IDs.

When all three embedding variables (`AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, and `AZURE_OPENAI_EMBEDDING_DEPLOYMENT`) are configured, ingestion and retrieval use the Azure OpenAI embeddings endpoint and Supabase `pgvector` RPC. Without them, ingestion stores no fabricated vectors and uses the explicit lexical retrieval fallback.

## Hosted Foundry availability

The Azure for Students subscription was checked on 2026-09-22. Azure CLI authentication, the existing subscription, the `eastus` region, and resource-group permissions were available, but the subscription reported zero quota for the suitable GPT deployments. No Foundry account, project, model deployment, endpoint, or credential was created. The local frontend therefore identifies the active provider honestly as **Local fallback mode** until quota is explicitly granted and an authorized hosted deployment is configured.

## Microsoft Foundry agent integration

Set `AZURE_AI_PROJECT_ENDPOINT` to the project endpoint shown in the Microsoft Foundry project overview, for example `https://<resource>.services.ai.azure.com/api/projects/<project>`. Set `AZURE_AI_AGENT_NAME` to the published agent identifier; the configured StudyForge agent is `StudyForge-Study-Agent`. The backend uses the `@azure/ai-projects` v1 data-plane client and `DefaultAzureCredential` with Microsoft Entra ID. Use `az login` locally or the application's managed identity in Azure. No Foundry endpoint, credential, or token is sent to the browser.

When both values are present, assistant, summary, explanation, MCQ, and viva requests use the agent through the authenticated Foundry Responses API with an `agent_reference`. Progress remains local. If either value is absent, the existing local RAG and lexical/pgvector fallback remains active. Foundry source annotations are preserved when returned; responses without supported grounding are rejected by the existing reviewer and guardrails rather than treated as successful answers.
