import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const file = join(process.cwd(), ".data", "studyforge.json");
const empty = { documents: [], chunks: [], progress: [], sessions: [], questions: [] };

export function createStore() {
  let data = empty;
  const load = async () => {
    try {
      data = JSON.parse(await readFile(file, "utf8"));
    } catch {
      data = structuredClone(empty);
    }
  };
  const persist = async () => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(data, null, 2));
  };
  load();
  return {
    listDocuments: (uid) =>
      data.documents
        .filter((x) => x.userId === uid)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    addDocument: async (doc, chunks) => {
      data.documents.push(doc);
      data.chunks.push(...chunks);
      await persist();
      return doc;
    },
    getChunks: (uid, documentId) =>
      data.chunks.filter((x) => x.userId === uid && (!documentId || x.documentId === documentId)),
    getProgress: (uid) =>
      data.progress.find((x) => x.userId === uid) || {
        userId: uid,
        completed: 0,
        streak: 0,
        hours: 0,
        plan: "Build a consistent 25-minute daily study habit.",
      },
    updateProgress: (uid, patch) => {
      const current = { ...data.progress.find((x) => x.userId === uid), userId: uid, ...patch };
      data.progress = data.progress.filter((x) => x.userId !== uid).concat(current);
      void persist();
      return current;
    },
    addQuestion: async (q) => {
      data.questions.push(q);
      await persist();
    },
    newId: () => randomUUID(),
  };
}
