import { retrieve, groundedAnswer } from "./rag.mjs";
import { guardOutput } from "./guardrails.mjs";
import { agentRoles, handoff } from "./agent-contracts.mjs";
import { createFoundryProvider } from "./foundry.mjs";
import { logEvent } from "./observability.mjs";

const foundryCitation = /【\d+:\d+†[^】]*】/g;
const sourceGroupCitation = /【\s*Source\s+\d+(?:\s*\|\s*Source\s+\d+)*\s*】/gi;

function cleanGeneratedAnswer(answer) {
  return String(answer || "")
    .replace(foundryCitation, "")
    .replace(sourceGroupCitation, "")
    .trim();
}

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

const stopwords = new Set([
  "about",
  "above",
  "after",
  "again",
  "against",
  "along",
  "also",
  "because",
  "been",
  "before",
  "being",
  "below",
  "between",
  "both",
  "cannot",
  "could",
  "does",
  "doing",
  "during",
  "each",
  "from",
  "further",
  "have",
  "having",
  "here",
  "into",
  "itself",
  "more",
  "most",
  "only",
  "other",
  "over",
  "same",
  "should",
  "some",
  "such",
  "than",
  "that",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "under",
  "until",
  "very",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "with",
  "would",
  "your",
]);

const genericDistractors = [
  "An unrelated concept from another topic",
  "An incorrect assumption not supported by the material",
  "A different process described elsewhere in the material",
];

const insufficientEvidence = "There is not enough evidence in the source";

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function keyTerms(text) {
  return [
    ...new Set(
      (
        String(text)
          .toLowerCase()
          .match(/[a-z][a-z0-9-]{3,}/g) || []
      ).filter(Boolean),
    ),
  ].filter((term) => !stopwords.has(term));
}

function rotate(list, offset) {
  if (!list.length) return list;
  const shift = ((offset % list.length) + list.length) % list.length;
  return [...list.slice(shift), ...list.slice(0, shift)];
}

function distinctOptions(correct, candidates, limit) {
  const options = [];
  for (const candidate of candidates) {
    if (options.length >= limit) break;
    if (candidate === correct) continue;
    if (candidate.includes(correct) || correct.includes(candidate)) continue;
    if (options.some((option) => option.includes(candidate) || candidate.includes(option)))
      continue;
    options.push(candidate);
  }
  return options;
}

/**
 * Builds grounded practice questions from authorized source context.
 * MCQs use distinctive terms drawn from the material as the single correct answer with plausible
 * distractors from the same material; generic options are only a last-resort fallback.
 */
export function makeQuestions(context, count, viva = false) {
  const sentences = String(context || "")
    .split(/[.!?]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 20);
  const termPool = [...new Set(sentences.flatMap((sentence) => keyTerms(sentence)))];

  return Array.from({ length: count }, (_, index) => {
    const sentence = sentences[index];
    if (!sentence) {
      return {
        question: "What is the most important idea in this topic?",
        ...(viva
          ? { answer: "The authorized study material does not contain enough evidence." }
          : {
              options: rotate([insufficientEvidence, ...genericDistractors], index),
              answer: insufficientEvidence,
            }),
      };
    }
    if (viva) {
      return { question: `Explain this concept: ${sentence.slice(0, 100)}?`, answer: sentence };
    }

    const terms = keyTerms(sentence);
    const correct = terms.length ? terms[index % terms.length] : null;
    if (!correct) {
      return {
        question: `Which statement matches the study material: "${sentence.slice(0, 120)}"?`,
        options: rotate([sentence.slice(0, 120), ...genericDistractors], index),
        answer: sentence.slice(0, 120),
      };
    }
    const distractors = distinctOptions(correct, rotate(termPool, index + 1), 3);
    const options = rotate(
      [correct, ...distractors, ...genericDistractors.slice(0, 3 - distractors.length)],
      index,
    );
    return {
      question: `In the study material, which term best completes: "${sentence
        .slice(0, 160)
        .replace(new RegExp(`\\b${escapeRegExp(correct)}\\b`, "i"), "_____")}"?`,
      options,
      answer: correct,
    };
  });
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
    questions: makeQuestions(context, input.kind === "viva" ? 5 : 3, input.kind === "viva"),
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

function groundedProviderMessage(route, input, research) {
  const sourceContext = research.context
    .map(
      (match, index) =>
        `[Source ${index + 1} | document ${match.documentId} | chunk ${match.id}]\n${match.text}`,
    )
    .join("\n\n");
  return [
    "You are the StudyForge study-only agent. Answer only academic study questions.",
    "Use only the authorized source context below. If it does not support the question, say that the uploaded material does not contain enough evidence.",
    "Do not use outside knowledge to fill gaps. Do not emit provider-specific citation markers; StudyForge will attach the verified source references.",
    ...(route === "mcq" || route === "viva"
      ? []
      : [
          "Write a concise, student-friendly Markdown response.",
          "Use a short paragraph or a useful Markdown heading when appropriate.",
          "When the answer naturally contains multiple items, use a real Markdown list with one item per line (numbered for ordered steps or points, bullets for unordered items). Do not write list items inline in one paragraph.",
          "Use short paragraphs and line breaks for readability. Keep every claim grounded in the authorized source context.",
          "Do not add inline source labels, grouped source citations, or citation brackets; StudyForge renders the verified EVIDENCE section separately.",
        ]),
    `Requested operation: ${route}.`,
    ...(route === "mcq"
      ? [
          'Return only valid JSON in the shape {"questions":[{"question":"...","options":["..."],"answer":"..."}]}.',
        ]
      : route === "viva"
        ? [
            'Return only valid JSON in the shape {"questions":[{"question":"...","answer":"..."}]}. Each question must be open-ended and require the student to explain the answer; do not include options.',
          ]
        : []),
    `User request: ${input.question || input.topic || ""}`,
    `Authorized source context:\n${sourceContext || "[No authorized source context found.]"}`,
  ].join("\n");
}

export async function orchestrate(kind, input, store, options = {}) {
  const route = routes[kind] ? kind : "assistant";
  const provider = options.provider || createFoundryProvider();
  const selected = selectAgents(route);
  let result;
  let research = { context: [], sources: [], grounded: false };
  if (selected.includes("rag")) research = await runRagAgent(input, store);
  if (route === "assistant" && !research.context.length) {
    result = { ...groundedAnswer(input.question, research.context), sources: research.sources };
  } else if (provider.configured && route !== "progress") {
    const generated = await provider.run({
      message: groundedProviderMessage(route, input, research),
    });
    const verifiedSources = research.sources;
    if (route === "assistant") {
      result = {
        answer: cleanGeneratedAnswer(generated.answer),
        grounded: verifiedSources.length > 0,
        sources: verifiedSources,
      };
    } else if (route === "summary" || route === "explanation") {
      result = {
        summary: cleanGeneratedAnswer(generated.answer),
        grounded: verifiedSources.length > 0,
        sources: verifiedSources,
      };
    } else {
      let questions;
      try {
        const parsed = JSON.parse(generated.answer);
        questions = Array.isArray(parsed) ? parsed : parsed.questions;
      } catch {
        questions = null;
      }
      result = {
        questions: Array.isArray(questions) ? questions : [],
        grounded: verifiedSources.length > 0,
        sources: verifiedSources,
      };
    }
  } else if (route === "assistant") {
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
