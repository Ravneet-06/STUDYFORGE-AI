# StudyForge AI QA and evaluation strategy

## Quality gates

Every change runs formatting, lint, type-checking, unit/integration tests, dependency security checks, foundation validation, the build check, and `npm run evaluate:local`. The deterministic evaluation suite starts the real local API and fails the command when any critical case fails. CI therefore blocks regressions in authentication, authorization, ingestion, RAG grounding, generation, tools, guardrails, API errors, and the student workflow.

Run the complete local gate:

```powershell
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run evaluate:local
npm run security:check
npm run validate:foundation
npm run health:foundation
npm run build
git diff --check
```

## Evaluation methodology

`scripts/evaluate-local.mjs` uses synthetic users and study material against the actual HTTP server. It reports total, passed, failed, skipped, critical failures, case IDs, categories, and failure reasons as JSON. Cases cover:

- authentication, correlation IDs, and safe API contracts;
- document ingestion, metadata normalization, listing, and ownership;
- grounded answers, source attribution, unsupported-question refusal, retrieval relevance, and tenant isolation;
- summary, explanation, MCQ, viva, study-plan, and progress workflows;
- MCP allowlisting, malformed arguments, prompt injection, sensitive output, malformed JSON, and oversized requests.

Groundedness is measured deterministically: a supported response must be marked grounded and include document/chunk provenance; unsupported questions must be explicitly ungrounded with no sources. Retrieval relevance uses synthetic lexical matches and verifies that another user's chunk is excluded. These are behavioral regression checks, not claims about general model quality.

The Vitest suite remains the detailed unit/integration layer. The evaluation runner is the release-readiness smoke layer and intentionally fails on unhidden errors. Synthetic data uses no private documents, credentials, or external service calls.

## Failure handling

When a gate fails, preserve the JSON report and request ID, identify the failing case/category, and create or reopen a GitHub Issue labeled for the responsible area (`agent:qa`, `agent:security`, `agent:backend`, or `agent:rag`). Fix the root cause, rerun the failed case and complete gate, then request independent review. A skipped case is reported with a reason and is never counted as passed.

## Foundry evaluation boundary

Hosted Foundry evaluation is represented by an explicit skipped case. The current Azure for Students subscription has zero GPT deployment quota, and this repository has no authorized hosted model deployment. The Phase 8 harness does not create resources, deploy models, request quota, call an unconfigured endpoint, or fabricate hosted scores. Local deterministic results are reported only as local fallback results.

When quota and an authorized deployment become available, the Foundry evaluation path can be enabled by adding the supported Foundry evaluation adapter and a real synthetic dataset/evaluator configuration. It must preserve the same pass/fail contract, record the actual deployment and evaluator identifiers, retain skipped status on authentication/quota failures, and never substitute local results for hosted results.

## Release readiness

Phase 8 is ready for reviewer sign-off when all critical local cases and required quality gates pass, failures are visible, no critical case is skipped, and any hosted Foundry case is explicitly documented as blocked rather than represented as a successful model evaluation.
