import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { createApp } from "../apps/api/src/app.mjs";
import { createSupabaseStore } from "../apps/api/src/supabase.mjs";

const userId = "11111111-1111-1111-1111-111111111111";

// Columns that exist after migrations 0001-0005, i.e. before 0006_progress_activity.sql is applied
// to the deployed Supabase project. This mirrors a project whose database has not been pushed yet.
const deployedProgressColumns = new Set(["user_id", "completed", "hours", "plan", "updated_at"]);

function startStub() {
  const state = { progress: null, requests: [], inserts: [], quizzes: [], questions: [] };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://stub");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(body === undefined ? "" : JSON.stringify(body));
    };
    state.requests.push({
      method: req.method,
      path: url.pathname + url.search,
      body: raw ? JSON.parse(raw) : null,
    });

    if (url.pathname === "/auth/v1/user")
      return send(200, { id: userId, email: "learner@example.com" });
    if (url.pathname === "/rest/v1/quizzes" && req.method === "GET") {
      const id = url.searchParams.get("id");
      return send(
        200,
        state.quizzes
          .filter((row) => !id || id === `eq.${row.id}`)
          .map((row) => ({
            ...row,
            quiz_questions: state.questions.filter((question) => question.quiz_id === row.id),
          })),
      );
    }
    if (url.pathname === "/rest/v1/progress" && req.method === "GET")
      return send(200, state.progress ? [state.progress] : []);
    if (url.pathname === "/rest/v1/progress" && req.method === "POST") {
      const body = raw ? JSON.parse(raw) : {};
      if (body.plan === "FORCE_FAILURE")
        return send(400, { code: "42501", message: "permission denied for table progress" });
      const unknown = Object.keys(body).filter((key) => !deployedProgressColumns.has(key));
      if (unknown.length)
        return send(400, {
          code: "PGRST204",
          details: null,
          hint: null,
          message: `Could not find the '${unknown[0]}' column of 'progress' in the schema cache`,
        });
      state.progress = { updated_at: new Date().toISOString(), ...body };
      return send(201, [state.progress]);
    }
    // Strict column validation for the quiz tables: PostgREST rejects any key that is not a real
    // column, which is how a camelCase leak (quizId/userId) surfaced as a 400.
    const quizTables = {
      "/rest/v1/quizzes": ["id", "user_id", "document_id", "title", "created_at"],
      "/rest/v1/quiz_questions": [
        "id",
        "quiz_id",
        "user_id",
        "prompt",
        "options",
        "answer",
        "created_at",
      ],
      "/rest/v1/quiz_attempts": ["id", "quiz_id", "user_id", "score", "answers", "created_at"],
    };
    if (req.method === "POST" && quizTables[url.pathname]) {
      const columns = quizTables[url.pathname];
      const rows = Array.isArray(JSON.parse(raw || "[]")) ? JSON.parse(raw) : [JSON.parse(raw)];
      for (const row of rows) {
        const unknown = Object.keys(row).filter((key) => !columns.includes(key));
        if (unknown.length)
          return send(400, {
            code: "PGRST204",
            message: `Could not find the '${unknown[0]}' column of '${url.pathname.split("/").at(-1)}' in the schema cache`,
          });
      }
      state.inserts.push({ table: url.pathname.split("/").at(-1), rows });
      if (url.pathname === "/rest/v1/quizzes") state.quizzes.push(...rows);
      if (url.pathname === "/rest/v1/quiz_questions") state.questions.push(...rows);
      return send(
        201,
        rows.map((row) => ({ created_at: new Date().toISOString(), ...row })),
      );
    }
    if (url.pathname === "/rest/v1/document_chunks")
      return send(200, [
        {
          id: "chunk-1",
          document_id: "doc-1",
          user_id: userId,
          chunk_index: 0,
          content: "The OSI model separates network communication into seven layers.",
        },
      ]);
    return send(200, []);
  });
  return { server, state };
}

describe("Supabase progress schema compatibility", () => {
  let stub;
  let apiServer;
  let base;
  let previous;

  beforeAll(async () => {
    previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_ANON_KEY };
    stub = startStub();
    await new Promise((resolve) => stub.server.listen(0, resolve));
    process.env.SUPABASE_URL = `http://localhost:${stub.server.address().port}`;
    process.env.SUPABASE_ANON_KEY = "stub-anon-key";
    apiServer = createServer(createApp({ staticRoot: "apps/web" }));
    await new Promise((resolve) => apiServer.listen(0, resolve));
    base = `http://localhost:${apiServer.address().port}`;
  });

  afterAll(async () => {
    process.env.SUPABASE_URL = previous.url || "";
    process.env.SUPABASE_ANON_KEY = previous.key || "";
    await new Promise((resolve) => apiServer.close(resolve));
    await new Promise((resolve) => stub.server.close(resolve));
  });

  const auth = { "content-type": "application/json", authorization: "Bearer stub-token" };

  it("reports lost activity persistence on an un-migrated schema instead of claiming success", async () => {
    const response = await fetch(`${base}/api/generate`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ kind: "mcq", topic: "OSI model" }),
    });
    const body = await response.json();

    // The exact previously failing request: POST /rest/v1/progress with 0006-only columns.
    const progressPosts = stub.state.requests.filter(
      (entry) => entry.method === "POST" && entry.path.startsWith("/rest/v1/progress"),
    );
    expect(progressPosts.length).toBeGreaterThanOrEqual(2);
    expect(progressPosts[0].body).toHaveProperty("points");

    expect(response.status).toBe(200);
    expect(body.questions.length).toBeGreaterThan(0);
    // The activity still persisted using only the columns the deployed schema has.
    expect(stub.state.progress).toBeTruthy();
    expect(Object.keys(stub.state.progress)).not.toContain("points");
    expect(stub.state.progress.completed).toBeGreaterThan(0);

    const saved = await fetch(`${base}/api/quizzes`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        title: "Progress schema compatibility",
        questions: [
          { prompt: "Which layer?", options: ["Network", "Physical"], answer: "Network" },
        ],
      }),
    });
    const quiz = (await saved.json()).quiz;
    const attempt = await fetch(`${base}/api/quizzes/${quiz.id}/attempts`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ score: 100, answers: { 0: "1" } }),
    });
    const attemptBody = await attempt.json();
    expect(attempt.status).toBe(201);
    expect(attemptBody.attempt.score).toBe(0);
    expect(attemptBody.progressPersisted).toBe(false);
  });

  it("still reads progress on the deployed schema", async () => {
    const response = await fetch(`${base}/api/progress`, { headers: auth });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.progress).not.toHaveProperty("streak");
    expect(body.progress.userId).toBe(userId);
  });

  it("does not hide unrelated Supabase failures", async () => {
    const store = createSupabaseStore(
      { url: process.env.SUPABASE_URL, anonKey: "stub-anon-key" },
      "stub-token",
    );
    await expect(store.updateProgress(userId, { plan: "FORCE_FAILURE" })).rejects.toThrow(
      /Supabase request failed \(400\)/,
    );
  });

  it("sends only real columns when recording a quiz attempt", async () => {
    const store = createSupabaseStore(
      { url: process.env.SUPABASE_URL, anonKey: "stub-anon-key" },
      "stub-token",
    );
    await store.addAttempt({
      id: "attempt-1",
      quizId: "quiz-1",
      userId,
      score: 100,
      answers: { 0: "Mitochondria" },
    });
    const attemptPost = stub.state.requests
      .filter((entry) => entry.method === "POST" && entry.path.startsWith("/rest/v1/quiz_attempts"))
      .at(-1);
    expect(Object.keys(attemptPost.body).sort()).toEqual([
      "answers",
      "id",
      "quiz_id",
      "score",
      "user_id",
    ]);
    expect(attemptPost.body).not.toHaveProperty("quizId");
    expect(attemptPost.body).not.toHaveProperty("userId");
  });

  it("runs the full Practice Lab flow: generate, save the quiz, and record the attempt", async () => {
    const generated = await fetch(`${base}/api/generate`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ kind: "mcq", topic: "OSI model layers" }),
    });
    const questions = (await generated.json()).questions;
    expect(generated.status).toBe(200);
    expect(questions.length).toBeGreaterThan(0);

    const saved = await fetch(`${base}/api/quizzes`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        title: "Supabase MCQ practice",
        questions: questions.map((question) => ({
          prompt: question.question,
          options: question.options,
          answer: question.answer,
        })),
      }),
    });
    const quiz = await saved.json();
    expect(saved.status).toBe(201);

    const attempt = await fetch(`${base}/api/quizzes/${quiz.quiz.id}/attempts`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        score: 0,
        answers: Object.fromEntries(
          questions.map((question, index) => [
            index,
            String(question.options.indexOf(question.answer)),
          ]),
        ),
      }),
    });
    const attemptBody = await attempt.json();
    expect(attempt.status).toBe(201);
    expect(attemptBody.attempt.score).toBe(100);

    // Every quiz-table write used real snake_case columns only.
    const tables = stub.state.inserts.map((entry) => entry.table);
    expect(tables).toContain("quizzes");
    expect(tables).toContain("quiz_questions");
    expect(tables).toContain("quiz_attempts");
    for (const entry of stub.state.inserts) {
      for (const row of entry.rows) {
        expect(Object.keys(row).every((key) => /^[a-z_]+$/.test(key))).toBe(true);
      }
    }
  });
});
