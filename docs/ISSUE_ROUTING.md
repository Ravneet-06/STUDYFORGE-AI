# GitHub Issue routing and execution boundary

## Stage 1: deterministic routing

The `Issue routing` workflow runs only when an Issue is opened or reopened. It reads the current
Issue labels and recognizes the repository's `agent:*` responsibility labels. One recognized label
produces a deterministic routed comment; none reports a missing responsible agent; multiple report
that exactly one is required. Stage 1 never invokes an external agent or closes or merges an Issue.

## Stage 2: execution boundary

The `Issue execution boundary` workflow runs for Issue opened/reopened events and when a responsible
`agent:*` label is added. It re-reads current labels, accepts exactly one recognized label, and emits
a validated JSON manifest artifact with `ready_for_agent_execution` status. Missing, multiple, or
malformed agent labels produce only a status comment and no manifest. The payload contains only the
repository, Issue number/title/body, responsible label/role, Issue URL, event action, and timestamp.
Issue text remains untrusted data and is never evaluated as workflow instructions or commands.

Both workflows serialize runs per Issue and use event-specific bot-comment markers to avoid duplicate
comments on redelivery. Stage 2 also lists repository Actions artifacts with `actions: read` and skips
upload when the non-expired artifact with the deterministic job ID name already exists. This closes the
retry window where upload succeeds but comment creation fails: the retry finds the artifact and posts
the missing comment without uploading a second copy. Stage 2 uses `contents: read` for checkout and
`issues: write` for status comments; no repository contents write permission is granted. Artifact
retention is seven days.
The manifest includes untrusted Issue text and follows the repository's artifact access controls;
do not put secrets in Issue titles or bodies.

## Stage 3: read-only QA agent

The `Issue QA agent` workflow listens for Issue opened, reopened, and responsible-agent label events.
It runs only when the current Issue labels classify as exactly one recognized `agent:qa` assignment.
It computes Stage 2's deterministic job ID, waits for that exact non-expired Stage 2 manifest artifact,
and verifies the manifest and Issue identity before running checks. This artifact handoff also handles
Stage 2 retries where the matching artifact belongs to an earlier workflow run.

The QA check runner uses a fixed allowlist: `npm run validate:foundation`, `npm run format:check`,
`npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run build`, and
`npm run security:check`. `npm ci` is used only to install the locked dependencies before those checks.
Issue title and body are never passed as commands; the title is escaped when included as report data.
The structured comment identifies the Issue, repository, tested commit, timestamp, QA role, overall
status, and separate passed, failed, skipped, and execution-error sections with concise output.
Reports include a deterministic marker derived from the Stage 2 job ID, and existing bot-authored
markers suppress repeat reports.

The QA job grants `contents: read`, `actions: read` to locate/download the Stage 2 artifact, and
`issues: write` to post the report. It has no repository contents write permission and does not modify,
commit, push, approve, merge, or close anything. It does not invoke an AI/model/agent. Later specialized
agents will need separate workflows and explicit permission boundaries; this Stage 3 workflow does
not enable code-writing agents.

## Deliberate limits and future integration

Stage 2 does not invoke AI or any external agent, modify application source, approve/assign/close/merge
Issues, create secrets, or execute commands from Issue content. The manifest is a handoff contract
only; `ready_for_agent_execution` does not mean work has begun. Stage 3 is a read-only validator only.
Any later executor must use a separate workflow, explicit authorization, and narrowly scoped
permissions; no code-writing agent is enabled here.
