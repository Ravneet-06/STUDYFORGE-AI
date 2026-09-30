export const agentRoles = Object.freeze({
  orchestrator: {
    name: "Orchestrator Agent",
    responsibility: "Route a request to bounded specialist agents and coordinate handoffs.",
    ownedOutputs: ["routing_decision", "handoff_envelope"],
  },
  frontend: {
    name: "Frontend Agent",
    responsibility: "Own navigation, view composition, client state, and API integration.",
    ownedOutputs: ["view", "client_flow"],
  },
  backend: {
    name: "Backend Agent",
    responsibility: "Own HTTP contracts, validation, and service composition.",
    ownedOutputs: ["api_contract", "validation_policy"],
  },
  database: {
    name: "Database Agent",
    responsibility: "Own schema, migrations, indexes, and row-level security.",
    ownedOutputs: ["migration", "policy"],
  },
  rag: {
    name: "RAG/Research Agent",
    responsibility: "Retrieve authorized study context with source references.",
    ownedOutputs: ["grounded_context", "sources"],
  },
  mcp: {
    name: "MCP/Tools Agent",
    responsibility: "Expose typed, least-privilege tools with schema validation and audit events.",
    ownedOutputs: ["tool_result", "tool_denial"],
  },
  security: {
    name: "Security/Guardrail Agent",
    responsibility: "Enforce prompt/content checks, ownership, limits, and secret handling.",
    ownedOutputs: ["guardrail_decision"],
  },
  study: {
    name: "Study Agent",
    responsibility: "Create grounded summaries, explanations, and study plans.",
    ownedOutputs: ["study_response"],
  },
  quiz: {
    name: "Quiz Agent",
    responsibility: "Create grounded MCQ and viva practice material and evaluate responses.",
    ownedOutputs: ["quiz_response"],
  },
  reviewer: {
    name: "Reviewer Agent",
    responsibility: "Reject unsupported output and validate grounding, scope, and test evidence.",
    ownedOutputs: ["review_result"],
  },
  qa: {
    name: "QA Agent",
    responsibility: "Validate workflow invariants and report pass, fail, or blocked status.",
    ownedOutputs: ["qa_report"],
  },
});

export function handoff(agent, userId, operation, input, outputSchema) {
  return {
    agent,
    userId,
    operation,
    input,
    outputSchema,
  };
}

export function listAgentRoles() {
  return Object.entries(agentRoles).map(([id, role]) => ({
    id,
    name: role.name,
    responsibility: role.responsibility,
    ownedOutputs: [...role.ownedOutputs],
  }));
}

export function requireAgentRole(value, field = "agent") {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!id || !agentRoles[id]) {
    return { error: `${field} must be one of: ${Object.keys(agentRoles).join(", ")}.` };
  }
  return { id, role: agentRoles[id] };
}
