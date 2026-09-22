export const agentRoles = Object.freeze({
  orchestrator: {
    name: "Orchestrator Agent",
    responsibility: "Route a request to bounded specialist agents and coordinate handoffs.",
  },
  rag: {
    name: "RAG/Research Agent",
    responsibility: "Retrieve authorized study context with source references.",
  },
  study: {
    name: "Study Agent",
    responsibility: "Create grounded summaries, explanations, and study plans.",
  },
  quiz: {
    name: "Quiz Agent",
    responsibility: "Create grounded MCQ and viva practice material.",
  },
  reviewer: {
    name: "Reviewer Agent",
    responsibility: "Reject unsupported output and validate grounding and format.",
  },
  qa: {
    name: "QA Agent",
    responsibility: "Validate workflow invariants and report failures.",
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
