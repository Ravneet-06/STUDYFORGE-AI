import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app.mjs";
import {
  applyActivity,
  countStudySessions,
  defaultProgress,
  normalizeProgress,
  weekStartKey,
  weeklyStudySummary,
} from "../apps/api/src/progress.mjs";

const day = (index) => new Date(Date.UTC(2026, 0, 1 + index, 12));

const activityAt = (type, at) => ({ type, at: new Date(at).toISOString() });

const thisWeek = "2026-09-30T12:00:00.000Z";
describe("weekly study progress", () => {
  it.each([
    [0, 0],
    [1, 33],
    [2, 67],
    [3, 100],
    [5, 100],
  ])("calculates %i completed sessions against a 3-session plan", (completed, percentage) => {
    const progress = {
      currentPlanId: "plan-3",
      planWeeklyProgress: {
        "plan-3": { weekStart: "2026-09-28", sessions: completed },
      },
    };
    const summary = weeklyStudySummary(
      progress,
      [{ id: "plan-3", title: "Weekly plan", plan: { sessions: 3 } }],
      new Date(thisWeek),
    );
    expect(summary.completed).toBe(completed);
    expect(summary.target).toBe(3);
    expect(summary.percentage).toBe(percentage);
  });

  it("shows no fabricated target when there is no selected plan", () => {
    const noPlan = weeklyStudySummary({ recentActivity: [] }, [], new Date(thisWeek));
    expect(noPlan).toMatchObject({ completed: 0, target: 0, percentage: 0, hasPlan: false });
    expect(
      weeklyStudySummary(
        { currentPlanId: "missing" },
        [{ id: "another", title: "Unselected", plan: { sessions: 4 } }],
        new Date(thisWeek),
      ),
    ).toMatchObject({ completed: 0, target: 0, percentage: 0, hasPlan: true, planId: null });
  });

  it("uses the latest activity from this UTC Monday-to-Monday week only", () => {
    expect(weekStartKey(new Date("2026-09-28T00:00:00.000Z"))).toBe("2026-09-28");
    expect(weekStartKey(new Date("2026-10-04T23:59:59.000Z"))).toBe("2026-09-28");
    expect(weekStartKey(new Date("2026-10-05T00:00:00.000Z"))).toBe("2026-10-05");
    const summary = weeklyStudySummary(
      {
        currentPlanId: "plan",
        planWeeklyProgress: { plan: { weekStart: "2026-09-28", sessions: 1 } },
        recentActivity: [
          activityAt("quiz_attempt", "2026-09-27T23:59:00.000Z"),
          activityAt("quiz_attempt", "2026-09-28T00:01:00.000Z"),
        ],
      },
      [{ id: "plan", plan: { sessions: 3 } }],
      new Date("2026-09-28T01:00:00.000Z"),
    );
    expect(summary.completed).toBe(1);
  });

  it("keeps each plan's weekly sessions isolated and rolls them over at the UTC week boundary", () => {
    const progress = {
      currentPlanId: "plan-a",
      planWeeklyProgress: {
        "plan-a": { weekStart: "2026-09-28", sessions: 2 },
        "plan-b": { weekStart: "2026-09-28", sessions: 1 },
      },
    };
    const plans = [
      { id: "plan-a", title: "A", plan: { sessions: 3 } },
      { id: "plan-b", title: "B", plan: { sessions: 5 } },
    ];
    expect(weeklyStudySummary(progress, plans, new Date(thisWeek))).toMatchObject({
      planId: "plan-a",
      completed: 2,
      target: 3,
      percentage: 67,
    });
    progress.currentPlanId = "plan-b";
    expect(weeklyStudySummary(progress, plans, new Date(thisWeek))).toMatchObject({
      planId: "plan-b",
      completed: 1,
      target: 5,
      percentage: 20,
    });
    expect(weeklyStudySummary(progress, plans, new Date("2026-10-05T00:00:00.000Z"))).toMatchObject(
      {
        planId: "plan-b",
        completed: 0,
        target: 5,
        percentage: 0,
      },
    );
  });

  it("groups plan activities by a 60-minute gap and does not mix plans", () => {
    let progress = defaultProgress("u");
    progress = applyActivity(
      progress,
      { type: "study_generation", planId: "a" },
      new Date("2026-09-28T09:00:00.000Z"),
    ).progress;
    progress = applyActivity(
      progress,
      { type: "quiz_attempt", planId: "a", score: 70 },
      new Date("2026-09-28T09:30:00.000Z"),
    ).progress;
    progress = applyActivity(
      progress,
      { type: "viva_attempt", planId: "b", score: 80 },
      new Date("2026-09-28T10:00:00.000Z"),
    ).progress;
    progress = applyActivity(
      progress,
      { type: "study_generation", planId: "a" },
      new Date("2026-09-28T11:00:00.000Z"),
    ).progress;
    expect(progress.planWeeklyProgress.a.sessions).toBe(2);
    expect(progress.planWeeklyProgress.b.sessions).toBe(1);
    expect(progress.recentActivity.every((entry) => entry.planId)).toBe(true);
    expect(progress.activeDays).toBe(1);
  });

  it("groups same-session and same-day learning events instead of inflating the count", () => {
    const activities = [
      activityAt("study_generation", "2026-09-28T09:00:00.000Z"),
      activityAt("study_generation", "2026-09-28T09:20:00.000Z"),
      activityAt("quiz_attempt", "2026-09-28T09:45:00.000Z"),
      activityAt("viva_attempt", "2026-09-28T10:00:00.000Z"),
      activityAt("study_plan", "2026-09-28T10:05:00.000Z"),
    ];
    expect(countStudySessions(activities, new Date(thisWeek))).toBe(1);
  });

  it("counts another session on the same day after a full hour gap", () => {
    expect(
      countStudySessions(
        [
          activityAt("study_generation", "2026-09-28T09:00:00.000Z"),
          activityAt("quiz_attempt", "2026-09-28T10:00:00.000Z"),
        ],
        new Date(thisWeek),
      ),
    ).toBe(2);
  });

  it("persists the weekly session total from server-timestamped activities", () => {
    const first = applyActivity(
      defaultProgress("u"),
      { type: "study_generation" },
      new Date("2026-09-28T09:00:00.000Z"),
    );
    const second = applyActivity(
      first.progress,
      { type: "quiz_attempt", score: 73 },
      new Date("2026-09-28T09:30:00.000Z"),
    );
    const third = applyActivity(
      second.progress,
      { type: "viva_attempt", score: 3 },
      new Date("2026-09-28T11:00:00.000Z"),
    );
    expect(first.patch.weeklySessionWeekStart).toBe("2026-09-28");
    expect(second.patch.weeklySessions).toBe(1);
    expect(third.progress.weeklySessions).toBe(2);
    expect(third.progress.quizAttempts).toBe(1);
    expect(third.progress.averageQuizScore).toBe(73);
    expect(third.progress.vivaAttempts).toBe(1);
    expect(third.progress.averageVivaScore).toBe(3);
  });
});

describe("progress model", () => {
  it("records activity and updates activeDays", () => {
    const { progress } = applyActivity(
      defaultProgress("u"),
      { type: "quiz_attempt", score: 50 },
      day(0),
    );
    expect(progress.activeDays).toBe(1);
    expect(progress.quizAttempts).toBe(1);
    expect(progress.completed).toBeGreaterThan(0);
  });

  it("does not add another active day for same-day activity", () => {
    const first = applyActivity(
      defaultProgress("u"),
      { type: "study_generation" },
      day(0),
    ).progress;
    const second = applyActivity(first, { type: "study_generation" }, day(0)).progress;
    expect(second.activeDays).toBe(1);
    expect(second.generations).toBe(2);
  });

  it("counts another active day on the next date", () => {
    const first = applyActivity(
      defaultProgress("u"),
      { type: "study_generation" },
      day(0),
    ).progress;
    const second = applyActivity(first, { type: "study_generation" }, day(1)).progress;
    expect(second.activeDays).toBe(2);
  });

  it("keeps cumulative activeDays across a missed date", () => {
    const first = applyActivity(
      defaultProgress("u"),
      { type: "study_generation" },
      day(0),
    ).progress;
    const second = applyActivity(first, { type: "study_generation" }, day(1)).progress;
    const third = applyActivity(second, { type: "study_generation" }, day(3)).progress;
    expect(third.activeDays).toBe(3);
  });

  it("grows cumulative progress instead of replacing the last score", () => {
    let state = defaultProgress("u");
    state = applyActivity(state, { type: "quiz_attempt", score: 100 }, day(0)).progress;
    const afterHighScore = state.completed;
    state = applyActivity(state, { type: "quiz_attempt", score: 0 }, day(0)).progress;
    expect(state.completed).toBeGreaterThanOrEqual(afterHighScore);
    expect(state.averageQuizScore).toBe(50);
    expect(state.quizAttempts).toBe(2);
  });

  it("rejects unknown activity types", () => {
    expect(() => applyActivity(defaultProgress("u"), { type: "shell" })).toThrow();
  });

  it("normalizes impossible values from storage", () => {
    const progress = normalizeProgress("u", {
      completed: 900,
      hours: -1,
      points: -20,
    });
    expect(progress.completed).toBe(100);
    expect(progress.hours).toBe(0);
    expect(progress.points).toBe(0);
  });

  it("omits the retired field when reading legacy progress records", () => {
    expect(normalizeProgress("u", { activeDays: 2, streak: 4 })).not.toHaveProperty("streak");
    expect(normalizeProgress("u", { activeDays: 2, streak: 4 }).activeDays).toBe(2);
  });

  it("keeps an explicit completed patch authoritative while activity grows cumulatively", () => {
    let state = defaultProgress("u");
    state = applyActivity(state, { type: "quiz_attempt", score: 100 }, day(0)).progress;
    const afterActivity = state.completed;
    expect(afterActivity).toBeGreaterThan(0);

    const explicit = normalizeProgress("u", { ...state, completed: 10 });
    expect(explicit.completed).toBe(10);

    state = applyActivity(state, { type: "study_generation" }, day(0)).progress;
    expect(state.completed).toBeGreaterThanOrEqual(afterActivity);
  });
});

describe("progress API contracts", () => {
  let server;
  let base;
  let headers;
  beforeEach(async () => {
    headers = {
      "content-type": "application/json",
      "x-studyforge-user": `progress-user-${randomUUID()}`,
    };
    server = createServer(createApp({ staticRoot: "apps/web" }));
    await new Promise((resolve) => server.listen(0, resolve));
    base = `http://localhost:${server.address().port}`;
  });
  afterEach(async () => {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  const call = async (path, options = {}, identity = headers) => {
    const response = await fetch(base + path, { headers: identity, ...options });
    return { status: response.status, body: await response.json() };
  };

  it("grades MCQs on the server, records Viva activity, and isolates users", async () => {
    const quiz = await call("/api/quizzes", {
      method: "POST",
      body: JSON.stringify({
        title: "Cells",
        questions: [
          {
            prompt: "What produces energy?",
            options: ["Mitochondria", "Ribosome"],
            answer: "Mitochondria",
          },
        ],
      }),
    });
    const forged = await call(`/api/quizzes/${quiz.body.quiz.id}/attempts`, {
      method: "POST",
      body: JSON.stringify({
        score: 100,
        percentage: 100,
        points: 999,
        completed: 100,
        answers: { 0: "1" },
      }),
    });
    expect(forged.body.attempt.score).toBe(0);
    expect(forged.body.progressPersisted).toBe(true);
    const honest = await call(`/api/quizzes/${quiz.body.quiz.id}/attempts`, {
      method: "POST",
      body: JSON.stringify({ score: 0, answers: { 0: "0" } }),
    });
    expect(honest.body.attempt.score).toBe(100);
    const viva = await call("/api/viva/evaluate", {
      method: "POST",
      body: JSON.stringify({
        questions: [
          {
            question: "Explain respiration.",
            answer: "Mitochondria produce energy through respiration.",
          },
        ],
        answers: ["Mitochondria produce energy through respiration"],
      }),
    });
    expect(viva.body.evaluation.score).toBeGreaterThan(0);
    const progress = await call("/api/progress");
    expect(progress.body.progress.quizAttempts).toBe(2);
    expect(progress.body.progress.averageQuizScore).toBe(50);
    expect(progress.body.progress.vivaAttempts).toBe(1);
    expect(progress.body.progress.averageVivaScore).toBe(viva.body.evaluation.score);
    expect(progress.body.progress).not.toHaveProperty("streak");
    expect(progress.body.progress.recentActivity.length).toBeGreaterThanOrEqual(3);

    const other = await call("/api/progress", {}, { "x-studyforge-user": "isolated-user" });
    expect(other.body.progress.quizAttempts).toBe(0);
    expect(other.body.progress.completed).toBe(0);
    expect(other.body.progress.recentActivity).toEqual([]);
  });

  it("rejects client-owned completion and activity forgery", async () => {
    await call("/api/viva/evaluate", {
      method: "POST",
      body: JSON.stringify({
        questions: [{ question: "Explain respiration.", answer: "Mitochondria produce energy." }],
        answers: ["Mitochondria produce energy"],
      }),
    });
    const before = (await call("/api/progress")).body.progress;
    const patched = await call("/api/progress", {
      method: "POST",
      body: JSON.stringify({ completed: 20 }),
    });
    expect(patched.status).toBe(422);
    expect((await call("/api/progress")).body.progress.completed).toBe(before.completed);

    const forgedActivity = await call("/api/progress/activity", {
      method: "POST",
      body: JSON.stringify({ type: "quiz_attempt", score: 100 }),
    });
    expect(forgedActivity.status).toBe(422);
  });

  it("returns a current-plan weekly target without counting same-session actions twice", async () => {
    const createPlan = async (sessions) =>
      call("/api/plans", {
        method: "POST",
        body: JSON.stringify({
          title: `Weekly plan for ${sessions}`,
          plan: { topic: "Networking", sessions },
        }),
      });

    const firstPlan = await createPlan(3);
    expect(firstPlan.status).toBe(201);
    const firstActivity = await call("/api/progress/activity", {
      method: "POST",
      body: JSON.stringify({ type: "study_generation" }),
    });
    expect(firstActivity.status).toBe(422);

    const document = await call("/api/documents", {
      method: "POST",
      body: JSON.stringify({
        title: "Networking notes",
        content:
          "Networking protocols define how devices communicate across connected networks and exchange data reliably.",
      }),
    });
    expect(document.status).toBe(201);

    const activity = await call("/api/generate", {
      method: "POST",
      body: JSON.stringify({ kind: "summary", topic: "Networking" }),
    });
    expect(activity.status).toBe(200);
    const afterGeneration = (await call("/api/progress")).body;
    expect(afterGeneration.weeklyStudy).toMatchObject({
      completed: 1,
      target: 3,
      percentage: 33,
      usesPlanTarget: true,
    });

    const secondPlan = await createPlan(2);
    expect(secondPlan.status).toBe(201);
    const otherPlan = (await call("/api/progress")).body.weeklyStudy;
    expect(otherPlan).toMatchObject({
      completed: 1,
      target: 3,
      percentage: 33,
      planId: firstPlan.body.plan.id,
    });
    await call("/api/progress", {
      method: "POST",
      body: JSON.stringify({ currentPlanId: secondPlan.body.plan.id }),
    });
    const updated = (await call("/api/progress")).body.weeklyStudy;
    expect(updated).toMatchObject({
      completed: 0,
      target: 2,
      percentage: 0,
      planId: secondPlan.body.plan.id,
    });

    const fakeAttempt = await call("/api/progress/activity", {
      method: "POST",
      body: JSON.stringify({ type: "viva_attempt", score: 100 }),
    });
    expect(fakeAttempt.status).toBe(422);
  });

  it("creates, edits, selects, and deletes owned plans without reusing another plan's sessions", async () => {
    const savePlan = (title, topic, sessions, milestone) =>
      call("/api/plans", {
        method: "POST",
        body: JSON.stringify({ title, plan: { topic, sessions, milestone } }),
      });
    const a = await savePlan("Networks", "OSI", 3, "Review layers");
    const b = await savePlan("Databases", "DBMS", 5, "Review normalization");
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    const document = await call("/api/documents", {
      method: "POST",
      body: JSON.stringify({
        title: "Notes",
        content: "The networking OSI model has seven layers and networking TCP/IP has four layers.",
      }),
    });
    await call("/api/generate", {
      method: "POST",
      body: JSON.stringify({ kind: "summary", topic: "networking", planId: a.body.plan.id }),
    });
    let summary = (await call("/api/progress")).body.weeklyStudy;
    expect(summary).toMatchObject({
      planId: a.body.plan.id,
      completed: 1,
      target: 3,
      percentage: 33,
    });
    await call("/api/progress", {
      method: "POST",
      body: JSON.stringify({ currentPlanId: b.body.plan.id }),
    });
    summary = (await call("/api/progress")).body.weeklyStudy;
    expect(summary).toMatchObject({
      planId: b.body.plan.id,
      completed: 0,
      target: 5,
      percentage: 0,
    });

    const update = await call(`/api/plans/${a.body.plan.id}`, {
      method: "PUT",
      body: JSON.stringify({
        title: "Networks Exam",
        plan: { topic: "OSI/TCP", sessions: 4, milestone: "Finish review" },
      }),
    });
    expect(update.status).toBe(200);
    expect(update.body.plan).toMatchObject({
      title: "Networks Exam",
      plan: { topic: "OSI/TCP", sessions: 4, milestone: "Finish review" },
    });
    await call("/api/progress", {
      method: "POST",
      body: JSON.stringify({ currentPlanId: a.body.plan.id }),
    });
    expect((await call("/api/progress")).body.weeklyStudy).toMatchObject({
      completed: 1,
      target: 4,
      percentage: 25,
    });

    const otherIdentity = {
      "content-type": "application/json",
      "x-studyforge-user": "different-plan-owner",
    };
    expect(
      (
        await call("/api/progress", {
          method: "POST",
          headers: otherIdentity,
          body: JSON.stringify({ currentPlanId: a.body.plan.id }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(`/api/plans/${a.body.plan.id}`, {
          method: "PUT",
          headers: otherIdentity,
          body: JSON.stringify({ title: "Stolen", plan: { topic: "x", sessions: 1 } }),
        })
      ).status,
    ).toBe(404);
    expect(
      (await call(`/api/plans/${a.body.plan.id}`, { method: "DELETE", headers: otherIdentity }))
        .status,
    ).toBe(404);
    expect((await call(`/api/plans/${a.body.plan.id}`)).status).toBe(404);

    expect((await call(`/api/plans/${a.body.plan.id}`, { method: "DELETE" })).status).toBe(200);
    const afterDelete = (await call("/api/progress")).body.weeklyStudy;
    expect(afterDelete).toMatchObject({
      completed: 0,
      target: 0,
      percentage: 0,
      hasPlan: true,
      planId: null,
    });
    expect((await call("/api/plans")).body.plans.map((plan) => plan.id)).toEqual([b.body.plan.id]);
    expect(document.status).toBe(201);
  });

  it("stores generated quizzes against the selected owned plan for later attempts", async () => {
    const plan = await call("/api/plans", {
      method: "POST",
      body: JSON.stringify({ title: "Plan", plan: { topic: "OSI", sessions: 3 } }),
    });
    const quiz = await call("/api/quizzes", {
      method: "POST",
      body: JSON.stringify({
        title: "OSI quiz",
        planId: plan.body.plan.id,
        questions: [{ prompt: "OSI layers?", options: ["7", "4"], answer: "7" }],
      }),
    });
    expect(quiz.status).toBe(201);
    expect(quiz.body.quiz.planId).toBe(plan.body.plan.id);
    await call(`/api/quizzes/${quiz.body.quiz.id}/attempts`, {
      method: "POST",
      body: JSON.stringify({ answers: { 0: 0 } }),
    });
    const progress = (await call("/api/progress")).body.progress;
    expect(progress.recentActivity[0].planId).toBe(plan.body.plan.id);
    expect(progress.planWeeklyProgress[plan.body.plan.id].sessions).toBe(1);
  });
});
