import { randomUUID } from "node:crypto";

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function requestId(req) {
  const supplied = req.headers["x-request-id"]?.toString().trim();
  return supplied && /^[a-zA-Z0-9._-]{1,80}$/.test(supplied) ? supplied : randomUUID();
}

export function requireString(value, field, max) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(422, "invalid_input", `${field} is required.`);
  }
  if (value.length > max) {
    throw new ApiError(422, "invalid_input", `${field} exceeds ${max} characters.`);
  }
  return value.trim();
}

export function requireId(value, field = "id") {
  const id = requireString(value, field, 80);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new ApiError(422, "invalid_input", `${field} is invalid.`);
  }
  return id;
}

export function requireEnum(value, field, allowed) {
  if (!allowed.includes(value)) {
    throw new ApiError(422, "invalid_input", `${field} must be one of: ${allowed.join(", ")}.`);
  }
  return value;
}
