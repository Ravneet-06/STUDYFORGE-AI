# StudyForge AI Architecture

## Scope

StudyForge AI is planned as a multi-agent study platform. This document describes the proposed target architecture for the MVP; it does not document implemented application behavior.

## System boundaries

```text
Browser
  -> Frontend web application
  -> Backend API (authenticated, validated)
      -> Supabase Auth / Postgres / Storage / pgvector
      -> Document ingestion and RAG services
      -> Microsoft Foundry project and model deployments
          -> Orchestrator Agent
              -> Frontend, Backend, Database, RAG, MCP/Tools,
                 Security/Guardrail, QA/Testing, Reviewer agents
      -> Restricted MCP tool gateway
      -> Telemetry and evaluation store
```

The browser never calls model or database administration APIs directly. The backend enforces identity, ownership, validation, rate limits, and tool authorization.

## Runtime components

### Frontend

The web client owns navigation, accessible forms, upload progress, assistant conversations, quiz interactions, study plans, progress, analytics, and explicit loading/error/empty/success states. It calls versioned backend APIs and receives only user-authorized data.

### Backend API

The API is organized by bounded modules: authentication/session, documents, ingestion, retrieval/conversations, generation, quizzes, progress, study plans, agent operations, evaluations, and health. It is the policy enforcement point for authentication, authorization, input validation, ownership checks, and audit events.

### Data layer

Supabase provides Auth and Postgres. Planned domain entities are profiles, documents, document chunks, conversations, messages, quizzes, quiz questions, quiz attempts, study plans, progress records, agent tasks, and evaluations. User-owned tables use RLS with the authenticated user ID. Service-role access is limited to backend workers and never sent to the browser.

### Document and RAG pipeline

```text
Upload -> virus/content validation -> object storage
       -> text extraction (PDF/DOCX/TXT/Markdown)
       -> normalization and chunking
       -> embeddings
       -> vector persistence with document/user provenance
       -> filtered retrieval
       -> grounded generation with source references
```

Retrieval is always filtered by user and document authorization. Responses distinguish supported material from missing material. If the retrieved context is insufficient, the assistant states that the answer was not found rather than fabricating a citation.

### Microsoft Foundry agent layer

Foundry is the primary AI platform. The Orchestrator Agent coordinates bounded tasks and delegates rather than implementing every responsibility. Hosted-agent or prompt-agent choices will follow the installed Foundry skill after the foundation and Azure availability checks; no unsupported API is assumed here.

Agent handoffs carry a typed task envelope containing task ID, user ID, allowed document scope, requested operation, context references, and output schema. Agents do not receive unrestricted database credentials or arbitrary tools.

### MCP/tool gateway

MCP tools are explicit, schema-validated capabilities. Initial tool families are study-document operations, project-management/GitHub operations, database read/write operations through approved service methods, and evaluation operations. Each tool has an allowlist, ownership checks, input limits, audit logging, and a timeout. Destructive or privileged operations require a separate policy decision and are not exposed by default.

## Required agents

| Agent                          | Responsibility                                                                         | Must not own                                  |
| ------------------------------ | -------------------------------------------------------------------------------------- | --------------------------------------------- |
| Project Manager / Orchestrator | Decompose requirements, route tasks, track Issue state, enforce handoff schemas        | Direct unrestricted data or tool access       |
| Frontend                       | UI composition, client state, accessibility, API integration                           | Model credentials or database administration  |
| Backend                        | API contracts, validation, authorization, service composition                          | Bypassing RLS or direct browser exposure      |
| Database                       | Schema, migrations, indexes, RLS policies, data lifecycle                              | Product prompt decisions                      |
| RAG                            | Extraction, chunking, embeddings, retrieval, provenance, grounded context              | Cross-user data access                        |
| MCP / Tools                    | Typed tool definitions, adapters, permissions, audit behavior                          | Generic shell or unrestricted external access |
| Security / Guardrail           | Threat modeling, prompt/content checks, policy enforcement, secrets and abuse controls | Silent weakening of safety checks             |
| QA / Testing                   | Unit/integration/e2e tests, evaluation datasets, regression and failure Issues         | Approving its own untested work               |
| Reviewer                       | Independent review of requirements, architecture, security, tests, docs, and grounding | Approving incomplete or failing work          |

## Security and grounding controls

- Supabase Auth plus RLS and backend ownership checks isolate users.
- Secrets use environment variables, managed identity, or platform secret stores.
- Uploaded content is treated as untrusted data and cannot redefine system policy or tool permissions.
- Tool calls use least privilege, strict schemas, timeouts, rate limits, and audit events.
- Retrieval filters by user/document scope before generation.
- Generated answers include only verifiable document provenance; unsupported claims are explicitly marked.
- Safety, privacy, prompt-injection, cross-tenant, and citation tests are release gates.

## Observability and evaluation

Every agent task has a correlation ID and records status, latency, model/deployment metadata where permitted, tool calls, and evaluation outcomes without storing secrets. Evaluation criteria include groundedness, relevance, correctness, document support, safety, and refusal behavior. Production traces and evaluation datasets are managed through the Foundry guidance and retained according to the eventual privacy policy.

## Deployment shape

The MVP should use separate frontend and backend deployables, a worker path for ingestion, Supabase, and a Foundry project. Azure resource creation, model deployment, region, quota, networking, and CI/CD remain gated by the corresponding GitHub Issues and required user authorizations.
