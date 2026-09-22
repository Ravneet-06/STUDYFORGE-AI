import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { randomUUID } from "node:crypto";
import { createEmbedding, embeddingConfig } from "./embeddings.mjs";
import { ApiError } from "./contracts.mjs";
import { LIMITS, guardContext, sanitizeMetadata } from "./guardrails.mjs";
import { logEvent } from "./observability.mjs";

const allowedTypes = new Map([
  ["text/plain", "text"],
  ["text/markdown", "text"],
  ["text/x-markdown", "text"],
  ["application/pdf", "pdf"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
]);
const suspicious = [
  /ignore\s+(all|any|previous)\s+instructions?/gi,
  /system\s+prompt/gi,
  /developer\s+message/gi,
  /reveal(?:\s+the)?\s+(?:secret|hidden|private)/gi,
];

function inputType(input) {
  const type = input.type?.toLowerCase();
  if (!type && typeof input.content === "string") return "text";
  if (type && allowedTypes.has(type)) return allowedTypes.get(type);
  const name = input.name?.toLowerCase() || "";
  if (name.endsWith(".md") || name.endsWith(".markdown")) return "text";
  if (name.endsWith(".txt")) return "text";
  if (name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".docx")) return "docx";
  throw new ApiError(
    415,
    "unsupported_file",
    "Only PDF, DOCX, Markdown, and text files are supported.",
  );
}

function inputBuffer(input) {
  if (typeof input.content === "string") return Buffer.from(input.content, "utf8");
  if (typeof input.data === "string") {
    try {
      return Buffer.from(input.data, "base64");
    } catch {
      throw new ApiError(422, "invalid_file", "Document data is not valid base64.");
    }
  }
  throw new ApiError(422, "invalid_file", "Document content or base64 data is required.");
}

export async function extractText(input) {
  const type = inputType(input);
  const buffer = inputBuffer(input);
  if (buffer.length > LIMITS.documentBytes)
    throw new ApiError(413, "payload_too_large", "Document exceeds the 1.5 MB limit.");
  if (!buffer.length) throw new ApiError(422, "empty_document", "Document is empty.");
  let text;
  if (type === "pdf") {
    let parser;
    try {
      parser = new PDFParse({ data: buffer });
      text = (await parser.getText()).text;
    } catch {
      throw new ApiError(422, "invalid_file", "PDF could not be parsed.");
    } finally {
      await parser?.destroy();
    }
  } else if (type === "docx") {
    try {
      text = (await mammoth.extractRawText({ buffer })).value;
    } catch {
      throw new ApiError(422, "invalid_file", "DOCX could not be parsed.");
    }
  } else {
    text = buffer.toString("utf8");
  }
  const normalized = normalizeText(text);
  if (!normalized) throw new ApiError(422, "empty_document", "Document contains no readable text.");
  return {
    text: normalized,
    mimeType:
      input.type ||
      (type === "text"
        ? "text/plain"
        : type === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    byteSize: buffer.length,
  };
}

export function normalizeText(text) {
  return String(text)
    .replace(/\0/g, "")
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) =>
      suspicious
        .reduce((clean, pattern) => clean.replace(pattern, "[untrusted instruction removed]"), line)
        .replace(
          /(?:\[untrusted instruction removed\])(?:\s+and\s+|\s+)+/gi,
          "[untrusted instruction removed] ",
        )
        .replace(
          /(?:\[untrusted instruction removed\]\s*){2,}/gi,
          "[untrusted instruction removed] ",
        )
        .trim(),
    )
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function chunkText(text, { targetWords = 180, overlapWords = 30 } = {}) {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const chunks = [];
  for (let start = 0; start < words.length; start += targetWords - overlapWords) {
    const end = Math.min(start + targetWords, words.length);
    chunks.push(words.slice(start, end).join(" "));
    if (end === words.length) break;
  }
  return chunks;
}

export async function ingestDocument(store, uid, input) {
  const extracted = await extractText(input);
  const chunksText = chunkText(extracted.text);
  if (!chunksText.length)
    throw new ApiError(422, "empty_document", "Document contains no readable text.");
  const document = {
    id: store.newId(),
    userId: uid,
    title: sanitizeMetadata(
      input.title || input.name || "Untitled study material",
      LIMITS.title,
      "Untitled study material",
    ),
    type: extracted.mimeType,
    size: extracted.byteSize,
    createdAt: new Date().toISOString(),
    status: "ready",
    embeddingProvider: embeddingConfig() ? "azure-openai" : "none",
  };
  const config = embeddingConfig();
  const chunks = [];
  for (const [index, text] of chunksText.entries()) {
    chunks.push({
      id: randomUUID(),
      documentId: document.id,
      userId: uid,
      index,
      text,
      embedding: config ? await createEmbedding(text, config) : null,
      keywords: [...new Set(text.toLowerCase().match(/[a-z0-9]{4,}/g) || [])],
    });
  }
  await store.addDocument(document, chunks);
  logEvent("document.ingestion", {
    userId: uid,
    documentId: document.id,
    chunkCount: chunks.length,
    byteSize: document.size,
  });
  return document;
}

function score(question, chunk) {
  const terms = new Set(question.toLowerCase().match(/[a-z0-9]{3,}/g) || []);
  return chunk.keywords.filter((word) => terms.has(word)).length;
}

export async function retrieve(store, uid, question, documentId) {
  if (documentId && store.getDocument && !(await store.getDocument(uid, documentId))) {
    logEvent("retrieval.authorization_denied", { userId: uid, documentId });
    return [];
  }
  const config = embeddingConfig();
  if (config && store.semanticSearch) {
    const vector = await createEmbedding(question, config);
    const semantic = guardContext(
      (await store.semanticSearch(uid, vector, documentId))
        .filter((chunk) => chunk.userId === uid && (!documentId || chunk.documentId === documentId))
        .slice(0, 5),
    );
    if (semantic.length) {
      logEvent("retrieval.completed", { userId: uid, documentId, matchCount: semantic.length });
      return semantic;
    }
  }
  const lexical = guardContext(
    (await store.getChunks(uid, documentId))
      .map((chunk) => ({ ...chunk, score: score(question, chunk) }))
      .filter((chunk) => chunk.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5),
  );
  logEvent("retrieval.completed", { userId: uid, documentId, matchCount: lexical.length });
  return lexical;
}

export function groundedAnswer(question, matches) {
  if (!matches.length)
    return {
      answer:
        "I couldn't find that in your uploaded study material. I won't infer an unsupported answer.",
      grounded: false,
      sources: [],
    };
  return {
    answer: `Based only on your study material: ${matches
      .map((match) => match.text)
      .join(" ")
      .slice(0, 1200)}`,
    grounded: true,
    sources: matches.map((match) => ({
      documentId: match.documentId,
      chunkId: match.id,
      chunkIndex: match.index,
      excerpt: match.text.slice(0, 180),
    })),
  };
}
