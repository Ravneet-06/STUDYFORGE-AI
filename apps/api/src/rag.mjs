import { randomUUID } from "node:crypto";

const suspicious = [
  /ignore (all|any|previous) instructions/i,
  /system prompt/i,
  /developer message/i,
  /reveal.*secret/i,
];

export function extractText(input) {
  const text = String(input.content || "")
    .replace(/\0/g, "")
    .trim();
  if (!text) throw new Error("Document content is required.");
  if (input.type === "application/pdf" || input.name?.toLowerCase().endsWith(".pdf")) {
    return text.replace(/[^\t\n\r\x20-\x7e]/g, " ");
  }
  return text;
}

export async function ingestDocument(store, uid, input) {
  const content = extractText(input);
  const clean = content
    .split(/\r?\n/)
    .filter((line) => !suspicious.some((pattern) => pattern.test(line)))
    .join("\n");
  const document = {
    id: store.newId(),
    userId: uid,
    title: input.title || input.name || "Untitled study material",
    type: input.type || "text/plain",
    size: clean.length,
    createdAt: new Date().toISOString(),
    status: "ready",
  };
  const words = clean.split(/\s+/);
  const chunks = [];
  for (let i = 0; i < words.length; i += 120) {
    const text = words.slice(i, i + 160).join(" ");
    chunks.push({
      id: randomUUID(),
      documentId: document.id,
      userId: uid,
      index: chunks.length,
      text,
      keywords: [...new Set(text.toLowerCase().match(/[a-z0-9]{4,}/g) || [])],
    });
  }
  await store.addDocument(document, chunks);
  return document;
}

function score(question, chunk) {
  const terms = new Set(question.toLowerCase().match(/[a-z0-9]{3,}/g) || []);
  return chunk.keywords.filter((word) => terms.has(word)).length;
}

export function retrieve(store, uid, question, documentId) {
  return store
    .getChunks(uid, documentId)
    .map((chunk) => ({ ...chunk, score: score(question, chunk) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

export function groundedAnswer(question, matches) {
  if (!matches.length)
    return {
      answer:
        "I couldn't find that in your uploaded study material. Try uploading a relevant document or ask about a topic covered there.",
      grounded: false,
      sources: [],
    };
  return {
    answer: `Based on your study material: ${matches
      .map((m) => m.text)
      .join(" ")
      .slice(0, 1200)}`,
    grounded: true,
    sources: matches.map((m) => ({
      documentId: m.documentId,
      chunkId: m.id,
      excerpt: m.text.slice(0, 180),
    })),
  };
}
