function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );
}

export function renderQuiz(questions) {
  return `<form class="quiz-form" id="quiz-form"><div class="question-list">${questions
    .map(
      (question, index) =>
        `<fieldset class="question"><legend><span>${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(question.question)}</strong></legend><div class="options">${(
          question.options || []
        )
          .map(
            (option, optionIndex) =>
              `<label class="quiz-option"><input type="radio" name="question-${index}" value="${optionIndex}" /><span>${escapeHtml(option)}</span></label>`,
          )
          .join("")}</div></fieldset>`,
    )
    .join(
      "",
    )}</div><button class="button quiz-submit" type="submit">Submit answers <span>→</span></button><div id="quiz-feedback" aria-live="polite"></div></form>`;
}

export function renderViva(questions) {
  return `<form class="quiz-form viva-form" id="viva-form"><div class="question-list">${questions
    .map(
      (question, index) =>
        `<fieldset class="question"><legend><span>${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(question.question)}</strong></legend><label class="viva-answer-label" for="viva-answer-${index}">Your answer<textarea id="viva-answer-${index}" name="question-${index}" rows="3" placeholder="Explain in your own words…"></textarea></label></fieldset>`,
    )
    .join(
      "",
    )}</div><button class="button quiz-submit" type="submit">Check answers <span>→</span></button><div id="viva-feedback" aria-live="polite"></div></form>`;
}

export function gradeQuiz(questions, answers) {
  const results = questions.map((question, index) => {
    const selectedIndex = answers[index] === undefined ? null : Number(answers[index]);
    const selected = Number.isInteger(selectedIndex)
      ? question.options?.[selectedIndex]
      : undefined;
    const correct = question.answer;
    return {
      correct: selected === correct,
      selected: selected || "No answer selected",
      answer: correct || "No correct answer provided",
    };
  });
  return {
    score: results.filter((result) => result.correct).length,
    total: results.length,
    results,
  };
}

export function renderQuizFeedback(graded) {
  return `<div class="quiz-score"><strong>Score: ${graded.score}/${graded.total}</strong><span>${graded.total ? Math.round((graded.score / graded.total) * 100) : 0}% correct</span></div><div class="quiz-review">${graded.results
    .map(
      (result, index) =>
        `<div class="quiz-review-item ${result.correct ? "correct" : "incorrect"}"><strong>${result.correct ? "Correct" : "Incorrect"} · Question ${index + 1}</strong><span>Your answer: ${escapeHtml(result.selected)}</span>${result.correct ? "" : `<span>Correct answer: ${escapeHtml(result.answer)}</span>`}</div>`,
    )
    .join("")}</div>`;
}

export function renderVivaFeedback(questions, answers, evaluation = null) {
  const completed = answers.filter((answer) => answer.trim()).length;
  const summary = evaluation
    ? `<div class="quiz-score"><strong>Score: ${evaluation.score}%</strong><span>${completed}/${answers.length} completed · ${escapeHtml(evaluation.verdict || "evaluated")}</span></div>`
    : `<div class="quiz-score"><strong>Answers submitted</strong><span>${completed}/${answers.length} completed</span></div>`;
  const review = answers
    .map((answer, index) => {
      const result = evaluation?.results?.[index];
      const verdict = result?.verdict;
      const state = verdict
        ? verdict === "correct"
          ? "correct"
          : "incorrect"
        : answer.trim()
          ? "correct"
          : "incorrect";
      const heading = verdict
        ? `${String(verdict).toUpperCase()} · Question ${index + 1}`
        : `${answer.trim() ? "Answer recorded" : "No answer"} · Question ${index + 1}`;
      return `<div class="quiz-review-item ${state}"><strong>${escapeHtml(heading)}</strong><span>Your answer: ${escapeHtml(answer.trim() || "No answer provided")}</span>${
        result ? `<span>${escapeHtml(result.explanation)}</span>` : ""
      }<span>Reference answer: ${escapeHtml(result?.reference || questions[index]?.answer || "No reference answer available")}</span></div>`;
    })
    .join("");
  return `${summary}<div class="quiz-review">${review}</div>`;
}

export function calculateQuizProgress(graded) {
  if (!graded || !Number.isFinite(graded.total) || graded.total <= 0) return 0;
  const score = Number(graded.score) || 0;
  return Math.min(100, Math.max(0, Math.round((score / graded.total) * 100)));
}

export async function submitQuizProgress(graded, saveProgress) {
  if (!graded || !Number.isFinite(graded.total) || graded.total <= 0) return null;
  const completed = calculateQuizProgress(graded);
  return await saveProgress("/api/progress", {
    method: "POST",
    body: JSON.stringify({ completed }),
  });
}

export async function saveGeneratedQuiz(save, { title, questions, documentId, planId }) {
  const payload = {
    title: String(title || "Practice set").slice(0, 200),
    questions: (questions || []).slice(0, 20).map((question) => ({
      prompt: String(question.question || question.prompt || "").slice(0, 1000),
      options: Array.isArray(question.options)
        ? question.options.slice(0, 10).map((option) => String(option).slice(0, 300))
        : [],
      answer: typeof question.answer === "string" ? question.answer.slice(0, 1000) : null,
    })),
    ...(documentId ? { documentId } : {}),
    ...(planId ? { planId } : {}),
  };
  const result = await save("/api/quizzes", { method: "POST", body: JSON.stringify(payload) });
  return result?.quiz?.id || null;
}

export async function submitQuizAttempt(save, quizId, answers = {}) {
  if (!quizId) return null;
  return await save(`/api/quizzes/${encodeURIComponent(quizId)}/attempts`, {
    method: "POST",
    body: JSON.stringify({ answers }),
  });
}

export async function evaluateViva(save, questions, answers, planId) {
  return await save("/api/viva/evaluate", {
    method: "POST",
    body: JSON.stringify({
      questions: (questions || []).slice(0, 20).map((question) => ({
        question: String(question.question || "").slice(0, 1200),
        answer: String(question.answer || "").slice(0, 2000),
      })),
      answers: (answers || []).slice(0, 20).map((answer) => String(answer || "").slice(0, 2000)),
      ...(planId ? { planId } : {}),
    }),
  });
}
