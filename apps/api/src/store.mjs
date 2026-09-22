import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const file = join(process.cwd(), ".data", "studyforge.json");
const empty = {
  documents: [],
  chunks: [],
  progress: [],
  quizzes: [],
  attempts: [],
  plans: [],
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
      document.status = "deleted";
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
      return (
        data.progress.find((item) => item.userId === uid) || {
          userId: uid,
          completed: 0,
          streak: 0,
          hours: 0,
          plan: "Build a consistent 25-minute daily study habit.",
        }
      );
    },
    updateProgress: async (uid, patch) => {
      await ready;
      const current = {
        ...data.progress.find((item) => item.userId === uid),
        userId: uid,
        ...patch,
      };
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
      return data.plans.filter((item) => item.userId === uid);
    },
    addPlan: async (plan) => {
      await ready;
      data.plans.push(plan);
      await persist();
      return plan;
    },
    newId: () => randomUUID(),
  };
}
