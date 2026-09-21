import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createApp } from "./src/app.mjs";

const root = fileURLToPath(new URL("../web", import.meta.url));
const port = Number(process.env.API_PORT || 4000);
const app = createApp({ staticRoot: root });

createServer(app).listen(port, "0.0.0.0", () => {
  console.log(`StudyForge AI running at http://localhost:${port}`);
});
