# StudyForge AI

StudyForge AI is an autonomous multi-agent AI study platform built with Microsoft Azure AI Foundry, retrieval-augmented generation (RAG), the Model Context Protocol (MCP), Supabase, and GitHub-driven AI development.

## Project status

The repository contains a runnable, tested local MVP vertical slice. It includes a responsive study
dashboard with real persisted metrics, document ingestion (PDF/DOCX/Markdown/text), grounded
retrieval-augmented answers with evidence, grounded summaries and explanations, grounded MCQs with
persisted quizzes and attempts, assessed Viva answers with verdicts and reference answers,
server-derived cumulative progress, study plans, guardrails, logical agent routing,
MCP tool validation, a Supabase schema with RLS, and a Microsoft Foundry provider boundary.

Every response is grounded in the authenticated user's own material; unsupported questions are
explicitly refused instead of fabricated.

## Vision

StudyForge AI will help learners understand, practice, and retain knowledge through coordinated AI agents, grounded study material, personalized learning workflows, and an extensible development platform.

## Planned technology areas

- **Microsoft Azure AI Foundry** for AI agent and model workflows
- **RAG** for grounded responses from trusted study material
- **MCP** for extensible tools and agent integrations
- **Supabase** for application data, authentication, and persistence
- **GitHub-driven AI development** for collaboration, automation, and delivery

## Getting started

The architecture and delivery plan are documented in:

- [Architecture](docs/ARCHITECTURE.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Setup](docs/SETUP.md)
- [Environment variables](docs/ENVIRONMENT.md)
- [Security architecture](docs/SECURITY.md)
- [QA and evaluation strategy](docs/QA.md)

GitHub Issues are the central work queue. Each implementation phase identifies its responsible agent, acceptance criteria, QA expectations, and independent review gate.

## Run the MVP

```powershell
npm install
npm start
```

Open `http://localhost:4000`. `npm start` runs the local JSON-persistence mode and does not read
`.env.local`; use `npm run dev` when you want the configured Supabase and Foundry provider paths
(the dev script loads `.env.local`). Local data is stored under `.data/` and is ignored by Git.
Configure `SUPABASE_URL` and `SUPABASE_ANON_KEY`, or `AZURE_AI_PROJECT_ENDPOINT` and
`AZURE_AI_AGENT_NAME`, only when authorized services are available; the application reports their
availability without fabricating credentials. The frontend includes the complete dashboard, library,
grounded assistant, practice lab with MCQ and Viva assessment, study plans, progress, and
local/provider status workflows.

Quality gates:

```powershell
npm run test:unit        # Vitest unit and API integration suite
npm run test:e2e         # Deterministic end-to-end student workflow
npm run evaluate:local   # Local release-readiness evaluation harness
npm run lint
npm run typecheck
npm run format:check
npm run build
npm run security:check
```

Hosted Foundry is currently blocked by zero GPT deployment quota in the Azure for Students
subscription; the live Foundry test is reported as skipped rather than failed. See
[environment notes](docs/ENVIRONMENT.md).

## License

License details will be added before the first production release.
