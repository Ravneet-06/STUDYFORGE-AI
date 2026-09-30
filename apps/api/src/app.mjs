import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createStore } from "./store.mjs";
import { ingestDocument } from "./rag.mjs";
import { orchestrate } from "./agents.mjs";
import { executeTool, listTools, validateToolInput } from "./mcp.mjs";
import { guardInput } from "./guardrails.mjs";
import { authenticateRequest, createSupabaseStore, getSupabaseConfig } from "./supabase.mjs";
import { getFoundryConfig } from "./foundry.mjs";
import { ApiError, requireEnum, requireId, requireString, requestId } from "./contracts.mjs";
import {
  applyActivity,
  defaultProgress,
  normalizeProgress,
  weeklyStudySummary,
} from "./progress.mjs";
import { evaluateVivaSet } from "./viva.mjs";
import { listAgentRoles, runDevelopmentWorkflow } from "./workflow.mjs";
import { logEvent, safeError } from "./observability.mjs";

const maxRequestBodyBytes = 12_000_000;

function json(res, status, body, correlationId) {
  const origin = process.env.WEB_ORIGIN?.trim();
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
    "x-request-id": correlationId,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
  });
  res.end(JSON.stringify(body));
}

async function body(req) {
  let data = "";
  const declaredLength = Number(req.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > maxRequestBodyBytes)
    throw new ApiError(413, "payload_too_large", "Request body exceeds 12 MB.");
  for await (const chunk of req) {
    data += chunk;
    if (Buffer.byteLength(data, "utf8") > maxRequestBodyBytes)
      throw new ApiError(413, "payload_too_large", "Request body exceeds 12 MB.");
  }
  if (!data) return {};
  try {
    return JSON.parse(data);
  } catch {
    throw new ApiError(400, "invalid_json", "Request body must be valid JSON.");
  }
}

function normalizePath(pathname) {
  return pathname.replace(/^\/api\/v1(?=\/|$)/, "/api");
}

async function recordActivity(store, uid, activity) {
  try {
    const current = await store.getProgress(uid);
    const { patch, progress } = applyActivity(current, activity);
    await store.updateProgress(uid, patch);
    return { progress, persisted: true };
  } catch (error) {
    // Analytics persistence must never break the primary study action (generation, quiz attempts,
    // Viva evaluation, plans). The failure is logged for operators and the request still succeeds.
    logEvent("progress.record_failed", {
      userId: uid,
      type: activity?.type,
      status: Number.isInteger(error?.status) ? error.status : undefined,
      code: typeof error?.code === "string" ? error.code : undefined,
    });
    return { progress: applyActivity(defaultProgress(uid), activity).progress, persisted: false };
  }
}

function gradeQuizAttempt(quiz, submittedAnswers) {
  const questions = Array.isArray(quiz.questions)
    ? quiz.questions
    : Array.isArray(quiz.quiz_questions)
      ? quiz.quiz_questions
      : [];
  if (!questions.length) {
    throw new ApiError(409, "quiz_unavailable", "This quiz has no questions to grade.");
  }
  if (
    !submittedAnswers ||
    typeof submittedAnswers !== "object" ||
    Array.isArray(submittedAnswers)
  ) {
    throw new ApiError(422, "invalid_input", "answers must be an object of question indexes.");
  }

  const answers = {};
  let correct = 0;
  for (const [rawIndex, rawChoice] of Object.entries(submittedAnswers)) {
    if (!/^(0|[1-9]\d*)$/.test(rawIndex)) {
      throw new ApiError(422, "invalid_input", "answers contain an invalid question index.");
    }
    const questionIndex = Number(rawIndex);
    const options = questions[questionIndex]?.options;
    if (!Number.isSafeInteger(questionIndex) || !Array.isArray(options)) {
      throw new ApiError(422, "invalid_input", "answers contain an unknown question index.");
    }
    const choiceIndex =
      typeof rawChoice === "number"
        ? rawChoice
        : typeof rawChoice === "string" && /^(0|[1-9]\d*)$/.test(rawChoice)
          ? Number(rawChoice)
          : Number.NaN;
    if (!Number.isSafeInteger(choiceIndex) || choiceIndex < 0 || choiceIndex >= options.length) {
      throw new ApiError(422, "invalid_input", "answers contain an invalid option index.");
    }
    answers[questionIndex] = choiceIndex;
    if (String(options[choiceIndex]) === String(questions[questionIndex].answer)) correct += 1;
  }
  return { answers, score: Math.round((correct / questions.length) * 100) };
}

function planSessions(value) {
  if (value === undefined || value === null || value === "") return 3;
  const sessions = Number(value);
  if (!Number.isInteger(sessions) || sessions < 1 || sessions > 14)
    throw new ApiError(422, "invalid_input", "plan.sessions must be an integer from 1 to 14.");
  return sessions;
}

function optionalPlanText(value, field, max) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new ApiError(422, "invalid_input", `${field} must be text.`);
  if (value.length > max)
    throw new ApiError(422, "invalid_input", `${field} exceeds ${max} characters.`);
  return value.trim();
}

async function selectedPlanId(store, uid, value) {
  const progress = await store.getProgress(uid);
  const candidate = value === undefined ? progress.currentPlanId : value;
  if (candidate === null || candidate === "") return null;
  const id = requireId(candidate, "planId");
  if (!(await store.getPlan(uid, id)))
    throw new ApiError(404, "not_found", "Study plan not found.");
  return id;
}

function validateStudyPlan(input) {
  const rawPlan =
    input.plan && typeof input.plan === "object" && !Array.isArray(input.plan) ? input.plan : {};
  const planInput = JSON.parse(JSON.stringify(rawPlan).slice(0, 10_000));
  return {
    title: requireString(input.title, "title", 200),
    plan: {
      topic: optionalPlanText(planInput.topic, "plan.topic", 200),
      milestone: optionalPlanText(planInput.milestone, "plan.milestone", 300),
      sessions: planSessions(planInput.sessions),
    },
  };
}

export function createApp({
  staticRoot,
  storeFactory = createStore,
  assistantOrchestrator = orchestrate,
}) {
  const localStore = storeFactory();
  const supabase = getSupabaseConfig();
  return async (req, res) => {
    const correlationId = requestId(req);
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "OPTIONS") {
        const origin = process.env.WEB_ORIGIN?.trim();
        res.writeHead(204, {
          ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
          "access-control-allow-headers":
            "content-type,authorization,x-studyforge-user,x-request-id",
          "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
          "access-control-max-age": "600",
        });
        return res.end();
      }
      if (url.pathname.startsWith("/api/")) {
        return await api(
          req,
          res,
          { ...url, pathname: normalizePath(url.pathname), searchParams: url.searchParams },
          localStore,
          supabase,
          correlationId,
          assistantOrchestrator,
        );
      }
      return serveStatic(res, staticRoot, url.pathname, correlationId);
    } catch (error) {
      const safe = safeError(error);
      logEvent("api.error", { requestId: correlationId, status: safe.status, code: safe.code });
      json(
        res,
        safe.status,
        {
          error: {
            code: safe.code,
            message: safe.message,
          },
          requestId: correlationId,
        },
        correlationId,
      );
    }
  };
}

async function api(req, res, url, localStore, supabase, correlationId, assistantOrchestrator) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    return json(
      res,
      200,
      {
        status: "ok",
        mode: supabase ? "supabase" : "local",
        foundry: Boolean(getFoundryConfig()),
        supabase: Boolean(supabase),
        requestId: correlationId,
      },
      correlationId,
    );
  }
  if (req.method === "GET" && url.pathname === "/api/auth/config") {
    return json(
      res,
      200,
      {
        supabase: supabase ? { url: supabase.url, anonKey: supabase.anonKey } : null,
        requestId: correlationId,
      },
      correlationId,
    );
  }

  const identity = await authenticateRequest(req, supabase);
  const uid = identity.id;
  const store =
    identity.provider === "supabase" ? createSupabaseStore(supabase, identity.token) : localStore;
  const segments = url.pathname.split("/").filter(Boolean);
  const resourceId = segments[2];

  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    return json(
      res,
      200,
      { user: { id: uid }, provider: identity.provider, requestId: correlationId },
      correlationId,
    );
  }
  if (req.method === "GET" && url.pathname === "/api/documents") {
    return json(
      res,
      200,
      { documents: await store.listDocuments(uid), requestId: correlationId },
      correlationId,
    );
  }
  if (req.method === "POST" && url.pathname === "/api/documents") {
    const input = await body(req);
    guardInput(input.title || "", 200);
    const document = await ingestDocument(store, uid, input);
    return json(res, 201, { document, requestId: correlationId }, correlationId);
  }
  if (segments[1] === "documents" && resourceId && req.method === "GET") {
    const document = await store.getDocument(uid, requireId(resourceId, "documentId"));
    if (!document) throw new ApiError(404, "not_found", "Document not found.");
    if (segments[3] === "chunks") {
      return json(
        res,
        200,
        { chunks: await store.getChunks(uid, document.id), requestId: correlationId },
        correlationId,
      );
    }
    const chunks = await store.getChunks(uid, document.id);
    const content = document.content || chunks.map((chunk) => chunk.text).join("\n\n");
    return json(
      res,
      200,
      {
        document: {
          ...document,
          content,
        },
        requestId: correlationId,
      },
      correlationId,
    );
  }
  if (segments[1] === "documents" && resourceId && req.method === "DELETE") {
    const deleted = await store.deleteDocument(uid, requireId(resourceId, "documentId"));
    if (!deleted) throw new ApiError(404, "not_found", "Document not found.");
    return json(res, 200, { deleted: true, requestId: correlationId }, correlationId);
  }
  if (req.method === "GET" && url.pathname === "/api/progress") {
    const progress = normalizeProgress(uid, await store.getProgress(uid));
    const plans = await store.listPlans(uid);
    return json(
      res,
      200,
      {
        progress,
        weeklyStudy: weeklyStudySummary(progress, plans),
        requestId: correlationId,
      },
      correlationId,
    );
  }
  if (req.method === "GET" && url.pathname === "/api/history") {
    const limitValue = url.searchParams.get("limit") || "20";
    const offsetValue = url.searchParams.get("offset") || "0";
    if (!/^\d+$/.test(limitValue) || !/^\d+$/.test(offsetValue))
      throw new ApiError(422, "invalid_input", "limit and offset must be non-negative integers.");
    const limit = Number(limitValue);
    const offset = Number(offsetValue);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      throw new ApiError(422, "invalid_input", "limit must be an integer from 1 to 50.");
    if (!Number.isSafeInteger(offset) || offset > 100_000)
      throw new ApiError(422, "invalid_input", "offset must be an integer from 0 to 100000.");
    const records = await store.listAskHistory(uid, limit + 1, offset);
    return json(
      res,
      200,
      {
        history: records.slice(0, limit),
        hasMore: records.length > limit,
        requestId: correlationId,
      },
      correlationId,
    );
  }
  if (req.method === "POST" && url.pathname === "/api/progress") {
    // Patch semantics: only supported profile fields can be changed by the client.
    const input = await body(req);
    const patch = {};
    if (input.completed !== undefined)
      throw new ApiError(
        422,
        "invalid_input",
        "completed is derived from server-recorded activity.",
      );
    if (input.hours !== undefined) {
      const hours = Number(input.hours);
      if (!Number.isFinite(hours) || hours < 0 || hours > 10_000)
        throw new ApiError(422, "invalid_input", "hours must be a non-negative number.");
      patch.hours = hours;
    }
    if (typeof input.plan === "string") patch.plan = input.plan.slice(0, 300);
    if (input.currentPlanId !== undefined)
      patch.currentPlanId = await selectedPlanId(store, uid, input.currentPlanId);
    if (input.planWeeklyProgress !== undefined)
      throw new ApiError(
        422,
        "invalid_input",
        "Plan progress is derived from server-recorded activity.",
      );
    if (!Object.keys(patch).length)
      throw new ApiError(422, "invalid_input", "At least one progress field is required.");
    const updated = await store.updateProgress(uid, patch);
    return json(
      res,
      200,
      { progress: normalizeProgress(uid, updated), requestId: correlationId },
      correlationId,
    );
  }
  if (req.method === "POST" && url.pathname === "/api/progress/activity") {
    throw new ApiError(
      422,
      "invalid_input",
      "Learning activity is recorded by its server-side workflow.",
    );
  }
  if (req.method === "GET" && url.pathname === "/api/quizzes") {
    return json(
      res,
      200,
      { quizzes: await store.listQuizzes(uid), requestId: correlationId },
      correlationId,
    );
  }
  if (req.method === "POST" && url.pathname === "/api/quizzes") {
    const input = await body(req);
    const title = requireString(input.title, "title", 200);
    if (
      !Array.isArray(input.questions) ||
      input.questions.length < 1 ||
      input.questions.length > 100
    ) {
      throw new ApiError(422, "invalid_input", "questions must contain 1 to 100 items.");
    }
    const documentId = input.documentId ? requireId(input.documentId, "documentId") : null;
    if (documentId && !(await store.getDocument(uid, documentId))) {
      throw new ApiError(404, "not_found", "Document not found.");
    }
    const planId = await selectedPlanId(store, uid, input.planId);
    const quiz = await store.addQuiz({
      id: store.newId(),
      userId: uid,
      documentId,
      planId,
      title,
      questions: input.questions.map((question) => ({
        id: store.newId(),
        prompt: requireString(question.prompt, "question.prompt", 1000),
        options: Array.isArray(question.options)
          ? question.options
              .slice(0, 10)
              .map((option) => requireString(option, "question.option", 300))
          : [],
        answer: typeof question.answer === "string" ? question.answer.slice(0, 1000) : null,
      })),
    });
    return json(res, 201, { quiz, requestId: correlationId }, correlationId);
  }
  if (segments[1] === "quizzes" && resourceId && req.method === "GET") {
    const quiz = await store.getQuiz(uid, requireId(resourceId, "quizId"));
    if (!quiz) throw new ApiError(404, "not_found", "Quiz not found.");
    return json(res, 200, { quiz, requestId: correlationId }, correlationId);
  }
  if (
    segments[1] === "quizzes" &&
    resourceId &&
    segments[3] === "attempts" &&
    req.method === "POST"
  ) {
    const input = await body(req);
    const quiz = await store.getQuiz(uid, requireId(resourceId, "quizId"));
    if (!quiz) throw new ApiError(404, "not_found", "Quiz not found.");
    const { answers, score } = gradeQuizAttempt(quiz, input.answers ?? {});
    const attempt = await store.addAttempt({
      id: store.newId(),
      quizId: quiz.id,
      userId: uid,
      score,
      answers,
    });
    const { persisted: progressPersisted } = await recordActivity(store, uid, {
      type: "quiz_attempt",
      planId: quiz.planId || quiz.plan_id || null,
      score,
      summary: `MCQ attempt: ${quiz.title || "Practice set"}`,
    });
    return json(res, 201, { attempt, progressPersisted, requestId: correlationId }, correlationId);
  }
  if (req.method === "GET" && url.pathname === "/api/plans") {
    return json(
      res,
      200,
      { plans: await store.listPlans(uid), requestId: correlationId },
      correlationId,
    );
  }
  if (req.method === "POST" && url.pathname === "/api/plans") {
    const input = await body(req);
    const { title, plan } = validateStudyPlan(input);
    const saved = await store.addPlan({ id: store.newId(), userId: uid, title, plan });
    const progress = await store.getProgress(uid);
    if (!progress.currentPlanId) await store.updateProgress(uid, { currentPlanId: saved.id });
    await recordActivity(store, uid, { type: "study_plan", summary: `Study plan: ${title}` });
    return json(res, 201, { plan: saved, requestId: correlationId }, correlationId);
  }
  if (segments[1] === "plans" && resourceId && req.method === "PUT") {
    const id = requireId(resourceId, "planId");
    if (!(await store.getPlan(uid, id)))
      throw new ApiError(404, "not_found", "Study plan not found.");
    const { title, plan } = validateStudyPlan(await body(req));
    const updated = await store.updatePlan(uid, id, { title, plan });
    return json(res, 200, { plan: updated, requestId: correlationId }, correlationId);
  }
  if (segments[1] === "plans" && resourceId && req.method === "DELETE") {
    const id = requireId(resourceId, "planId");
    if (!(await store.getPlan(uid, id)))
      throw new ApiError(404, "not_found", "Study plan not found.");
    if (!(await store.deletePlan(uid, id)))
      throw new ApiError(404, "not_found", "Study plan not found.");
    const progress = await store.getProgress(uid);
    const planWeeklyProgress = { ...progress.planWeeklyProgress };
    delete planWeeklyProgress[id];
    await store.updateProgress(uid, {
      currentPlanId: progress.currentPlanId === id ? null : progress.currentPlanId,
      planWeeklyProgress,
    });
    return json(res, 200, { deleted: true, requestId: correlationId }, correlationId);
  }
  if (req.method === "POST" && url.pathname === "/api/assistant") {
    const input = await body(req);
    guardInput(input.question, 1200);
    if (input.documentId) requireId(input.documentId, "documentId");
    let studyPlanId = null;
    try {
      studyPlanId = await selectedPlanId(store, uid, undefined);
    } catch (error) {
      logEvent("ask_history.plan_lookup_failed", {
        requestId: correlationId,
        status: Number.isInteger(error?.status) ? error.status : undefined,
        code: typeof error?.code === "string" ? error.code : undefined,
      });
    }
    const result = await assistantOrchestrator("assistant", { ...input, userId: uid }, store);
    try {
      const sources = Array.isArray(result.sources)
        ? result.sources
            .filter((source) => source && typeof source === "object")
            .slice(0, 20)
            .map((source) => ({
              ...(typeof source.documentId === "string" ? { documentId: source.documentId } : {}),
              ...(typeof source.chunkId === "string" ? { chunkId: source.chunkId } : {}),
              ...(Number.isSafeInteger(source.chunkIndex) ? { chunkIndex: source.chunkIndex } : {}),
              ...(typeof source.excerpt === "string"
                ? { excerpt: source.excerpt.slice(0, 180) }
                : {}),
            }))
        : [];
      const visibleAnswer =
        typeof result.answer === "string" && result.answer
          ? result.answer
          : "I couldn't find support for that in your library.";
      await store.addAskHistory({
        id: store.newId(),
        userId: uid,
        requestId: correlationId,
        studyPlanId,
        question: input.question.trim(),
        answer: visibleAnswer,
        createdAt: new Date().toISOString(),
        grounded: result.grounded === true,
        provider: typeof result.provider === "string" ? result.provider.slice(0, 80) : "local",
        sources,
      });
    } catch (error) {
      logEvent("ask_history.persist_failed", {
        requestId: correlationId,
        status: Number.isInteger(error?.status) ? error.status : undefined,
        code: typeof error?.code === "string" ? error.code : undefined,
      });
    }
    return json(res, 200, { ...result, requestId: correlationId }, correlationId);
  }
  if (req.method === "POST" && url.pathname === "/api/generate") {
    const input = await body(req);
    if (input.topic) guardInput(input.topic, 400);
    if (input.documentId) requireId(input.documentId, "documentId");
    if (!input.topic && !input.documentId) guardInput("", 400);
    requireEnum(input.kind, "kind", ["summary", "explanation", "mcq", "viva", "progress"]);
    const planId = await selectedPlanId(store, uid, input.planId);
    const result = await orchestrate(input.kind, { ...input, userId: uid }, store);
    if (result.grounded) {
      await recordActivity(store, uid, {
        type: "study_generation",
        planId,
        summary: `Generated ${input.kind} material`,
      });
    }
    return json(res, 200, { ...result, requestId: correlationId }, correlationId);
  }
  if (req.method === "POST" && url.pathname === "/api/viva/evaluate") {
    const input = await body(req);
    const evaluation = evaluateVivaSet({ questions: input.questions, answers: input.answers });
    const planId = await selectedPlanId(store, uid, input.planId);
    const { progress, persisted } = await recordActivity(store, uid, {
      type: "viva_attempt",
      planId,
      score: evaluation.score,
      summary: `Viva practice: ${evaluation.completed}/${evaluation.total} answered`,
    });
    return json(
      res,
      200,
      { evaluation, progress, progressPersisted: persisted, requestId: correlationId },
      correlationId,
    );
  }
  if (req.method === "GET" && url.pathname === "/api/tools")
    return json(res, 200, { tools: listTools(), requestId: correlationId }, correlationId);
  if (req.method === "POST" && url.pathname === "/api/tools/validate") {
    return json(
      res,
      200,
      { ...validateToolInput(await body(req)), requestId: correlationId },
      correlationId,
    );
  }
  if (req.method === "POST" && url.pathname === "/api/tools/execute") {
    const input = await body(req);
    const result = await executeTool({ tool: input.tool, input: input.input, store, userId: uid });
    return json(res, 200, { result, requestId: correlationId }, correlationId);
  }
  if (req.method === "GET" && url.pathname === "/api/agents") {
    return json(res, 200, { agents: listAgentRoles(), requestId: correlationId }, correlationId);
  }
  if (req.method === "POST" && url.pathname === "/api/workflow/tasks") {
    const input = await body(req);
    const result = runDevelopmentWorkflow({ ...input, userId: uid });
    return json(res, 200, { ...result, requestId: correlationId }, correlationId);
  }
  throw new ApiError(404, "not_found", "Route not found.");
}

async function serveStatic(res, root, pathname, correlationId) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const file = normalize(join(root, requested));
  if (!file.startsWith(normalize(root)))
    return json(res, 403, { error: { code: "forbidden", message: "Forbidden." } }, correlationId);
  try {
    const data = await readFile(file);
    const types = {
      ".html": "text/html",
      ".css": "text/css",
      ".js": "text/javascript",
      ".mjs": "text/javascript",
      ".svg": "image/svg+xml",
    };
    res.writeHead(200, {
      "content-type": `${types[extname(file)] || "application/octet-stream"}; charset=utf-8`,
    });
    res.end(data);
  } catch {
    json(res, 404, { error: { code: "not_found", message: "Not found." } }, correlationId);
  }
}
