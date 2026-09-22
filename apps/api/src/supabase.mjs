import { randomUUID } from "node:crypto";
import { logEvent } from "./observability.mjs";

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

async function request(config, token, path, options = {}) {
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...options,
    headers: { ...headers(config, token), ...options.headers },
  });
  if (!response.ok) {
    const error = new Error(`Supabase request failed (${response.status}).`);
    error.status = response.status;
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
  keywords: [...new Set(row.content.toLowerCase().match(/[a-z0-9]{4,}/g) || [])],
});

export function createSupabaseStore(config, token) {
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
      await request(config, token, "documents", {
        method: "POST",
        headers: { prefer: "return=minimal" },
        body: JSON.stringify({
          id: document.id,
          user_id: document.userId,
          title: document.title,
          mime_type: document.type,
          byte_size: document.size,
          status: document.status,
        }),
      });
      await request(config, token, "document_chunks", {
        method: "POST",
        headers: { prefer: "return=minimal" },
        body: JSON.stringify(
          chunks.map((chunk) => ({
            id: chunk.id,
            document_id: chunk.documentId,
            user_id: chunk.userId,
            chunk_index: chunk.index,
            content: chunk.text,
            embedding: chunk.embedding,
          })),
        ),
      });
      return document;
    },
    async deleteDocument(userId, id) {
      const rows = await request(
        config,
        token,
        `documents?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`,
        {
          method: "PATCH",
          headers: { prefer: "return=representation" },
          body: JSON.stringify({ status: "deleted" }),
        },
      );
      return rows.length > 0;
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
      return (
        rows[0] || {
          user_id: userId,
          completed: 0,
          streak: 0,
          hours: 0,
          plan: "Build a consistent 25-minute daily study habit.",
        }
      );
    },
    async updateProgress(userId, patch) {
      const rows = await request(config, token, "progress?on_conflict=user_id", {
        method: "POST",
        headers: { prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({ user_id: userId, ...patch }),
      });
      return rows[0];
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
      return rows[0];
    },
    async addQuiz(quiz) {
      await request(config, token, "quizzes", {
        method: "POST",
        headers: { prefer: "return=minimal" },
        body: JSON.stringify({
          id: quiz.id,
          user_id: quiz.userId,
          document_id: quiz.documentId,
          title: quiz.title,
        }),
      });
      await request(config, token, "quiz_questions", {
        method: "POST",
        headers: { prefer: "return=minimal" },
        body: JSON.stringify(
          quiz.questions.map((question) => ({
            ...question,
            quiz_id: quiz.id,
            user_id: quiz.userId,
          })),
        ),
      });
      return quiz;
    },
    async addAttempt(attempt) {
      const rows = await request(config, token, "quiz_attempts", {
        method: "POST",
        headers: { prefer: "return=representation" },
        body: JSON.stringify({ ...attempt, user_id: attempt.userId, quiz_id: attempt.quizId }),
      });
      return rows[0];
    },
    async listPlans(userId) {
      return request(
        config,
        token,
        `study_plans?select=*&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc`,
      );
    },
    async addPlan(plan) {
      const rows = await request(config, token, "study_plans", {
        method: "POST",
        headers: { prefer: "return=representation" },
        body: JSON.stringify({
          id: plan.id,
          user_id: plan.userId,
          title: plan.title,
          plan: plan.plan,
        }),
      });
      return rows[0];
    },
    newId: () => randomUUID(),
  };
}
