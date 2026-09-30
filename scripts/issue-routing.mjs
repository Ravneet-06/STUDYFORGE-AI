const agentRoles = new Map([
  ["agent:orchestrator", "Orchestrator"],
  ["agent:database", "Database"],
  ["agent:backend", "Backend"],
  ["agent:rag", "RAG"],
  ["agent:mcp", "MCP"],
  ["agent:frontend", "Frontend"],
  ["agent:security", "Security"],
  ["agent:qa", "QA"],
  ["agent:reviewer", "Reviewer"],
]);

export function classifyAgentLabels(labels) {
  const names = new Set(
    (Array.isArray(labels) ? labels : [])
      .map((label) => (typeof label === "string" ? label : label?.name))
      .filter((name) => agentRoles.has(name)),
  );
  const recognized = [...agentRoles.keys()].filter((name) => names.has(name));

  if (recognized.length === 0) return { status: "missing", labels: [] };
  if (recognized.length > 1) return { status: "multiple", labels: recognized };

  const [label] = recognized;
  return { status: "routed", label, role: agentRoles.get(label) };
}

export function routingCommentMarker(action, issueUpdatedAt) {
  const eventKey = `${action}:${issueUpdatedAt}`.replace(/[^a-zA-Z0-9._:-]/g, "_");
  return `<!-- studyforge-issue-routing:${eventKey} -->`;
}

export function formatRoutingComment(result, marker) {
  let message;
  if (result.status === "routed") {
    message = `Routed to **${result.role}** (\`${result.label}\`) based on the single responsible agent label.`;
  } else if (result.status === "multiple") {
    message = `Exactly one responsible agent label is required; found: ${result.labels.map((label) => `\`${label}\``).join(", ")}.`;
  } else {
    message =
      "Missing responsible agent. Add exactly one recognized `agent:*` label to route this Issue.";
  }

  return `${marker}\n\n### Deterministic Issue routing\n\n${message}\n\nNo external agent was invoked.`;
}

export function hasRoutingComment(comments, marker) {
  return (
    Array.isArray(comments) &&
    comments.some(
      (comment) =>
        comment?.user?.type === "Bot" &&
        typeof comment.body === "string" &&
        comment.body.includes(marker),
    )
  );
}
