import { createServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../apps/api/src/app.mjs";
import { authenticateRequest } from "../apps/api/src/supabase.mjs";

let server;
let base;

beforeEach(async () => {
  server = createServer(createApp({ staticRoot: "apps/web" }));
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

async function call(path, options = {}) {
  const response = await fetch(base + path, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  return { response, body: await response.json() };
}

describe("backend API contracts", () => {
  it("supports versioned document, source, progress, quiz, and plan flows", async () => {
    const headers = { "x-studyforge-user": "contract-user" };
    const created = await call("/api/v1/documents", {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "Chemistry", content: "Atoms contain protons and neutrons." }),
    });
    expect(created.response.status).toBe(201);
    const id = created.body.document.id;

    const detail = await call(`/api/documents/${id}`, { headers });
    const chunks = await call(`/api/documents/${id}/chunks`, { headers });
    expect(detail.body.document.userId).toBe("contract-user");
    expect(chunks.body.chunks).toHaveLength(1);

    const progress = await call("/api/progress", {
      method: "POST",
      headers,
      body: JSON.stringify({ completed: 50, streak: 2, hours: 1.5 }),
    });
    expect(progress.body.progress.completed).toBe(50);

    const quiz = await call("/api/quizzes", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "Atoms",
        questions: [{ prompt: "What do atoms contain?", options: ["Protons"], answer: "Protons" }],
      }),
    });
    expect(quiz.response.status).toBe(201);
    const attempt = await call(`/api/quizzes/${quiz.body.quiz.id}/attempts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ score: 100, answers: { 0: "Protons" } }),
    });
    expect(attempt.response.status).toBe(201);

    const plan = await call("/api/plans", {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "Daily review", plan: { minutes: 25 } }),
    });
    expect(plan.response.status).toBe(201);
  });

  it("returns consistent validation and not-found errors", async () => {
    const invalid = await call("/api/documents", {
      method: "POST",
      headers: { "x-studyforge-user": "validation-user" },
      body: JSON.stringify({ title: "" }),
    });
    expect(invalid.response.status).toBe(422);
    expect(invalid.body.error.code).toBe("invalid_input");
    expect(invalid.body.requestId).toBeTruthy();

    const missing = await call("/api/documents/missing-document", {
      headers: { "x-studyforge-user": "validation-user" },
    });
    expect(missing.response.status).toBe(404);
    expect(missing.body.error.code).toBe("not_found");
  });

  it("denies cross-user document access", async () => {
    const owner = { "x-studyforge-user": "owner-contract" };
    const other = { "x-studyforge-user": "other-contract" };
    const created = await call("/api/documents", {
      method: "POST",
      headers: owner,
      body: JSON.stringify({ title: "Private", content: "Owner-only material." }),
    });
    const response = await call(`/api/documents/${created.body.document.id}`, { headers: other });
    expect(response.response.status).toBe(404);
    expect(response.body.error.code).toBe("not_found");
  });

  it("requires a bearer token when Supabase authentication is enabled", async () => {
    await expect(
      authenticateRequest({ headers: {} }, { url: "https://example.supabase.co", anonKey: "test" }),
    ).rejects.toThrow("Authentication required.");
  });
});
