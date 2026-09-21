# StudyForge AI

StudyForge AI is an autonomous multi-agent AI study platform built with Microsoft Azure AI Foundry, retrieval-augmented generation (RAG), the Model Context Protocol (MCP), Supabase, and GitHub-driven AI development.

## Project status

The repository now contains a runnable local MVP vertical slice. It includes a responsive study dashboard, document ingestion, local retrieval-augmented answers, summaries, MCQs, viva prompts, progress tracking, guardrails, logical agent routing, MCP tool validation, and a Supabase schema artifact.

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

GitHub Issues are the central work queue. Each implementation phase identifies its responsible agent, acceptance criteria, QA expectations, and independent review gate.

## Run the MVP

```powershell
npm install
npm start
```

Open `http://localhost:4000`. Local mode persists development data under `.data/` and does not require Azure or Supabase credentials. Configure `AZURE_AI_PROJECT_ENDPOINT` or `SUPABASE_URL` only when authorized services are available; the application reports their availability without fabricating credentials.

## License

License details will be added before the first production release.
