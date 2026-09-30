import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { normalizeProgress } from "./progress.mjs";

const file = join(process.cwd(), ".data", "studyforge.json");
const empty = {
  documents: [],
  chunks: [],
  progress: [],
  quizzes: [],
  attempts: [],
  plans: [],
  askHistory: [],
};

export function createStore() {
  let data = structuredClone(empty);
  const ready = (async () => {
    try {
      data = { ...structuredClone(empty), ...JSON.parse(await readFile(file, "utf8")) };
    } catch {
      // A missing local data file is the expected first-run state.
    }
  })();
  const persist = async () => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(data, null, 2));
  };
  const owned = (items, uid, id) =>
    items.find((item) => item.userId === uid && (!id || item.id === id));

  return {
    listDocuments: async (uid) => {
      await ready;
      return data.documents
        .filter((item) => item.userId === uid && item.status !== "deleted")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    getDocument: async (uid, id) => {
      await ready;
      return owned(data.documents, uid, id);
    },
    addDocument: async (doc, chunks) => {
      await ready;
      data.documents.push(doc);
      data.chunks.push(...chunks);
      await persist();
      return doc;
    },
    deleteDocument: async (uid, id) => {
      await ready;
      const document = owned(data.documents, uid, id);
      if (!document) return false;
      data.documents = data.documents.filter((item) => item !== document);
      data.chunks = data.chunks.filter((item) => item.documentId !== id || item.userId !== uid);
      await persist();
      return true;
    },
    getChunks: async (uid, documentId) => {
      await ready;
      return data.chunks.filter(
        (item) => item.userId === uid && (!documentId || item.documentId === documentId),
      );
    },
    semanticSearch: async (uid, _embedding, documentId) => {
      await ready;
      return data.chunks
        .filter((item) => item.userId === uid && (!documentId || item.documentId === documentId))
        .slice(0, 5);
    },
    getProgress: async (uid) => {
      await ready;
      return normalizeProgress(
        uid,
        data.progress.find((item) => item.userId === uid),
      );
    },
    updateProgress: async (uid, patch) => {
      await ready;
      const current = normalizeProgress(uid, {
        ...data.progress.find((item) => item.userId === uid),
        userId: uid,
        ...patch,
      });
      data.progress = data.progress.filter((item) => item.userId !== uid).concat(current);
      await persist();
      return current;
    },
    listQuizzes: async (uid) => {
      await ready;
      return data.quizzes.filter((item) => item.userId === uid);
    },
    getQuiz: async (uid, id) => {
      await ready;
      return owned(data.quizzes, uid, id);
    },
    addQuiz: async (quiz) => {
      await ready;
      data.quizzes.push(quiz);
      await persist();
      return quiz;
    },
    addAttempt: async (attempt) => {
      await ready;
      data.attempts.push(attempt);
      await persist();
      return attempt;
    },
    listPlans: async (uid) => {
      await ready;
      return data.plans
        .filter((item) => item.userId === uid)
        .reverse()
        .sort((left, right) => {
          const leftDate = left.createdAt || left.created_at || "";
          const rightDate = right.createdAt || right.created_at || "";
          return rightDate.localeCompare(leftDate);
        });
    },
    addPlan: async (plan) => {
      await ready;
      const saved = { ...plan, createdAt: plan.createdAt || new Date().toISOString() };
      data.plans.push(saved);
      await persist();
      return saved;
    },
    addAskHistory: async (record) => {
      await ready;
      const existing = data.askHistory.find(
        (item) => item.userId === record.userId && item.requestId === record.requestId,
      );
      if (existing) return existing;
      data.askHistory.push(record);
      await persist();
      return record;
    },
    listAskHistory: async (uid, limit, offset) => {
      await ready;
      return data.askHistory
        .filter((item) => item.userId === uid)
        .sort(
          (left, right) =>
            right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
        )
        .slice(offset, offset + limit)
        .map((record) => ({
          id: record.id,
          studyPlanId: record.studyPlanId,
          question: record.question,
          answer: record.answer,
          createdAt: record.createdAt,
          grounded: record.grounded,
          provider: record.provider,
          sources: record.sources,
          requestId: record.requestId,
        }));
    },
    getPlan: async (uid, id) => {
      await ready;
      return owned(data.plans, uid, id);
    },
    updatePlan: async (uid, id, patch) => {
      await ready;
      const plan = owned(data.plans, uid, id);
      if (!plan) return undefined;
      Object.assign(plan, patch, { updatedAt: new Date().toISOString() });
      await persist();
      return plan;
    },
    deletePlan: async (uid, id) => {
      await ready;
      const plan = owned(data.plans, uid, id);
      if (!plan) return false;
      data.plans = data.plans.filter((item) => item !== plan);
      for (const quiz of data.quizzes) {
        if (quiz.userId === uid && quiz.planId === id) quiz.planId = null;
      }
      const progress = data.progress.find((item) => item.userId === uid);
      if (progress) {
        if (progress.currentPlanId === id) progress.currentPlanId = null;
        if (progress.planWeeklyProgress) delete progress.planWeeklyProgress[id];
      }
      await persist();
      return true;
    },
    newId: () => randomUUID(),
  };
}
