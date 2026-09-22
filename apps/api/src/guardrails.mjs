import { ApiError } from "./contracts.mjs";
import { logEvent } from "./observability.mjs";

const injection =
  /(ignore\s+(all|any|previous)|disregard\s+(the|all|previous)|system\s+prompt|developer\s+message|reveal\s+(the\s+)?(secret|instructions?)|jailbreak|you\s+are\s+now|override\s+(the|all)|do\s+not\s+follow)/i;
const sensitive =
  /(sk-[a-z0-9_-]{12,}|bearer\s+[a-z0-9._-]{12,}|password\s*[:=]|api[_-]?key\s*[:=])/i;

export const LIMITS = Object.freeze({
  question: 1200,
  topic: 400,
  title: 200,
  documentBytes: 1_500_000,
  outputChars: 12_000,
  contextChars: 8_000,
});

export function detectPromptInjection(value) {
  return typeof value === "string" && injection.test(value);
}

export function guardInput(value, max) {
  if (typeof value !== "string" || !value.trim())
    throw new ApiError(422, "invalid_input", "Input is required.");
  if (value.length > max)
    throw new ApiError(422, "invalid_input", `Input exceeds ${max} characters.`);
  if (detectPromptInjection(value)) {
    logEvent("guardrail.decision", { decision: "deny", rule: "prompt_injection" });
    throw new ApiError(400, "unsafe_input", "This request contains an unsafe instruction pattern.");
  }
  return value.trim();
}

export function sanitizeMetadata(value, max, field = "field") {
  const clean = guardInput(value, max);
  return (
    [...clean]
      .map((character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? " " : character,
      )
      .join("")
      .replace(/\s+/g, " ")
      .trim() || field
  );
}

export function validateToolArgument(value, field, max = 200) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new ApiError(422, "invalid_tool_input", `${field} is invalid.`);
  }
  if (/[<>`]/.test(value) || [...value].some((character) => character.charCodeAt(0) < 32)) {
    throw new ApiError(422, "invalid_tool_input", `${field} contains unsupported characters.`);
  }
  return value.trim();
}

export function guardContext(chunks) {
  let size = 0;
  return chunks.filter((chunk) => {
    if (typeof chunk?.text !== "string" || !chunk.text.trim()) return false;
    if (size + chunk.text.length > LIMITS.contextChars) return false;
    size += chunk.text.length;
    return true;
  });
}

export function enforceGrounding(result) {
  const supported =
    result?.grounded === true &&
    Array.isArray(result.sources) &&
    result.sources.length > 0 &&
    result.sources.every((source) => source.documentId && source.chunkId);
  if (!supported && result?.grounded !== false) {
    logEvent("guardrail.decision", { decision: "deny", rule: "unsupported_claim" });
    return { ...result, grounded: false, sources: [] };
  }
  return result;
}

export function containsSensitiveData(value) {
  return sensitive.test(typeof value === "string" ? value : JSON.stringify(value));
}

function redactOutputValue(value) {
  if (typeof value === "string") {
    return {
      value: containsSensitiveData(value) ? "[redacted sensitive content]" : value,
      sensitive: containsSensitiveData(value),
    };
  }
  if (Array.isArray(value)) {
    const values = value.slice(0, 20).map(redactOutputValue);
    return {
      value: values.map((item) => item.value),
      sensitive: values.some((item) => item.sensitive),
    };
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).map(([key, entryValue]) => {
      const redacted = redactOutputValue(entryValue);
      return [key, redacted];
    });
    return {
      value: Object.fromEntries(entries.map(([key, item]) => [key, item.value])),
      sensitive: entries.some(([, item]) => item.sensitive),
    };
  }
  return { value, sensitive: false };
}

export function guardOutput(result) {
  const redacted = redactOutputValue(result);
  const guarded = enforceGrounding({ ...redacted.value });
  if (redacted.sensitive) {
    guarded.answer = "I can't provide sensitive credentials or private system data.";
    guarded.grounded = false;
    guarded.sources = [];
    guarded.questions = [];
    logEvent("guardrail.decision", { decision: "deny", rule: "sensitive_data_leakage" });
  }
  if (Array.isArray(guarded.questions)) {
    guarded.questions = guarded.questions.slice(0, 20).map((question) => ({
      ...question,
      question:
        typeof question.question === "string"
          ? question.question.slice(0, 1200)
          : "Review the source material.",
      options: Array.isArray(question.options)
        ? question.options.slice(0, 10).map((option) => String(option).slice(0, 300))
        : [],
      answer: typeof question.answer === "string" ? question.answer.slice(0, 300) : null,
    }));
  }
  for (const key of ["answer", "summary"]) {
    if (typeof guarded[key] === "string" && guarded[key].length > LIMITS.outputChars) {
      guarded[key] = guarded[key].slice(0, LIMITS.outputChars);
      logEvent("guardrail.decision", { decision: "truncate", rule: "excessive_output" });
    }
    if (!redacted.sensitive && containsSensitiveData(guarded[key])) {
      guarded[key] = "I can't provide sensitive credentials or private system data.";
      guarded.grounded = false;
      guarded.sources = [];
      logEvent("guardrail.decision", { decision: "deny", rule: "sensitive_data_leakage" });
    }
  }
  if (guarded.grounded === false && guarded.summary)
    guarded.summary = "No supporting evidence was found in your uploaded material.";
  return guarded;
}
