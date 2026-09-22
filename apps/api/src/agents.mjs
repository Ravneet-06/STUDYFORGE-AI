import { retrieve, groundedAnswer } from "./rag.mjs";
import { guardOutput } from "./guardrails.mjs";
import { agentRoles, handoff } from "./agent-contracts.mjs";
import { createFoundryProvider } from "./foundry.mjs";
import { logEvent } from "./observability.mjs";

const routes = Object.freeze({
  assistant: ["rag", "reviewer", "qa"],
  summary: ["rag", "study", "reviewer", "qa"],
  explanation: ["rag", "study", "reviewer", "qa"],
  mcq: ["rag", "quiz", "reviewer", "qa"],
  viva: ["rag", "quiz", "reviewer", "qa"],
  progress: ["study", "reviewer", "qa"],
});

export function selectAgents(kind) {
  return routes[kind] || routes.assistant;
}

export async function runRagAgent(input, store) {
  const matches = await retrieve(
    store,
    input.userId,
    input.question || input.topic || "",
    input.documentId,
  );
  return {
    context: matches,
    grounded: matches.length > 0,
    sources: matches.map((match) => ({
      documentId: match.documentId,
      chunkId: match.id,
      chunkIndex: match.index,
      excerpt: match.text.slice(0, 180),
    })),
    handoff: handoff(
      agentRoles.rag.name,
      input.userId,
      "retrieve",
      { documentId: input.documentId },
      "grounded_context",
    ),
  };
}

function makeQuestions(context, count) {
  const sentences = context
    .split(/[.!?]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from({ length: count }, (_, index) => ({
    question: sentences[index]
      ? `Explain this concept: ${sentences[index].slice(0, 100)}?`
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

export function runStudyAgent(input, research) {
  const context = research.context.map((match) => match.text).join(" ");
  return {
    summary: context
      ? context.slice(0, 1000)
      : "Upload material about this topic to generate a grounded summary.",
    grounded: Boolean(context),
    sources: research.sources,
    handoff: handoff(
      agentRoles.study.name,
      input.userId,
      "study",
      { topic: input.topic },
      "study_response",
    ),
  };
}

export function runQuizAgent(input, research) {
  const context = research.context.map((match) => match.text).join(" ");
  return {
    questions: makeQuestions(context, input.kind === "viva" ? 5 : 3),
    grounded: Boolean(context),
    sources: research.sources,
    handoff: handoff(
      agentRoles.quiz.name,
      input.userId,
      input.kind,
      { topic: input.topic },
      "quiz_response",
    ),
  };
}

export function reviewResponse(result, kind) {
  const hasAnswer =
    typeof result.answer === "string" ||
    typeof result.summary === "string" ||
    Array.isArray(result.questions);
  const supported =
    result.grounded === true && Array.isArray(result.sources) && result.sources.length > 0;
  if (kind === "progress")
    return { approved: true, reason: "Progress is not a grounded generation.", result };
  if (!hasAnswer || !supported) {
    return {
      approved: false,
      reason: "Generated output lacks supported study evidence or the required response shape.",
      result: { ...result, grounded: false, sources: [] },
    };
  }
  return {
    approved: true,
    reason: "Output has grounded evidence and the required response shape.",
    result,
  };
}

export function runQaAgent(result, review) {
  const failures = [];
  if (!review.approved) failures.push(review.reason);
  if (result.grounded && (!Array.isArray(result.sources) || result.sources.length === 0))
    failures.push("Grounded output has no sources.");
  return { passed: failures.length === 0, failures };
}

export async function orchestrate(kind, input, store) {
  const route = routes[kind] ? kind : "assistant";
  const provider = createFoundryProvider();
  const selected = selectAgents(route);
  let result;
  let research = { context: [], sources: [], grounded: false };
  if (selected.includes("rag")) research = await runRagAgent(input, store);
  if (route === "assistant") {
    result = { ...groundedAnswer(input.question, research.context), sources: research.sources };
  } else if (route === "summary" || route === "explanation") {
    result = runStudyAgent(input, research);
  } else if (route === "mcq" || route === "viva") {
    result = runQuizAgent(input, research);
  } else {
    result = { progress: await store.getProgress(input.userId), grounded: true, sources: [] };
  }
  const review = reviewResponse(result, route);
  const qa = runQaAgent(result, review);
  if (!qa.passed && route !== "progress") {
    result = {
      ...result,
      grounded: false,
      sources: [],
      reviewer: { approved: false, reason: review.reason },
    };
  }
  const response = {
    ...guardOutput(result),
    agent:
      route === "mcq" || route === "viva"
        ? agentRoles.quiz.name
        : route === "summary" || route === "explanation"
          ? agentRoles.study.name
          : selected.includes("rag")
            ? agentRoles.rag.name
            : agentRoles.study.name,
    orchestrator: agentRoles.orchestrator.name,
    selectedAgents: selected.map((name) => agentRoles[name].name),
    reviewer: review,
    qa,
    provider: provider.mode,
  };
  logEvent("agent.completed", {
    userId: input.userId,
    operation: route,
    grounded: response.grounded,
    provider: response.provider,
  });
  return response;
}
