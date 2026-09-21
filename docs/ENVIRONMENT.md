# Environment variables

`.env.example` is a non-secret template. Empty values are intentional until the corresponding implementation phase is authorized and configured.

| Variable                    | Used by                                       | Secret  |
| --------------------------- | --------------------------------------------- | ------- |
| `NODE_ENV`                  | All services                                  | No      |
| `LOG_LEVEL`                 | Backend/worker logging                        | No      |
| `SUPABASE_URL`              | Backend and auth integration                  | No      |
| `SUPABASE_ANON_KEY`         | Browser-safe Supabase client, if used         | No      |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend-only administrative operations        | **Yes** |
| `AZURE_SUBSCRIPTION_ID`     | Azure provisioning and discovery              | No      |
| `AZURE_TENANT_ID`           | Azure authentication                          | No      |
| `AZURE_RESOURCE_GROUP`      | Azure resource workflows                      | No      |
| `AZURE_AI_PROJECT_ENDPOINT` | Foundry project operations                    | No      |
| `AZURE_OPENAI_ENDPOINT`     | Model client configuration, if selected       | No      |
| `AZURE_OPENAI_API_KEY`      | Server-side model authentication, if selected | **Yes** |
| `WEB_ORIGIN`                | Backend CORS policy                           | No      |
| `API_PORT`                  | Backend listener                              | No      |

Use managed identity or the supported Azure/Supabase secret store in deployed environments. Never place secret values in source files, frontend bundles, Issues, or logs.
