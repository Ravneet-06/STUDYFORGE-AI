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
| `GITHUB_TOKEN`                      | Development workflow tracker (read-only use)  | **Yes** |
| `GITHUB_REPOSITORY`                 | Development workflow tracker target           | No      |

Use managed identity or the supported Azure/Supabase secret store in deployed environments. Never place secret values in source files, frontend bundles, Issues, or logs.

`npm start` runs local JSON persistence and does not read `.env.local`. Use `npm run dev` (which
passes `--env-file=.env.local`) or export the variables in your shell to exercise the Supabase and
Foundry provider paths.

`GITHUB_TOKEN` and `GITHUB_REPOSITORY` are optional and only enable the workflow tracker's read-only
repository awareness. The application never creates, closes, or deletes GitHub Issues automatically;
automatic mutation stays disabled until a write integration is explicitly authorized.

When `SUPABASE_URL` and `SUPABASE_ANON_KEY` are both absent, the MVP uses local JSON persistence and the development identity header. When both are configured, API requests must include a Supabase Auth bearer token and database calls use that token so Postgres RLS applies. Partial Supabase configuration is rejected. The service-role key is not needed by the API and must never be sent to the browser. The application does not invent endpoints, keys, deployments, or model IDs.

When all three embedding variables (`AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, and `AZURE_OPENAI_EMBEDDING_DEPLOYMENT`) are configured, ingestion and retrieval use the Azure OpenAI embeddings endpoint and Supabase `pgvector` RPC. Without them, ingestion stores no fabricated vectors and uses the explicit lexical retrieval fallback.

## Supabase migrations

Apply every migration in `supabase/migrations/` (in order) to the project before using the Supabase
provider path, for example with `supabase db push` or by running the SQL files in the SQL editor:

```powershell
supabase link --project-ref <project-ref>
supabase db push
```

The API writes only real column names (`snake_case`), and it additionally tolerates a database whose
migrations are not fully applied: if PostgREST rejects a write because a column does not exist yet
(`PGRST204`, "Could not find the 'x' column ... in the schema cache"), the API logs
`supabase.schema_drift`, stops sending that column, and retries once so the user's study action still
succeeds. Real failures (RLS denials, validation errors, network errors) are never masked. Progress
activity recording is also non-fatal: if the `progress` write fails for any reason, the primary study
action still returns successfully and the failure is logged as `progress.record_failed`.

## Hosted Foundry availability

The Azure for Students subscription was checked on 2026-09-22. Azure CLI authentication, the existing subscription, the `eastus` region, and resource-group permissions were available, but the subscription reported zero quota for the suitable GPT deployments. No Foundry account, project, model deployment, endpoint, or credential was created. The local frontend therefore identifies the active provider honestly as **Local fallback mode** until quota is explicitly granted and an authorized hosted deployment is configured.

## Microsoft Foundry agent integration

Set `AZURE_AI_PROJECT_ENDPOINT` to the project endpoint shown in the Microsoft Foundry project overview, for example `https://<resource>.services.ai.azure.com/api/projects/<project>`. Set `AZURE_AI_AGENT_NAME` to the published agent identifier; the configured StudyForge agent is `StudyForge-Study-Agent`. The backend uses the `@azure/ai-projects` v1 data-plane client and `DefaultAzureCredential` with Microsoft Entra ID. Use `az login` locally or the application's managed identity in Azure. No Foundry endpoint, credential, or token is sent to the browser.

When both values are present, assistant, summary, explanation, MCQ, and viva requests use the agent through the authenticated Foundry Responses API with an `agent_reference`. Progress remains local. If either value is absent, the existing local RAG and lexical/pgvector fallback remains active. The authenticated Supabase RAG context is supplied to Foundry, and verified Supabase chunk references—not provider-specific citation markers—are returned as evidence. Responses without supported grounding are rejected by the existing reviewer and guardrails rather than treated as successful answers.
