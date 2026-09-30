import { randomUUID } from "node:crypto";
import { logEvent } from "./observability.mjs";
import { DEFAULT_PLAN, normalizeProgress } from "./progress.mjs";

const requiredConfig = ["SUPABASE_URL", "SUPABASE_ANON_KEY"];

export function getSupabaseConfig(env = process.env) {
  const url = env.SUPABASE_URL?.trim();
  const anonKey = env.SUPABASE_ANON_KEY?.trim();
  if (!url && !anonKey) return null;
  if (!url || !anonKey) {
    throw new Error(`${requiredConfig.join(" and ")} must be configured together.`);
  }
  return { url: url.replace(/\/$/, ""), anonKey };
}

export async function authenticateRequest(req, config) {
  if (!config) {
    if (process.env.NODE_ENV === "production" && !req.headers["x-studyforge-user"]) {
      logEvent("auth.failure", { reason: "missing_local_identity" });
      const error = new Error("Authentication required.");
      error.status = 401;
      error.code = "unauthorized";
      throw error;
    }
    return {
      id: req.headers["x-studyforge-user"]?.toString().slice(0, 80) || "local-demo-user",
      provider: "local",
    };
  }
  const authorization = req.headers.authorization?.toString();
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    logEvent("auth.failure", { reason: "missing_bearer_token" });
    const error = new Error("Authentication required.");
    error.status = 401;
    error.code = "unauthorized";
    throw error;
  }
  const response = await fetch(`${config.url}/auth/v1/user`, {
    headers: { apikey: config.anonKey, authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    logEvent("auth.failure", { reason: "provider_rejected_token", status: response.status });
    const error = new Error("Authentication failed.");
    error.status = 401;
    error.code = "unauthorized";
    throw error;
  }
  const user = await response.json();
  if (!user?.id) {
    logEvent("auth.failure", { reason: "provider_missing_identity" });
    const error = new Error("Authentication failed.");
    error.status = 401;
    error.code = "unauthorized";
    throw error;
  }
  return { id: user.id, provider: "supabase", token };
}

function headers(config, token) {
  return {
    apikey: config.anonKey,
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

function missingColumnFromProvider(provider) {
  const message = typeof provider?.message === "string" ? provider.message : "";
  const match = message.match(/Could not find the '([^']+)' column/i);
  return match ? match[1] : null;
}

async function request(config, token, path, options = {}) {
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...options,
    headers: { ...headers(config, token), ...options.headers },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let provider = null;
    try {
      provider = text ? JSON.parse(text) : null;
    } catch {
      // A non-JSON error body (for example a proxy HTML page) keeps the generic message.
    }
    const missingColumn = missingColumnFromProvider(provider);
    logEvent("supabase.request_failed", {
      status: response.status,
      resource: path.split("?")[0],
      code: typeof provider?.code === "string" ? provider.code : undefined,
      missingColumn: missingColumn || undefined,
    });
    const error = new Error(`Supabase request failed (${response.status}).`);
    error.status = response.status;
    error.missingColumn = missingColumn;
    throw error;
  }
  if (response.status === 204) return null;
  const payload = await response.text();
  return payload ? JSON.parse(payload) : null;
}

const documentView = (row) => ({
  id: row.id,
  userId: row.user_id,
  title: row.title,
  type: row.mime_type,
  size: row.byte_size,
  characterCount: row.character_count,
  content: row.content,
  storagePath: row.storage_path,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const chunkView = (row) => ({
  id: row.id,
  documentId: row.document_id,
  userId: row.user_id,
  index: row.chunk_index,
  text: row.content,
  keywords: [...new Set(row.content.toLowerCase().match(/[a-z0-9]{3,}/g) || [])],
});

const progressView = (row, userId) => ({
  userId: row?.user_id || userId,
  completed: row?.completed ?? 0,
  hours: row?.hours ?? 0,
  plan: row?.plan || DEFAULT_PLAN,
  points: row?.points ?? 0,
  activeDays: row?.active_days ?? 0,
  lastActiveDate: row?.last_active_date ?? null,
  lastActivityAt: row?.last_activity_at ?? null,
  quizAttempts: row?.quiz_attempts ?? 0,
  quizScoreTotal: row?.quiz_score_total ?? 0,
  vivaAttempts: row?.viva_attempts ?? 0,
  vivaScoreTotal: row?.viva_score_total ?? 0,
  studyPlans: row?.study_plans ?? 0,
  generations: row?.generations ?? 0,
  recentActivity: Array.isArray(row?.recent_activity) ? row.recent_activity : [],
  weeklySessions: row?.weekly_sessions ?? 0,
  weeklySessionWeekStart: row?.weekly_session_week_start ?? null,
  lastStudyActivityAt: row?.last_study_activity_at ?? null,
  currentPlanId: row?.current_plan_id ?? null,
  planWeeklyProgress: row?.plan_weekly_progress ?? {},
});

const progressColumns = Object.freeze({
  completed: "completed",
  hours: "hours",
  plan: "plan",
  points: "points",
  activeDays: "active_days",
  lastActiveDate: "last_active_date",
  lastActivityAt: "last_activity_at",
  quizAttempts: "quiz_attempts",
  quizScoreTotal: "quiz_score_total",
  vivaAttempts: "viva_attempts",
  vivaScoreTotal: "viva_score_total",
  studyPlans: "study_plans",
  generations: "generations",
  recentActivity: "recent_activity",
  weeklySessions: "weekly_sessions",
  weeklySessionWeekStart: "weekly_session_week_start",
  lastStudyActivityAt: "last_study_activity_at",
  currentPlanId: "current_plan_id",
  planWeeklyProgress: "plan_weekly_progress",
});

function progressRow(patch) {
  return Object.fromEntries(
    Object.entries(patch || {})
      .filter(([key]) => progressColumns[key])
      .map(([key, value]) => [progressColumns[key], value]),
  );
}

export function createSupabaseStore(config, token) {
  // Columns the deployed database rejected as unknown are remembered for the process lifetime, so
  // later writes skip them instead of failing the user's request again.
  const suppressedColumns = new Set();
  const omitSuppressed = (row) =>
    Object.fromEntries(Object.entries(row).filter(([key]) => !suppressedColumns.has(key)));

  /**
   * Inserts a row (or rows) while tolerating a database whose migrations have not all been applied.
   * Only an "unknown column" rejection is retried without that column; every other failure surfaces
   * unchanged so real errors are never hidden.
   */
  const insert = async (table, payload, { conflict, prefer = "return=minimal" } = {}) => {
    if (Array.isArray(payload) && !payload.length) return null;
    const rows = Array.isArray(payload) ? payload : [payload];
    const maxAttempts =
      Math.max(1, ...rows.map((row) => Object.keys(omitSuppressed(row)).length)) + 1;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const body = Array.isArray(payload) ? rows.map(omitSuppressed) : omitSuppressed(rows[0]);
      const writable = Array.isArray(body)
        ? Object.keys(body[0] || {}).length
        : Object.keys(body).length;
      if (!writable) throw new Error(`Supabase insert into ${table} has no writable columns.`);
      try {
        return await request(config, token, conflict ? `${table}?on_conflict=${conflict}` : table, {
          method: "POST",
          headers: { prefer },
          body: JSON.stringify(body),
        });
      } catch (error) {
        const missing = error.missingColumn;
        if (error.status !== 400 || !missing || suppressedColumns.has(missing)) throw error;
        suppressedColumns.add(missing);
        logEvent("supabase.schema_drift", { table, missingColumn: missing });
      }
    }
    throw new Error(`Supabase insert into ${table} did not converge on the deployed schema.`);
  };

  return {
    async listDocuments(userId) {
      const rows = await request(
        config,
        token,
        `documents?select=*&user_id=eq.${encodeURIComponent(userId)}&status=neq.deleted&order=created_at.desc`,
      );
      return rows.map(documentView);
    },
    async getDocument(userId, id) {
      const rows = await request(
        config,
        token,
        `documents?select=*&id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
      );
      return rows[0] ? documentView(rows[0]) : undefined;
    },
    async addDocument(document, chunks) {
      await insert(
        "documents",
        {
          id: document.id,
          user_id: document.userId,
          title: document.title,
          mime_type: document.type,
          byte_size: document.size,
          character_count: document.characterCount,
          content: document.content,
          status: document.status,
        },
        { prefer: "return=minimal" },
      );
      await insert(
        "document_chunks",
        chunks.map((chunk) => ({
          id: chunk.id,
          document_id: chunk.documentId,
          user_id: chunk.userId,
          chunk_index: chunk.index,
          content: chunk.text,
          embedding: chunk.embedding,
        })),
        { prefer: "return=minimal" },
      );
      return document;
    },
    async deleteDocument(userId, id) {
      const rows = await request(
        config,
        token,
        `documents?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`,
        {
          method: "DELETE",
          headers: { prefer: "return=representation" },
        },
      );
      return Array.isArray(rows) && rows.length > 0;
    },
    async getChunks(userId, documentId) {
      const documentFilter = documentId ? `&document_id=eq.${encodeURIComponent(documentId)}` : "";
      const rows = await request(
        config,
        token,
        `document_chunks?select=id,document_id,user_id,chunk_index,content&user_id=eq.${encodeURIComponent(userId)}${documentFilter}&order=chunk_index.asc`,
      );
      return rows.map(chunkView);
    },
    async semanticSearch(userId, embedding, documentId) {
      const rows = await request(config, token, "rpc/match_document_chunks", {
        method: "POST",
        body: JSON.stringify({
          query_embedding: embedding,
          match_user_id: userId,
          match_document_id: documentId || null,
          match_count: 5,
        }),
      });
      return rows.map((row) => ({ ...chunkView(row), score: row.similarity }));
    },
    async getProgress(userId) {
      const rows = await request(
        config,
        token,
        `progress?select=*&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
      );
      return normalizeProgress(userId, progressView(rows[0], userId));
    },
    async updateProgress(userId, patch) {
      const rows = await insert(
        "progress",
        { user_id: userId, ...progressRow(patch) },
        { conflict: "user_id", prefer: "resolution=merge-duplicates,return=representation" },
      );
      const activityFields = [
        "points",
        "activeDays",
        "lastActiveDate",
        "lastActivityAt",
        "quizAttempts",
        "quizScoreTotal",
        "vivaAttempts",
        "vivaScoreTotal",
        "studyPlans",
        "generations",
        "recentActivity",
      ];
      if (
        activityFields.some(
          (field) => patch?.[field] !== undefined && suppressedColumns.has(progressColumns[field]),
        )
      ) {
        throw new Error(
          "Supabase progress migration 0006 is required to persist activity statistics.",
        );
      }
      if (
        [
          "weeklySessions",
          "weeklySessionWeekStart",
          "lastStudyActivityAt",
          "currentPlanId",
          "planWeeklyProgress",
        ].some(
          (field) => patch?.[field] !== undefined && suppressedColumns.has(progressColumns[field]),
        )
      ) {
        throw new Error(
          "Supabase progress migration 0007 is required to persist weekly study sessions.",
        );
      }
      return normalizeProgress(userId, progressView(rows?.[0], userId));
    },
    async listQuizzes(userId) {
      return request(
        config,
        token,
        `quizzes?select=*&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc`,
      );
    },
    async getQuiz(userId, id) {
      const rows = await request(
        config,
        token,
        `quizzes?select=*,quiz_questions(*)&id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
      );
      return rows[0] ? { ...rows[0], planId: rows[0].plan_id || null } : undefined;
    },
    async addQuiz(quiz) {
      await insert(
        "quizzes",
        {
          id: quiz.id,
          user_id: quiz.userId,
          document_id: quiz.documentId,
          plan_id: quiz.planId,
          title: quiz.title,
        },
        { prefer: "return=minimal" },
      );
      await insert(
        "quiz_questions",
        quiz.questions.map((question) => ({
          ...question,
          quiz_id: quiz.id,
          user_id: quiz.userId,
        })),
        { prefer: "return=minimal" },
      );
      return quiz;
    },
    async addAttempt(attempt) {
      // Send only real quiz_attempts columns; the camelCase view keys are not database columns.
      const rows = await insert(
        "quiz_attempts",
        {
          id: attempt.id,
          quiz_id: attempt.quizId,
          user_id: attempt.userId,
          score: attempt.score,
          answers: attempt.answers || {},
        },
        { prefer: "return=representation" },
      );
      return rows?.[0];
    },
    async listPlans(userId) {
      return request(
        config,
        token,
        `study_plans?select=*&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc`,
      );
    },
    async addPlan(plan) {
      const rows = await insert(
        "study_plans",
        {
          id: plan.id,
          user_id: plan.userId,
          title: plan.title,
          plan: plan.plan,
        },
        { prefer: "return=representation" },
      );
      return rows?.[0];
    },
    async getPlan(userId, id) {
      const rows = await request(
        config,
        token,
        `study_plans?select=*&id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
      );
      return rows[0];
    },
    async updatePlan(userId, id, patch) {
      const rows = await request(
        config,
        token,
        `study_plans?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`,
        {
          method: "PATCH",
          headers: { prefer: "return=representation" },
          body: JSON.stringify({
            title: patch.title,
            plan: patch.plan,
            updated_at: new Date().toISOString(),
          }),
        },
      );
      return rows?.[0];
    },
    async deletePlan(userId, id) {
      const rows = await request(
        config,
        token,
        `study_plans?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`,
        { method: "DELETE", headers: { prefer: "return=representation" } },
      );
      return Array.isArray(rows) && rows.length > 0;
    },
    async addAskHistory(record) {
      await insert(
        "ask_history",
        {
          id: record.id,
          user_id: record.userId,
          study_plan_id: record.studyPlanId,
          question: record.question,
          answer: record.answer,
          created_at: record.createdAt,
          grounded: record.grounded,
          provider: record.provider,
          sources: record.sources,
          request_id: record.requestId,
        },
        {
          conflict: "user_id,request_id",
          prefer: "resolution=ignore-duplicates,return=minimal",
        },
      );
    },
    async listAskHistory(userId, limit, offset) {
      const rows = await request(
        config,
        token,
        `ask_history?select=id,study_plan_id,question,answer,created_at,grounded,provider,sources,request_id&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc,id.desc&limit=${limit}&offset=${offset}`,
      );
      return rows.map((row) => ({
        id: row.id,
        studyPlanId: row.study_plan_id,
        question: row.question,
        answer: row.answer,
        createdAt: row.created_at,
        grounded: row.grounded,
        provider: row.provider,
        sources: Array.isArray(row.sources) ? row.sources : [],
        requestId: row.request_id,
      }));
    },
    newId: () => randomUUID(),
  };
}
