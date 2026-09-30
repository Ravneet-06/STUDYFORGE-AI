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

## Deliberate limits and future integration

Stage 2 does not invoke AI or any external agent, modify application source, approve/assign/close/merge
Issues, create secrets, or execute commands from Issue content. The manifest is a handoff contract
only; `ready_for_agent_execution` does not mean work has begun. A future executor must be a separate
Stage 3 workflow that consumes the validated manifest, treats its title/body as data, uses separate
explicit authorization and narrowly scoped permissions, and records its own audit/result without
granting this preparation workflow repository write access.
