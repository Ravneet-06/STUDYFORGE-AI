const secretKey = /(authorization|api[_-]?key|token|password|secret|credential)/i;
const privateKey = /(content|document|prompt|question|answer|excerpt|data)/i;

function redact(value, key = "") {
  if (secretKey.test(key)) return "[REDACTED]";
  if (privateKey.test(key) && typeof value === "string") {
    return `[REDACTED:${value.length} chars]`;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 40)
        .map(([entryKey, entryValue]) => [entryKey, redact(entryValue, entryKey)]),
    );
  }
  return value;
}

export function logEvent(event, fields = {}) {
  const record = {
    timestamp: new Date().toISOString(),
    event,
    ...redact(fields),
  };
  console.info(JSON.stringify(record));
}

export function safeError(error) {
  return {
    status: Number.isInteger(error?.status) ? error.status : 500,
    code: typeof error?.code === "string" ? error.code : "request_failed",
    message:
      error?.status && error.status < 500 && typeof error.message === "string"
        ? error.message
        : "Request failed.",
  };
}
