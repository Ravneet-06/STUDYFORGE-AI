import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createStore } from "./store.mjs";
import { ingestDocument } from "./rag.mjs";
import { orchestrate } from "./agents.mjs";
import { executeTool, listTools, validateToolInput } from "./mcp.mjs";
import { guardInput } from "./guardrails.mjs";
import { authenticateRequest, createSupabaseStore, getSupabaseConfig } from "./supabase.mjs";
import { ApiError, requireEnum, requireId, requireString, requestId } from "./contracts.mjs";
import { logEvent, safeError } from "./observability.mjs";

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
  if (Number.isFinite(declaredLength) && declaredLength > 2_000_000)
    throw new ApiError(413, "payload_too_large", "Request body exceeds 2 MB.");
  for await (const chunk of req) {
    data += chunk;
    if (Buffer.byteLength(data, "utf8") > 2_000_000)
      throw new ApiError(413, "payload_too_large", "Request body exceeds 2 MB.");
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

export function createApp({ staticRoot }) {
  const localStore = createStore();
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
          "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
          "access-control-max-age": "600",
        });
        return res.end();
      }
      if (url.pathname.startsWith("/api/")) {
        return await api(
          req,
          res,
          { ...url, pathname: normalizePath(url.pathname) },
          localStore,
          supabase,
          correlationId,
        );
      }
      return serveStatic(res, staticRoot, url.pathname);
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

async function api(req, res, url, localStore, supabase, correlationId) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    return json(
      res,
      200,
      {
        status: "ok",
        mode: supabase ? "supabase" : "local",
        foundry: Boolean(process.env.AZURE_AI_PROJECT_ENDPOINT),
        supabase: Boolean(supabase),
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
    return json(res, 200, { document, requestId: correlationId }, correlationId);
  }
  if (segments[1] === "documents" && resourceId && req.method === "DELETE") {
    const deleted = await store.deleteDocument(uid, requireId(resourceId, "documentId"));
    if (!deleted) throw new ApiError(404, "not_found", "Document not found.");
    return json(res, 200, { deleted: true, requestId: correlationId }, correlationId);
  }
  if (req.method === "GET" && url.pathname === "/api/progress") {
    return json(
      res,
      200,
      { progress: await store.getProgress(uid), requestId: correlationId },
      correlationId,
    );
  }
  if (req.method === "POST" && url.pathname === "/api/progress") {
    const input = await body(req);
    const completed = Number(input.completed ?? 0);
    const streak = Number(input.streak ?? 0);
    const hours = Number(input.hours ?? 0);
    if (
      ![completed, streak, hours].every(Number.isFinite) ||
      completed < 0 ||
      completed > 100 ||
      streak < 0 ||
      hours < 0
    ) {
      throw new ApiError(422, "invalid_input", "Progress values are invalid.");
    }
    return json(
      res,
      200,
      {
        progress: await store.updateProgress(uid, { completed, streak, hours }),
        requestId: correlationId,
      },
      correlationId,
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
    const quiz = await store.addQuiz({
      id: store.newId(),
      userId: uid,
      documentId,
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
    const score = Number(input.score);
    if (!Number.isFinite(score) || score < 0 || score > 100)
      throw new ApiError(422, "invalid_input", "score must be between 0 and 100.");
    const attempt = await store.addAttempt({
      id: store.newId(),
      quizId: quiz.id,
      userId: uid,
      score,
      answers: input.answers || {},
    });
    return json(res, 201, { attempt, requestId: correlationId }, correlationId);
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
    const plan = await store.addPlan({
      id: store.newId(),
      userId: uid,
      title: requireString(input.title, "title", 200),
      plan:
        input.plan && typeof input.plan === "object" && !Array.isArray(input.plan)
          ? JSON.parse(JSON.stringify(input.plan).slice(0, 10_000))
          : {},
    });
    return json(res, 201, { plan, requestId: correlationId }, correlationId);
  }
  if (req.method === "POST" && url.pathname === "/api/assistant") {
    const input = await body(req);
    guardInput(input.question, 1200);
    if (input.documentId) requireId(input.documentId, "documentId");
    const result = await orchestrate("assistant", { ...input, userId: uid }, store);
    return json(res, 200, { ...result, requestId: correlationId }, correlationId);
  }
  if (req.method === "POST" && url.pathname === "/api/generate") {
    const input = await body(req);
    if (input.topic) guardInput(input.topic, 400);
    if (input.documentId) requireId(input.documentId, "documentId");
    if (!input.topic && !input.documentId) guardInput("", 400);
    requireEnum(input.kind, "kind", ["summary", "explanation", "mcq", "viva", "progress"]);
    const result = await orchestrate(input.kind, { ...input, userId: uid }, store);
    return json(res, 200, { ...result, requestId: correlationId }, correlationId);
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
  throw new ApiError(404, "not_found", "Route not found.");
}

async function serveStatic(res, root, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const file = normalize(join(root, requested));
  if (!file.startsWith(normalize(root)))
    return json(res, 403, { error: { code: "forbidden", message: "Forbidden." } });
  try {
    const data = await readFile(file);
    const types = {
      ".html": "text/html",
      ".css": "text/css",
      ".js": "text/javascript",
      ".svg": "image/svg+xml",
    };
    res.writeHead(200, {
      "content-type": `${types[extname(file)] || "application/octet-stream"}; charset=utf-8`,
    });
    res.end(data);
  } catch {
    json(res, 404, { error: { code: "not_found", message: "Not found." } });
  }
}
