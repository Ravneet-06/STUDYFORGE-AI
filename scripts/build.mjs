import { existsSync } from "node:fs";
if (!existsSync("apps/api/server.mjs") || !existsSync("apps/web/index.html"))
  throw new Error("MVP entry points are missing.");
console.log("StudyForge AI MVP build check passed.");
