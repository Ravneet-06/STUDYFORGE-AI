import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app.mjs";
import { defaultProgress } from "../apps/api/src/progress.mjs";
import { createSupabaseStore } from "../apps/api/src/supabase.mjs";

const userA = `history-a-${randomUUID()}`;
const userB = `history-b-${randomUUID()}`;
const headersFor = (userId) => ({
  "content-type": "application/json",
  "x-studyforge-user": userId,
});

function memoryStore({ failHistory = false } = {}) {
  const plans = [];
  const history = [];
  const progress = new Map();
  const chunks = [
    {
      id: "chunk-osi-1",
      documentId: "doc-osi-a",
      userId: userA,
      index: 0,
      text: "The OSI model describes seven layers: physical, data link, network, transport, session, presentation, and application.",
      keywords: ["osi", "model", "layers", "network"],
    },
  ];
  return {
    newId: randomUUID,
    async getChunks(uid, documentId) {
      return chunks.filter(
        (chunk) => chunk.userId === uid && (!documentId || chunk.documentId === documentId),
      );
    },
    async getProgress(uid) {
      return progress.get(uid) || defaultProgress(uid);
    },
    async updateProgress(uid, patch) {
      const updated = { ...(await this.getProgress(uid)), ...patch };
      progress.set(uid, updated);
      return updated;
    },
    async addPlan(plan) {
      const saved = { ...plan, createdAt: new Date().toISOString() };
      plans.push(saved);
      return saved;
    },
    async listPlans(uid) {
      return plans.filter((plan) => plan.userId === uid);
    },
    async getPlan(uid, id) {
      return plans.find((plan) => plan.userId === uid && plan.id === id);
    },
    async addAskHistory(record) {
      if (failHistory) throw new Error("private database detail must not be exposed");
      const existing = history.find(
        (entry) => entry.userId === record.userId && entry.requestId === record.requestId,
      );
      if (existing) return existing;
      history.push(record);
      return record;
    },
    async listAskHistory(uid, limit, offset) {
      return history
        .filter((entry) => entry.userId === uid)
        .sort(
          (left, right) =>
            right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
        )
        .slice(offset, offset + limit);
    },
    history,
  };
}

describe("Ask StudyForge history", () => {
  let server;
  let base;
  let store;
  let activeUser;

  beforeEach(async () => {
    activeUser = userA;
    store = memoryStore();
    server = createServer(createApp({ staticRoot: "apps/web", storeFactory: () => store }));
    await new Promise((resolve) => server.listen(0, resolve));
    base = `http://localhost:${server.address().port}`;
  });

  afterEach(async () => {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  const call = async (path, options = {}, userId = activeUser) => {
    const response = await fetch(base + path, {
      ...options,
      headers: {
        ...headersFor(userId),
        ...(options.headers || {}),
      },
    });
    return { status: response.status, body: await response.json() };
  };
  const json = (value) => JSON.stringify(value);

  it("stores the visible grounded answer and sources once, under the authenticated user and selected plan", async () => {
    const createdPlan = await call("/api/plans", {
      method: "POST",
      body: json({
        title: "Computer Networks Revision",
        plan: { topic: "Computer Networks", sessions: 3 },
      }),
    });
    expect(createdPlan.status).toBe(201);
    const requestId = `ask-${randomUUID()}`;
    const question = "What are the seven layers of the OSI model?";
    const first = await call("/api/assistant", {
      method: "POST",
      headers: { "x-request-id": requestId },
      body: json({ question, user_id: userB, planId: "forged-plan" }),
    });
    expect(first.status).toBe(200);
    expect(first.body.grounded).toBe(true);
    expect(first.body.sources).toHaveLength(1);

    const retry = await call("/api/assistant", {
      method: "POST",
      headers: { "x-request-id": requestId },
      body: json({ question }),
    });
    expect(retry.status).toBe(200);

    const listed = await call("/api/history?limit=10&offset=0&user_id=attacker");
    expect(listed).toMatchObject({ status: 200, body: { hasMore: false } });
    expect(listed.body.history).toHaveLength(1);
    expect(listed.body.history[0]).toMatchObject({
      question,
      answer: first.body.answer,
      grounded: true,
      provider: first.body.provider,
      studyPlanId: createdPlan.body.plan.id,
      requestId,
      sources: [
        {
          documentId: "doc-osi-a",
          chunkId: "chunk-osi-1",
          excerpt: expect.stringContaining("seven layers"),
        },
      ],
    });
    expect(store.history).toHaveLength(1);
    expect((await call("/api/progress")).body.weeklyStudy.completed).toBe(0);
  });

  it("starts another user with empty history and stores NULL plan when none is selected", async () => {
    const empty = await call("/api/history", {}, userB);
    expect(empty).toMatchObject({ status: 200, body: { history: [], hasMore: false } });

    const answer = await call(
      "/api/assistant",
      {
        method: "POST",
        headers: { "x-request-id": `ask-${randomUUID()}` },
        body: json({ question: "What is in my library?", user_id: userA }),
      },
      userB,
    );
    expect(answer.status).toBe(200);
    const ownHistory = await call("/api/history?user_id=history-a", {}, userB);
    expect(ownHistory.body.history).toHaveLength(1);
    expect(ownHistory.body.history[0].studyPlanId).toBeNull();

    const stillIsolated = await call("/api/history", {}, userA);
    expect(stillIsolated.body.history).toEqual([]);
  });

  it("persists the exact fallback answer displayed for an empty assistant answer", async () => {
    const fallback = "I couldn't find support for that in your library.";
    await new Promise((resolve) => server.close(resolve));
    server = createServer(
      createApp({
        staticRoot: "apps/web",
        storeFactory: () => store,
        assistantOrchestrator: async () => ({
          answer: "",
          grounded: false,
          sources: [],
          provider: "local",
        }),
      }),
    );
    await new Promise((resolve) => server.listen(0, resolve));
    base = `http://localhost:${server.address().port}`;

    const response = await call("/api/assistant", {
      method: "POST",
      headers: { "x-request-id": `ask-${randomUUID()}` },
      body: json({ question: "A question without an answer" }),
    });
    expect(response.status).toBe(200);
    expect(response.body.answer).toBe("");
    expect(store.history[0].answer).toBe(fallback);
    const ui = await readFile(new URL("../apps/web/app.js", import.meta.url), "utf8");
    expect(ui).toContain(`result.answer || "${fallback}"`);
  });

  it("rejects unauthenticated GET /api/history in production mode", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const response = await fetch(`${base}/api/history`);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        error: { code: "unauthorized", message: "Authentication required." },
      });
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it("scopes request ID uniqueness by user", async () => {
    const requestId = "same-request-id";
    const userAResponse = await call(
      "/api/assistant",
      {
        method: "POST",
        headers: { "x-request-id": requestId },
        body: json({ question: "What are the OSI layers?" }),
      },
      userA,
    );
    const userBResponse = await call(
      "/api/assistant",
      {
        method: "POST",
        headers: { "x-request-id": requestId },
        body: json({ question: "What is in my library?" }),
      },
      userB,
    );

    expect(userAResponse.status).toBe(200);
    expect(userBResponse.status).toBe(200);
    expect(store.history).toHaveLength(2);
    expect(store.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: userA, requestId }),
        expect.objectContaining({ userId: userB, requestId }),
      ]),
    );
    expect((await call("/api/history", {}, userA)).body.history).toHaveLength(1);
    expect((await call("/api/history", {}, userB)).body.history).toHaveLength(1);
  });

  it("does not let a user associate another user's plan or access or modify another user's history", async () => {
    const plan = await call("/api/plans", {
      method: "POST",
      body: json({ title: "Private plan", plan: { topic: "Networks", sessions: 3 } }),
    });
    const planAttack = await call(
      "/api/progress",
      { method: "POST", body: json({ currentPlanId: plan.body.plan.id }) },
      userB,
    );
    expect(planAttack.status).toBe(404);

    const response = await call(
      "/api/assistant",
      {
        method: "POST",
        headers: { "x-request-id": `ask-${randomUUID()}` },
        body: json({ question: "Explain the OSI layers", planId: plan.body.plan.id }),
      },
      userA,
    );
    const record = (await call("/api/history")).body.history[0];
    const hidden = await call(`/api/history/${record.id}`, {}, userB);
    const attemptedChange = await call(
      `/api/history/${record.id}`,
      { method: "PATCH", body: json({ answer: "changed" }) },
      userB,
    );
    expect(response.status).toBe(200);
    expect(hidden.status).toBe(404);
    expect(attemptedChange.status).toBe(404);
    expect((await call("/api/history", {}, userB)).body.history).toEqual([]);
  });

  it("keeps the assistant response and evidence intact when history persistence fails", async () => {
    store = memoryStore({ failHistory: true });
    // createApp owns the store instance captured at construction, so this server gets an injected failing store.
    await new Promise((resolve) => server.close(resolve));
    server = createServer(createApp({ staticRoot: "apps/web", storeFactory: () => store }));
    await new Promise((resolve) => server.listen(0, resolve));
    base = `http://localhost:${server.address().port}`;

    const response = await call("/api/assistant", {
      method: "POST",
      headers: { "x-request-id": `ask-${randomUUID()}` },
      body: json({ question: "What are the OSI layers?" }),
    });
    expect(response.status).toBe(200);
    expect(response.body.grounded).toBe(true);
    expect(response.body.sources).toHaveLength(1);
    expect(JSON.stringify(response.body)).not.toContain("private database detail");
    expect((await call("/api/history")).body.history).toEqual([]);
  });

  it("paginates newest-first and rejects unsafe page sizes", async () => {
    for (const question of ["First question", "Second question"]) {
      await call("/api/assistant", {
        method: "POST",
        headers: { "x-request-id": `ask-${randomUUID()}` },
        body: json({ question }),
      });
    }
    const page = await call("/api/history?limit=1&offset=0");
    expect(page.status).toBe(200);
    expect(page.body.history).toHaveLength(1);
    expect(page.body.hasMore).toBe(true);
    expect((await call("/api/history?limit=51")).status).toBe(422);
    expect((await call("/api/history?offset=-1")).status).toBe(422);
  });

  it("defines owner-only RLS, plan ownership, and request-id uniqueness in migration 0009", async () => {
    const sql = await readFile(
      new URL("../supabase/migrations/0009_ask_study_history.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toMatch(/alter table public\.ask_history enable row level security/i);
    expect(sql).toMatch(
      /for select to authenticated\s+using \(user_id = \(select auth\.uid\(\)\)\)/i,
    );
    expect(sql).toMatch(
      /for insert to authenticated\s+with check \(user_id = \(select auth\.uid\(\)\)\)/i,
    );
    expect(sql).toMatch(/unique \(user_id, request_id\)/i);
    expect(sql).toMatch(/references public\.study_plans \(id, user_id\)/i);
    expect(sql).not.toMatch(/for (update|delete) to authenticated/i);
  });

  it("uses authenticated owner filters and an idempotent Supabase insert", async () => {
    const calls = [];
    vi.stubGlobal("fetch", async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (options.method === "POST") return new Response(null, { status: 204 });
      return new Response(
        JSON.stringify([
          {
            id: "history-1",
            study_plan_id: null,
            question: "Question",
            answer: "Answer",
            created_at: "2026-09-30T10:00:00.000Z",
            grounded: true,
            provider: "local",
            sources: [],
            request_id: "req-1",
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    try {
      const store = createSupabaseStore(
        { url: "https://studyforge.test", anonKey: "public-anon-key" },
        "user-access-token",
      );
      await store.addAskHistory({
        id: "history-1",
        userId: userA,
        studyPlanId: null,
        question: "Question",
        answer: "Answer",
        createdAt: "2026-09-30T10:00:00.000Z",
        grounded: true,
        provider: "local",
        sources: [],
        requestId: "req-1",
      });
      const rows = await store.listAskHistory(userA, 10, 0);
      expect(rows).toHaveLength(1);
      expect(calls[0].url).toContain("on_conflict=user_id,request_id");
      expect(calls[0].options.headers.prefer).toContain("resolution=ignore-duplicates");
      expect(JSON.parse(calls[0].options.body).user_id).toBe(userA);
      expect(calls[1].url).toContain(`user_id=eq.${encodeURIComponent(userA)}`);
      expect(calls[1].url).not.toContain("user-access-token");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
