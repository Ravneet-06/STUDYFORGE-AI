# GitHub Issue routing

The `Issue routing` workflow runs only when an Issue is opened or reopened. It reads the current
Issue labels and recognizes the repository's `agent:*` responsibility labels. One recognized label
produces a deterministic routed comment; none reports a missing responsible agent; multiple report
that exactly one is required. It never invokes an external agent or closes or merges an Issue.

The workflow serializes runs per Issue and marks its comment with an event-specific identifier so a
redelivered event does not post the same result twice. Its job token can read repository contents
for the routing helper and write Issue comments; it has no other permissions.
