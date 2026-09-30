import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { createApp } from "../apps/api/src/app.mjs";
import { calculateQuizProgress, gradeQuiz } from "../apps/web/quiz.mjs";

const runId = Date.now().toString(36);
const identity = {
  "content-type": "application/json",
  "x-studyforge-user": `e2e-${runId}`,
};

let server;
let base;

const call = async (path, options = {}, headers = identity) => {
  const response = await fetch(base + path, { headers, ...options });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { status: response.status, headers: response.headers, body };
};

beforeAll(async () => {
  server = createServer(createApp({ staticRoot: "apps/web" }));
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe("end-to-end student workflow (local, deterministic)", () => {
  it("runs the full grounded study journey without external services", async () => {
    // 1. Open application
    expect((await call("/")).status).toBe(200);
    // 2. Authentication
    const me = await call("/api/auth/me");
    expect(me.body.user.id).toBe(identity["x-studyforge-user"]);
    // 3. Dashboard data loads
    expect((await call("/api/progress")).status).toBe(200);

    // 4. Upload study material (Markdown/PDF/DOCX share the same ingestion pipeline)
    const upload = await call("/api/documents", {
      method: "POST",
      body: JSON.stringify({
        title: "E2E networking notes",
        name: "notes.md",
        type: "text/markdown",
        data: Buffer.from(
          "# Networking\nThe OSI model separates network communication into seven layers. The transport layer provides reliable delivery using TCP.",
          "utf8",
        ).toString("base64"),
      }),
    });
    expect(upload.status).toBe(201);
    const documentId = upload.body.document.id;

    // 5. Library shows the document
    expect((await call("/api/documents")).body.documents.map((item) => item.id)).toContain(
      documentId,
    );

    // 6/7. Ask a grounded question and receive evidence
    const answer = await call("/api/assistant", {
      method: "POST",
      body: JSON.stringify({
        question: "How many layers does the OSI model separate network communication into?",
      }),
    });
    expect(answer.body.grounded).toBe(true);
    expect(answer.body.sources.length).toBeGreaterThan(0);
    expect(answer.body.sources[0].documentId).toBe(documentId);
    expect(answer.body.sources[0].chunkId).toBeTruthy();

    // 8. Unsupported question is refused instead of fabricated
    const refused = await call("/api/assistant", {
      method: "POST",
      body: JSON.stringify({ question: "What is the capital of the planet Zorgon?" }),
    });
    expect(refused.body.grounded).toBe(false);
    expect(refused.body.sources).toEqual([]);

    // 9/10. Generate a grounded summary and explanation
    const summary = await call("/api/generate", {
      method: "POST",
      body: JSON.stringify({ kind: "summary", topic: "OSI model" }),
    });
    expect(summary.body.grounded).toBe(true);
    expect(typeof summary.body.summary).toBe("string");
    const explanation = await call("/api/generate", {
      method: "POST",
      body: JSON.stringify({ kind: "explanation", topic: "transport layer" }),
    });
    expect(explanation.body.grounded).toBe(true);

    // 11. Generate MCQs and persist the quiz through the existing quiz API
    const mcq = await call("/api/generate", {
      method: "POST",
      body: JSON.stringify({ kind: "mcq", topic: "OSI model" }),
    });
    const questions = mcq.body.questions;
    expect(questions.length).toBeGreaterThan(0);
    const quiz = await call("/api/quizzes", {
      method: "POST",
      body: JSON.stringify({
        title: "E2E MCQ practice",
        questions: questions.map((question) => ({
          prompt: question.question,
          options: question.options,
          answer: question.answer,
        })),
      }),
    });
    expect(quiz.status).toBe(201);
    expect((await call(`/api/quizzes/${quiz.body.quiz.id}`)).status).toBe(200);

    // 12/13. Answer the MCQs and compute the score
    const answers = {};
    questions.forEach((question, index) => {
      const correctIndex = question.options.indexOf(question.answer);
      answers[index] = String(
        index === 0 ? correctIndex : (correctIndex + 1) % question.options.length,
      );
    });
    const graded = gradeQuiz(questions, answers);
    expect(graded.score).toBe(1);
    expect(graded.total).toBe(questions.length);
    const attempt = await call(`/api/quizzes/${quiz.body.quiz.id}/attempts`, {
      method: "POST",
      body: JSON.stringify({ score: calculateQuizProgress(graded), answers }),
    });
    expect(attempt.status).toBe(201);

    // 14. Progress updates from MCQ activity
    const afterQuiz = (await call("/api/progress")).body.progress;
    expect(afterQuiz.quizAttempts).toBe(1);
    expect(afterQuiz.completed).toBeGreaterThan(0);
    expect(afterQuiz.recentActivity.length).toBeGreaterThan(0);

    // 15. Generate Viva questions
    const viva = await call("/api/generate", {
      method: "POST",
      body: JSON.stringify({ kind: "viva", topic: "OSI model" }),
    });
    const vivaQuestions = viva.body.questions;
    expect(vivaQuestions.length).toBeGreaterThan(0);
    expect(vivaQuestions[0].options ?? []).toHaveLength(0);
    expect(typeof vivaQuestions[0].answer).toBe("string");

    // 16/17. Submit Viva answers and receive a real evaluation
    const evaluation = await call("/api/viva/evaluate", {
      method: "POST",
      body: JSON.stringify({
        questions: vivaQuestions.map((question) => ({
          question: question.question,
          answer: question.answer,
        })),
        answers: vivaQuestions.map((question) => question.answer),
      }),
    });
    expect(evaluation.status).toBe(200);
    expect(evaluation.body.evaluation.score).toBeGreaterThan(0);
    expect(evaluation.body.evaluation.results[0].verdict).toBe("correct");
    expect(evaluation.body.evaluation.results[0].explanation).toBeTruthy();

    // 18. Progress updates from Viva activity
    expect(evaluation.body.progress.vivaAttempts).toBe(1);

    // 19. Create a study plan
    const plan = await call("/api/plans", {
      method: "POST",
      body: JSON.stringify({
        title: "E2E plan",
        plan: { topic: "OSI model", sessions: 3, milestone: "Review the seven layers" },
      }),
    });
    expect(plan.status).toBe(201);

    // 20/21. Refresh the workspace and confirm persistence
    const refreshedProgress = (await call("/api/progress")).body.progress;
    const refreshedPlans = (await call("/api/plans")).body.plans;
    expect(refreshedPlans.some((item) => item.id === plan.body.plan.id)).toBe(true);
    expect(refreshedProgress.quizAttempts).toBe(1);
    expect(refreshedProgress.vivaAttempts).toBe(1);
    expect(refreshedProgress.averageQuizScore).toBeGreaterThanOrEqual(0);
    expect((await call(`/api/documents/${documentId}`)).status).toBe(200);
    expect((await call(`/api/documents/${documentId}/chunks`)).body.chunks.length).toBeGreaterThan(
      0,
    );

    // 22. Delete the document and its dependent chunks
    expect((await call(`/api/documents/${documentId}`, { method: "DELETE" })).status).toBe(200);

    // 23. The library empty state is reached for that document
    expect((await call(`/api/documents/${documentId}`)).status).toBe(404);
    expect(
      (await call("/api/documents")).body.documents.some((item) => item.id === documentId),
    ).toBe(false);
  });
});
