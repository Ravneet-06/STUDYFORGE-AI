import { retrieve, groundedAnswer } from "./rag.mjs";
import { guardOutput } from "./guardrails.mjs";

const agents = {
  assistant: "RAG Agent",
  summary: "Study Agent",
  mcq: "Quiz Agent",
  viva: "Quiz Agent",
  progress: "Progress Agent",
};

export async function orchestrate(kind, input, store) {
  const route = agents[kind] ? kind : "assistant";
  if (route === "assistant") {
    const matches = retrieve(store, input.userId, input.question, input.documentId);
    return {
      ...groundedAnswer(input.question, matches),
      agent: "RAG Agent",
      orchestrator: "Orchestrator Agent",
    };
  }
  const matches = retrieve(
    store,
    input.userId,
    input.topic || input.documentId || "",
    input.documentId,
  );
  const context = matches.map((m) => m.text).join(" ");
  const result =
    route === "summary"
      ? {
          summary: context
            ? context.slice(0, 1000)
            : "Upload material about this topic to generate a grounded summary.",
          grounded: Boolean(context),
          sources: matches.map((m) => m.documentId),
        }
      : route === "mcq"
        ? {
            questions: makeQuestions(context, 3),
            grounded: Boolean(context),
            sources: matches.map((m) => m.documentId),
          }
        : route === "viva"
          ? {
              questions: makeQuestions(context, 5).map((q) => q.question),
              grounded: Boolean(context),
              sources: matches.map((m) => m.documentId),
            }
          : { progress: store.getProgress(input.userId) };
  return { ...guardOutput(result), agent: agents[route], orchestrator: "Orchestrator Agent" };
}

function makeQuestions(context, count) {
  const sentences = context
    .split(/[.!?]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  return Array.from({ length: count }, (_, i) => ({
    question: sentences[i]
      ? `Explain this concept: ${sentences[i].slice(0, 100)}?`
      : "What is the most important idea in this topic?",
    options: [
      "Review the source material",
      "Ignore the topic",
      "Use an unrelated answer",
      "There is not enough evidence",
    ],
    answer: "Review the source material",
  }));
}
