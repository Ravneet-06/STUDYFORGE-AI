const tools = {
  list_documents: { fields: ["userId"], description: "List documents owned by the current user." },
  record_progress: {
    fields: ["userId", "completed"],
    description: "Record study progress for the current user.",
  },
};
export function validateToolInput(input) {
  if (!input?.tool || !tools[input.tool]) return { allowed: false, error: "Unknown tool." };
  const definition = tools[input.tool];
  const missing = definition.fields.filter((field) => input[field] === undefined);
  return missing.length
    ? { allowed: false, error: `Missing fields: ${missing.join(", ")}` }
    : { allowed: true, tool: input.tool, description: definition.description };
}
export function listTools() {
  return Object.entries(tools).map(([name, value]) => ({ name, ...value }));
}
