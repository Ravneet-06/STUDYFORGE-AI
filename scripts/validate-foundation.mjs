import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const requiredFiles = [
  "package.json",
  "package-lock.json",
  ".gitignore",
  ".prettierignore",
  ".env.example",
  "AGENTS.md",
  "README.md",
  "docs/ARCHITECTURE.md",
  "docs/IMPLEMENTATION_PLAN.md",
  "docs/SETUP.md",
  "docs/ENVIRONMENT.md",
  ".github/workflows/ci.yml",
  "eslint.config.mjs",
  "prettier.config.mjs",
  "tsconfig.json",
  "tests/foundation.test.mjs",
];
const requiredDirectories = ["apps", "scripts", "docs"];
const failures = [];

for (const file of requiredFiles) {
  if (!existsSync(join(root, file))) {
    failures.push(`Missing required file: ${file}`);
  }
}

for (const directory of requiredDirectories) {
  if (!existsSync(join(root, directory))) {
    failures.push(`Missing required directory: ${directory}`);
  }
}

if (failures.length > 0) {
  console.error("Foundation validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (packageJson.name !== "studyforge-ai") {
  failures.push("package.json must identify the studyforge-ai workspace.");
}
if (
  !packageJson.workspaces?.includes("apps/*") ||
  !packageJson.workspaces?.includes("packages/*")
) {
  failures.push("package.json must declare apps/* and packages/* workspaces.");
}
for (const script of ["format:check", "lint", "typecheck", "test:unit", "security:check"]) {
  if (!packageJson.scripts?.[script]) {
    failures.push(`package.json must define the ${script} command.`);
  }
}

const envExample = readFileSync(join(root, ".env.example"), "utf8");
for (const requiredVariable of [
  "SUPABASE_URL=",
  "SUPABASE_SERVICE_ROLE_KEY=",
  "AZURE_AI_PROJECT_ENDPOINT=",
]) {
  if (!envExample.includes(requiredVariable)) {
    failures.push(`.env.example is missing ${requiredVariable}`);
  }
}

const gitignore = readFileSync(join(root, ".gitignore"), "utf8");
for (const ignoredEntry of [".env", ".env.*", "node_modules/"]) {
  if (!gitignore.includes(ignoredEntry)) {
    failures.push(`.gitignore must exclude ${ignoredEntry}.`);
  }
}

const secretPattern =
  /(gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY)/;
for (const file of requiredFiles) {
  const content = readFileSync(join(root, file), "utf8");
  if (secretPattern.test(content)) {
    failures.push(`Potential secret detected in ${file}.`);
  }
}

if (failures.length > 0) {
  console.error("Foundation validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Foundation validation passed (${requiredFiles.length} files, ${requiredDirectories.length} directories).`,
);
console.log(`Root: ${relative(process.cwd(), root) || "."}`);
