import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createStore } from "./store.mjs";
import { ingestDocument } from "./rag.mjs";
import { orchestrate } from "./agents.mjs";
import { validateToolInput } from "./mcp.mjs";
import { guardInput } from "./guardrails.mjs";

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
}

async function body(req) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 2_000_000) throw new Error("Request body exceeds 2 MB.");
  }
  return data ? JSON.parse(data) : {};
}

function userId(req) {
  return req.headers["x-studyforge-user"]?.toString().slice(0, 80) || "local-demo-user";
}

export function createApp({ staticRoot }) {
  const store = createStore();
  return async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "content-type,x-studyforge-user",
        });
        return res.end();
      }
      if (url.pathname.startsWith("/api/")) return await api(req, res, url, store);
      return serveStatic(res, staticRoot, url.pathname);
    } catch (error) {
      json(res, 400, { error: error.message || "Request failed." });
    }
  };
}

async function api(req, res, url, store) {
  const uid = userId(req);
  if (url.pathname === "/api/health")
    return json(res, 200, {
      status: "ok",
      mode: "local",
      foundry: Boolean(process.env.AZURE_AI_PROJECT_ENDPOINT),
      supabase: Boolean(process.env.SUPABASE_URL),
    });
  if (req.method === "GET" && url.pathname === "/api/documents")
    return json(res, 200, { documents: store.listDocuments(uid) });
  if (req.method === "GET" && url.pathname === "/api/progress")
    return json(res, 200, { progress: store.getProgress(uid) });
  if (req.method === "POST" && url.pathname === "/api/documents") {
    const input = await body(req);
    guardInput(input.title || "", 200);
    const document = await ingestDocument(store, uid, input);
    return json(res, 201, { document });
  }
  if (req.method === "POST" && url.pathname === "/api/assistant") {
    const input = await body(req);
    guardInput(input.question, 1200);
    const result = await orchestrate("assistant", { ...input, userId: uid }, store);
    return json(res, 200, result);
  }
  if (req.method === "POST" && url.pathname === "/api/generate") {
    const input = await body(req);
    guardInput(input.topic || input.documentId || "", 400);
    const result = await orchestrate(input.kind, { ...input, userId: uid }, store);
    return json(res, 200, result);
  }
  if (req.method === "POST" && url.pathname === "/api/progress") {
    const input = await body(req);
    const progress = store.updateProgress(uid, input);
    return json(res, 200, { progress });
  }
  if (req.method === "POST" && url.pathname === "/api/tools/validate") {
    const input = await body(req);
    return json(res, 200, validateToolInput(input));
  }
  return json(res, 404, { error: "Route not found." });
}

async function serveStatic(res, root, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const file = normalize(join(root, requested));
  if (!file.startsWith(normalize(root))) return json(res, 403, { error: "Forbidden." });
  try {
    const data = await readFile(file);
    const types = {
      ".html": "text/html",
      ".css": "text/css",
      ".js": "text/javascript",
      ".svg": "image/svg+xml",
    };
    res.writeHead(200, {
      "content-type": `${types[extname(file)] || "application/octet-stream"}; charset=utf-8`,
    });
    res.end(data);
  } catch {
    json(res, 404, { error: "Not found." });
  }
}
