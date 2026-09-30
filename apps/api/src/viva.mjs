import { ApiError } from "./contracts.mjs";

export const VIVA_LIMITS = Object.freeze({
  questions: 20,
  questionChars: 1200,
  answerChars: 2000,
});

const stopwords = new Set([
  "about",
  "above",
  "after",
  "again",
  "against",
  "because",
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
  "yours",
  "explain",
  "concept",
  "describe",
  "answer",
  "material",
  "source",
]);

function cleanText(value, max) {
  return [...String(value ?? "")]
    .map((character) => (character.charCodeAt(0) < 32 ? " " : character))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function normalizeAnswerText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^a-z0-9'\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function conceptTerms(value) {
  return [
    ...new Set(
      normalizeAnswerText(value)
        .split(" ")
        .filter((word) => word.length >= 4 && /^[a-z0-9-']+$/.test(word) && !stopwords.has(word)),
    ),
  ];
}

export function evaluateVivaAnswer(reference, answer) {
  const referenceTerms = conceptTerms(reference);
  const answerTerms = new Set(normalizeAnswerText(answer).split(" ").filter(Boolean));
  const matched = referenceTerms.filter((term) => answerTerms.has(term));
  const coverage = referenceTerms.length ? matched.length / referenceTerms.length : 0;
  const normalizedAnswer = normalizeAnswerText(answer);

  let verdict;
  let score;
  let explanation;
  if (!normalizedAnswer) {
    verdict = "incorrect";
    score = 0;
    explanation = "No answer was submitted for this question.";
  } else if (!referenceTerms.length) {
    // Without comparable reference concepts the server refuses to award full correctness.
    verdict = normalizedAnswer.split(" ").length >= 8 ? "partial" : "incorrect";
    score = verdict === "partial" ? 50 : 20;
    explanation =
      "The reference answer did not expose comparable concepts, so concept coverage could not be verified.";
  } else {
    score = Math.round(coverage * 100);
    if (coverage >= 0.6) verdict = "correct";
    else if (coverage >= 0.3) verdict = "partial";
    else verdict = "incorrect";
    explanation = `Matched ${matched.length} of ${referenceTerms.length} reference concepts${
      matched.length ? `: ${matched.slice(0, 6).join(", ")}` : ""
    }.`;
  }

  return {
    verdict,
    score,
    coverage: Number(coverage.toFixed(2)),
    matched,
    required: referenceTerms,
    explanation,
    reference: cleanText(reference, VIVA_LIMITS.answerChars),
  };
}

export function evaluateVivaSet({ questions, answers } = {}) {
  if (!Array.isArray(questions) || !questions.length || questions.length > VIVA_LIMITS.questions) {
    throw new ApiError(
      422,
      "invalid_input",
      `questions must contain 1 to ${VIVA_LIMITS.questions} items.`,
    );
  }
  if (!Array.isArray(answers) || answers.length !== questions.length) {
    throw new ApiError(422, "invalid_input", "answers must align with the submitted questions.");
  }

  const results = questions.map((question, index) => {
    const prompt = cleanText(question?.question ?? question?.prompt, VIVA_LIMITS.questionChars);
    if (!prompt) throw new ApiError(422, "invalid_input", `question ${index + 1} is required.`);
    const reference = cleanText(question?.answer, VIVA_LIMITS.answerChars);
    const evaluation = evaluateVivaAnswer(reference, answers[index]);
    return {
      index,
      question: prompt,
      verdict: evaluation.verdict,
      score: evaluation.score,
      coverage: evaluation.coverage,
      explanation: evaluation.explanation,
      reference: evaluation.reference,
    };
  });

  const score = Math.round(
    results.reduce((total, result) => total + result.score, 0) / results.length,
  );
  const completed = answers.filter((answer) => normalizeAnswerText(answer).length > 0).length;
  const verdict =
    results.every((result) => result.verdict === "correct") && completed === results.length
      ? "correct"
      : results.every((result) => result.verdict === "incorrect")
        ? "incorrect"
        : "partial";

  return {
    score,
    total: results.length,
    completed,
    verdict,
    results,
  };
}
