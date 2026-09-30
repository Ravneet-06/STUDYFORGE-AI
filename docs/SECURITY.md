# StudyForge AI security architecture

## Security boundary and threat model

The backend is the trust boundary. Browser input, uploaded files, extracted text, retrieved chunks, model output, tool arguments, and provider responses are untrusted. The principal threats are prompt injection, malicious or oversized documents, cross-user retrieval, IDOR/authorization bypass, unsafe tool execution, sensitive-data leakage, credential exposure, and unsupported model claims.

The API rejects oversized JSON bodies and documents, validates IDs and nested fields, normalizes metadata, and treats instruction-like document text as data. Prompt injection checks run before assistant/generation requests. Retrieved context is bounded and filtered by authenticated user and optional document ownership. Unsupported questions return an explicit refusal with no fabricated source.

## Authentication and authorization

Supabase mode requires a validated Supabase Auth bearer token. The token is forwarded to PostgREST so database RLS remains authoritative. Local mode retains the development identity fallback for Phase 1-6 compatibility; production local mode requires the identity header and must be replaced by a real provider before deployment. Every store method takes the authenticated user ID, and resource queries include ownership predicates. Missing or foreign resources return a generic `404`.

RLS policies cover user-owned tables, document chunks are checked against their parent document, and vector search checks both `auth.uid()` and the requested user/document scope. Quiz creation also verifies that an attached document belongs to the caller.

## Guardrails and RAG policy

`apps/api/src/guardrails.mjs` provides reusable prompt-injection detection, metadata sanitization, tool argument validation, context/output limits, grounding enforcement, and sensitive-data leakage checks. Dangerous or unknown tools are denied by default. Generated study answers must have source document/chunk identifiers; otherwise the reviewer/QA path marks them unsupported.

Document ingestion supports only PDF, DOCX, Markdown, and text, with an 8 MB extracted-input limit and a 12 MB JSON request limit to accommodate base64-encoded browser uploads. Both limits are enforced server-side and return a safe `413 payload_too_large` error. Context is capped before generation and provider retrieval results are re-filtered by user and document ID. Source excerpts are bounded and are never invented.

Progress and score values are server-derived. MCQ submissions contain selected option indexes; the API loads the caller-owned quiz and calculates the score from stored answers. Client-supplied score, percentage, points, and completion values are ignored or rejected. Public activity and MCP paths cannot record MCQ or Viva attempts. Points, cumulative completion, active days, averages, and weekly sessions are computed on the server. Viva answers are evaluated deterministically against bounded reference answers, and a non-empty answer never receives automatic full credit.

## MCP/tool security

The tool gateway exposes only the explicit `list_documents`, `get_document_chunks`, `record_progress`, and `record_activity` allowlist. `record_progress` can update the study focus note but not server-derived completion. `record_activity` cannot forge assessment attempts. Unknown tools, extra arguments, invalid IDs, malformed progress, missing stores, and missing identities are rejected. No shell, network, filesystem, administrative, or cross-user capability is exposed. Tool errors use safe API messages and do not include credentials or internal stack traces.

## Secrets and configuration

Secrets must come from environment variables or a managed secret store. `.env` files, local state, logs, browser bundles, Issues, and source control are excluded from secret handling. The service-role key is not used by the browser API. Structured logging redacts fields whose names indicate credentials and replaces document/prompt/content values with length-only markers.

## HTTP hardening and observability

Responses use request IDs, `nosniff`, clickjacking protection, no-referrer, no-store, and a restrictive content-security policy. CORS is unset by default and can be narrowed to `WEB_ORIGIN`; wildcard CORS is not used. JSON bodies are limited to 12 MB and preflight methods/headers are explicit.

Structured events cover authentication failures, API errors, guardrail decisions, document ingestion, retrieval authorization/completion, agent completion, and tool denial/completion. Events contain IDs, counts, status, and policy outcomes, not passwords, tokens, full documents, prompts, or answers. Correlation IDs are returned as `x-request-id`.

## Incident response and limitations

On a suspected incident, preserve request IDs and redacted event records, revoke affected provider credentials, review ownership/RLS and tool policy changes, and rotate secrets through the configured secret store. Do not paste private document contents or tokens into Issues.

Hosted Azure Foundry remains unavailable because the Azure for Students subscription has zero GPT deployment quota. The application therefore keeps the validated local/provider-fallback behavior and does not create resources, request quota, or fabricate hosted responses. Production deployment still requires a real identity provider, managed secret storage, rate limiting at the edge, malware scanning for uploads, and independent security review.
