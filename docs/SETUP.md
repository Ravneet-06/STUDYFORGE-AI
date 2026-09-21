# StudyForge AI foundation setup

## Selected MVP toolchain

| Area                   | Foundation choice                                 | Current status                               |
| ---------------------- | ------------------------------------------------- | -------------------------------------------- |
| Workspace              | npm workspaces on Node.js 22+                     | Configured                                   |
| Frontend               | Next.js with TypeScript                           | Selected for Phase 5                         |
| Backend API            | TypeScript service with Fastify                   | Selected for Phase 2                         |
| Ingestion worker       | TypeScript worker process                         | Selected for Phase 3                         |
| Unit/integration tests | Vitest                                            | Selected for implementation phases           |
| Browser tests          | Playwright                                        | Selected for the QA phase                    |
| Data and auth          | Supabase Auth and Postgres with RLS               | Requires a user-authorized project           |
| AI platform            | Microsoft Foundry and supported `azd` workflows   | Local tooling verified; no resources created |
| Retrieval              | Provider interface, initially Supabase `pgvector` | Requires the data phase                      |

The MVP runtime is a dependency-light Node.js HTTP server with a static browser client. It does not create Azure or Supabase resources.

## Prerequisites

- Node.js 22 or newer and npm 10 or newer
- Git and GitHub CLI
- Azure Developer CLI (`azd`) with the Microsoft Foundry extension for Foundry workflows
- Azure CLI (`az`) when Azure subscription/resource authentication is required

## Local checks

```powershell
npm install
npm run validate:foundation
npm run health:foundation
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run security:check
npm run build
```

These checks validate the workspace, required documentation, environment template, ignore rules, formatting, JavaScript lint rules, TypeScript configuration, foundation tests, dependency advisories, and obvious committed-secret patterns. They do not contact Azure or Supabase. The unit tests cover foundation invariants only; application behavior will be tested in later phases.

## Environment setup

Copy `.env.example` to `.env.local` only when a later phase needs local service configuration. `.env.local` and all other `.env.*` files except `.env.example` are ignored by Git. Never put service-role keys or model credentials in browser code, Issues, logs, or committed files.

## Foundry setup

The project-local Microsoft Foundry skill is stored in `.agents/skills/microsoft-foundry`. Before any Foundry workflow, run its Windows dependency check and read the matching sub-skill. The current foundation only verifies local tooling; it does not log in, provision a project, deploy a model, or create Azure resources.

## CI scope

The foundation CI workflow installs the lockfile and runs all five quality-check categories. Integration and browser-test jobs will be added with the corresponding application code in later Issues rather than pretending empty workspaces are tested.

## Start the local MVP

```powershell
npm start
```

Open `http://localhost:4000`. Local data is stored in `.data/` and is ignored by Git. Upload text or Markdown directly, paste notes, ask grounded questions, and generate study material from matching chunks.

PDF-like text can be pasted or supplied as extracted text in local mode. Production PDF/DOCX extraction, Supabase persistence, and Foundry model generation require the corresponding authorized provider work.
