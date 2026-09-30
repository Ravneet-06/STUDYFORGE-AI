import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { createQaReport, QA_COMMANDS } from "./qa-agent.mjs";

const timeoutMs = 15 * 60 * 1000;
const outputLimit = 64 * 1024;

function capture(current, chunk) {
  if (current.length >= outputLimit) return current;
  const next = current + chunk.toString("utf8");
  if (next.length <= outputLimit) return next;
  return `${next.slice(0, outputLimit - 24)}\n[output truncated]`;
}

function runCheck(name, cwd) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let forceTimeout;
    const child = spawn("npm", ["run", name], {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceTimeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
    }, timeoutMs);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceTimeout) clearTimeout(forceTimeout);
      resolve({ name, ...result, output: `${stdout}${stderr ? `\n${stderr}` : ""}` });
    };

    child.stdout.on("data", (chunk) => {
      stdout = capture(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = capture(stderr, chunk);
    });
    child.on("error", (error) => {
      finish({ state: "execution_error", exitCode: null, error: error.message });
    });
    child.on("close", (code, signal) => {
      if (timedOut) {
        finish({
          state: "execution_error",
          exitCode: null,
          error: `Check timed out after ${timeoutMs / 60000} minutes.`,
        });
      } else if (code === 0) {
        finish({ state: "passed", exitCode: 0, error: "" });
      } else if (code !== null) {
        finish({ state: "failed", exitCode: code, error: "" });
      } else {
        finish({
          state: "execution_error",
          exitCode: null,
          error: `Process ended with signal ${signal ?? "unknown"}.`,
        });
      }
    });
  });
}

async function main() {
  const inputPath = process.env.STUDYFORGE_QA_INPUT;
  const reportPath = process.env.STUDYFORGE_QA_REPORT;
  if (!inputPath || !reportPath)
    throw new Error("QA input/report paths must be provided by the workflow.");

  const input = JSON.parse(await readFile(inputPath, "utf8"));
  const setupError =
    process.env.STUDYFORGE_QA_INSTALL_OUTCOME === "success"
      ? ""
      : "Locked dependency installation did not complete successfully.";
  const sourceRoot = process.cwd();
  const executionRoot = await mkdtemp(
    join(process.env.RUNNER_TEMP || tmpdir(), "studyforge-qa-copy-"),
  );
  const excludedRoots = new Set([".git", ".data", "node_modules", "dist", "build", "coverage"]);
  await cp(sourceRoot, executionRoot, {
    recursive: true,
    filter(source) {
      const relativePath = relative(sourceRoot, source);
      const parts = relativePath.split(sep);
      const fileName = parts.at(-1);
      const excludesData = parts.some((part) => excludedRoots.has(part));
      const secretEnvironmentFile = /^\.env(?:\.|$)/.test(fileName) && fileName !== ".env.example";
      return relativePath === "" || (!excludesData && !secretEnvironmentFile);
    },
  });
  const results = [];
  if (!setupError) {
    await symlink(join(sourceRoot, "node_modules"), join(executionRoot, "node_modules"), "dir");
    for (const name of QA_COMMANDS) results.push(await runCheck(name, executionRoot));
  }

  const report = createQaReport(input, results, { setupError });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

main().catch((error) => {
  process.stderr.write(`QA report generation failed: ${error.message}\n`);
  process.exitCode = 1;
});
