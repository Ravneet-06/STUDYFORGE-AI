# StudyForge AI foundation setup

## Selected MVP toolchain

| Area                   | Implemented MVP stack                           | Current status                                                      |
| ---------------------- | ----------------------------------------------- | ------------------------------------------------------------------- |
| Workspace              | npm workspaces on Node.js 22+                   | Configured                                                          |
| Frontend               | Static HTML/CSS/JS ES modules served by the API | Implemented                                                         |
| Backend API            | Dependency-light Node.js HTTP server            | Implemented                                                         |
| Ingestion              | In-process extraction, chunking, retrieval      | Implemented                                                         |
| Unit/integration tests | Vitest                                          | Implemented                                                         |
| End-to-end regression  | Deterministic local workflow test (`test:e2e`)  | Implemented                                                         |
| Browser automation     | Playwright                                      | Not added; manual browser checklist used                            |
| Data and auth          | Supabase Auth and Postgres with RLS             | Schema and client implemented; needs an authorized project          |
| AI platform            | Microsoft Foundry and supported `azd` workflows | Provider boundary implemented; live calls blocked by zero GPT quota |
| Retrieval              | Supabase `pgvector` RPC with lexical fallback   | Implemented with provider interface                                 |

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
npm run test:e2e
npm run evaluate:local
npm run security:check
npm run build
```

These checks validate the workspace, required documentation, environment template, ignore rules, formatting, JavaScript lint rules, TypeScript configuration, application behavior, dependency advisories, deterministic RAG/security evaluations, and obvious committed-secret patterns. They do not contact Azure or Supabase.

## Environment setup

Copy `.env.example` to `.env.local` only when a later phase needs local service configuration. `.env.local` and all other `.env.*` files except `.env.example` are ignored by Git. Never put service-role keys or model credentials in browser code, Issues, logs, or committed files.

To enable the Supabase path, configure both `SUPABASE_URL` and `SUPABASE_ANON_KEY` in a local, ignored environment file. The API validates the Authorization bearer header with Supabase Auth and forwards the same user token to PostgREST, where the migrations' RLS policies enforce ownership. No Supabase project is created or contacted until these values are supplied.

## Foundry setup

The project-local Microsoft Foundry skill is stored in `.agents/skills/microsoft-foundry`. Before any Foundry workflow, run its Windows dependency check and read the matching sub-skill. The current foundation only verifies local tooling; it does not log in, provision a project, deploy a model, or create Azure resources.

## CI scope

The foundation CI workflow installs the lockfile and runs all five quality-check categories. Integration and browser-test jobs will be added with the corresponding application code in later Issues rather than pretending empty workspaces are tested.

## Start the local MVP

```powershell
npm start
```

Open `http://localhost:4000`. `npm start` runs local JSON persistence and does **not** load
`.env.local`; use `npm run dev` to load `.env.local` and exercise the Supabase and Foundry provider
paths. Local data is stored in `.data/` and is ignored by Git. Upload text, Markdown, PDF, or DOCX
material, or paste notes, then ask grounded questions and generate summaries, explanations, MCQs, and
Viva practice.

PDF and DOCX extraction is implemented in-process (`pdf-parse` and `mammoth`) and requires no
external service. Supabase persistence, Azure OpenAI embeddings, and Foundry model generation
activate only when their authorized provider values are configured.
