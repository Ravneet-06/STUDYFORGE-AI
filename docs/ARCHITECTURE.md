# StudyForge AI Architecture

## Scope

StudyForge AI is planned as a multi-agent study platform. This document describes the target architecture and the implemented local MVP boundaries.

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

The browser never calls model or database administration APIs directly. The backend enforces identity, ownership, validation, request-size limits, and tool authorization. Edge rate limiting remains a production deployment requirement.

## Runtime components

### Implemented local MVP

The current vertical slice runs from one Node.js HTTP process. It serves the browser UI, exposes the API, stores local development data in `.data/studyforge.json`, and keeps provider boundaries ready for Supabase and Microsoft Foundry. This local adapter is intentionally not a production database or model substitute.

### Frontend

The web client owns navigation, accessible forms, upload progress, assistant conversations, quiz interactions, study plans, progress, analytics, and explicit loading/error/empty/success states. It calls versioned backend APIs and receives only user-authorized data.

### Backend API

The API is organized by bounded modules: authentication/session, documents, ingestion, retrieval/conversations, generation, quizzes, progress, study plans, agent operations, evaluations, and health. It is the policy enforcement point for authentication, authorization, input validation, ownership checks, and audit events. The local MVP implements these contracts in one Node.js HTTP process; it does not claim a separate production worker or service deployment.

The implemented contract is available under `/api/v1` (with legacy `/api` aliases retained for the local MVP). Responses include an `x-request-id` correlation header and request ID field. Errors use `{ error: { code, message }, requestId }`; resource routes return not-found rather than exposing another user's records. Supabase mode requires a bearer token and forwards that token to PostgREST so database RLS remains authoritative. Local mode uses the existing development identity header and JSON adapter.

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

Foundry is the primary AI platform. The local MVP uses deterministic generation when `AZURE_AI_PROJECT_ENDPOINT` is absent. No Foundry API call is made without a configured endpoint and authenticated provider implementation. The installed skill remains the source of truth for later Foundry workflows.

Agent handoffs carry a typed task envelope containing task ID, user ID, allowed document scope, requested operation, context references, and output schema. Agents do not receive unrestricted database credentials or arbitrary tools.

### MCP/tool gateway

MCP tools are explicit, schema-validated capabilities. The implemented local allowlist contains only `list_documents`, `get_document_chunks`, and `record_progress`, all scoped to the authenticated user. Project-management/GitHub, general database administration, evaluation, destructive, and privileged tool families are planned boundaries only and are not exposed by this MVP. Implemented tools have ownership checks, input limits, and audit logging; execution timeouts and edge rate limiting remain production follow-up requirements.

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
- Tool calls use least privilege, strict schemas, ownership checks, and audit events. Timeouts and rate limits remain deployment-level follow-up controls.
- Retrieval filters by user/document scope before generation.
- Generated answers include only verifiable document provenance; unsupported claims are explicitly marked.
- Safety, privacy, prompt-injection, cross-tenant, and citation tests are release gates.

## Observability and evaluation

Every agent task has a correlation ID and records status, latency, model/deployment metadata where permitted, tool calls, and evaluation outcomes without storing secrets. Evaluation criteria include groundedness, relevance, correctness, document support, safety, and refusal behavior. Production traces and evaluation datasets are managed through the Foundry guidance and retained according to the eventual privacy policy.

## Deployment shape

The MVP should use separate frontend and backend deployables, a worker path for ingestion, Supabase, and a Foundry project. Azure resource creation, model deployment, region, quota, networking, and CI/CD remain gated by the corresponding GitHub Issues and required user authorizations.

## Current agent routing

The local orchestrator routes requests through the RAG/Research, Study, or Quiz specialist as needed, then applies Reviewer and QA checks before returning a structured response. The Foundry provider boundary is explicit: hosted invocation requires authorized project configuration and is never simulated. Security/Guardrail checks run at the API boundary. MCP exposes only authenticated, schema-validated document and progress tools; unknown or privileged tools are denied by default.
