import { fileURLToPath } from "node:url";
import { createApp } from "../apps/api/src/app.mjs";

const root = fileURLToPath(
  new URL("../apps/web", import.meta.url)
);

const app = createApp({
  staticRoot: root,
});

export default app;