# StudyForge AI Implementation Plan

## Status

This is the initial implementation roadmap for a repository that currently contains no application code. It is a plan, not a claim that the listed features already exist.

## Delivery principles

- Work is driven by GitHub Issues. Every implementation change must reference an Issue owned by the responsible agent.
- Changes are delivered in small, reviewable commits and tested at the end of each phase.
- Microsoft Foundry is the primary AI platform. The installed `microsoft-foundry` skill and its dependency check are the source of truth for Foundry workflows.
- User data is tenant-isolated by default. Secrets are supplied through environment variables or managed identities and never committed.
- Groundedness is a release gate for document questions, summaries, and generated study content.
- The Reviewer Agent can reject work, reopen an Issue, and route it back to the responsible agent.

## Phases

| Phase                     | Outcome                                                                                                             | Primary Issues |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------- |
| 0. Foundation             | Runtime boundaries, repository conventions, local configuration, and CI baseline                                    | #1             |
| 1. Identity and data      | Supabase authentication, profiles, schema, migrations, and row-level security                                       | #2             |
| 2. Backend contract       | Validated API boundaries for documents, conversations, study workflows, progress, plans, agents, and health         | #3             |
| 3. Knowledge pipeline     | Secure extraction, chunking, embeddings, vector storage, retrieval, provenance, and ingestion status                | #4             |
| 4. Agent and tool layer   | Foundry agent roles, orchestration, least-privilege MCP tools, and controlled handoffs                              | #5             |
| 5. Study experience       | Responsive dashboard, authentication screens, document flows, assistant, generators, plans, progress, and analytics | #6             |
| 6. Safety and reliability | Prompt-injection defenses, authorization boundaries, safe tool execution, grounding policies, and observability     | #7             |
| 7. QA and evaluation      | Automated tests, groundedness/relevance/safety evaluations, regression gates, and failure Issue workflow            | #8             |
| 8. Review and release     | Reviewer gate, documentation accuracy, deployment readiness, and MVP acceptance                                     | #9             |

## Definition of done for each phase

1. The linked GitHub Issue names the responsible agent and acceptance criteria.
2. Implementation and tests are committed in focused commits.
3. QA records automated results and opens or reopens a bug Issue for failures.
4. Reviewer checks architecture, security, requirements, documentation, and tests.
5. The Issue is closed only after QA and Reviewer approval.

## External-service decisions

- **Microsoft Foundry:** agent platform, model deployments, agent tracing/evaluation capabilities, and Foundry project resources. Public access is the initial MVP target; network isolation is a later deployment option.
- **Supabase:** Auth, Postgres, storage, and `pgvector`-backed retrieval metadata where suitable. RLS is mandatory for user-owned rows.
- **GitHub:** Issues as the central work queue, repository workflow, review, and CI/CD integration.
- **Azure Storage or Supabase Storage:** document-object storage; the final choice is confirmed during the data phase based on authorization and deployment constraints.
- **Azure AI Search:** optional scale-out retrieval provider. The initial design keeps a provider interface so the MVP can use Supabase `pgvector` without blocking a later migration.

## Decisions intentionally deferred

- Final frontend/backend language and framework, pending a foundation Issue that checks installed toolchains.
- Public versus private Foundry networking beyond the MVP.
- The exact embedding/model deployment and region, pending Azure subscription, quota, and model availability checks.
- Production retention, deletion, and data-residency policies, pending the target deployment environment.
