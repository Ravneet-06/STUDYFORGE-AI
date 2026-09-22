import { ApiError } from "./contracts.mjs";
import { validateToolArgument } from "./guardrails.mjs";
import { logEvent } from "./observability.mjs";

const tools = Object.freeze({
  list_documents: {
    fields: [],
    description: "List documents owned by the current user.",
    execute: async ({ store, userId }) => ({ documents: await store.listDocuments(userId) }),
  },
  get_document_chunks: {
    fields: ["documentId"],
    description: "Read chunks from a document owned by the current user.",
    execute: async ({ store, userId, input }) => ({
      chunks: await store.getChunks(
        userId,
        validateToolArgument(input.documentId, "documentId", 80),
      ),
    }),
  },
  record_progress: {
    fields: ["completed"],
    description: "Record bounded study progress for the current user.",
    execute: async ({ store, userId, input }) => {
      const completed = Number(input.completed);
      if (!Number.isInteger(completed) || completed < 0 || completed > 100) {
        throw new ApiError(
          422,
          "invalid_tool_input",
          "completed must be an integer from 0 to 100.",
        );
      }
      return { progress: await store.updateProgress(userId, { completed }) };
    },
  },
});

export function validateToolInput(input) {
  if (!input?.tool || !tools[input.tool]) return { allowed: false, error: "Unknown tool." };
  const definition = tools[input.tool];
  const args = input.input && typeof input.input === "object" ? input.input : input;
  const extras = Object.keys(args).filter(
    (key) => !definition.fields.includes(key) && key !== "tool",
  );
  if (extras.length) return { allowed: false, error: "Unexpected tool arguments." };
  const missing = definition.fields.filter((field) => args[field] === undefined);
  return missing.length
    ? { allowed: false, error: `Missing fields: ${missing.join(", ")}` }
    : { allowed: true, tool: input.tool, description: definition.description };
}

export async function executeTool({ tool, input = {}, store, userId }) {
  const validation = validateToolInput({ tool, ...input });
  if (!validation.allowed) {
    logEvent("tool.denied", { tool, userId, reason: validation.error });
    throw new ApiError(403, "tool_denied", validation.error);
  }
  if (!store || typeof userId !== "string" || !userId.trim())
    throw new ApiError(401, "unauthorized", "Tool execution requires an authenticated user.");
  const result = await tools[tool].execute({ store, userId, input });
  logEvent("tool.completed", { tool, userId });
  return result;
}

export function listTools() {
  return Object.entries(tools).map(([name, value]) => ({
    name,
    fields: value.fields,
    description: value.description,
  }));
}
