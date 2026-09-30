import {
  createExecutionArtifactName,
  classifyExecutionLabels,
  normalizeExecutionPayload,
} from "./issue-execution-boundary.mjs";
import { classifyAgentLabels } from "./issue-routing.mjs";

export const QA_COMMANDS = Object.freeze([
  "validate:foundation",
  "format:check",
  "lint",
  "typecheck",
  "test:unit",
  "build",
  "security:check",
]);

const checkStates = new Set(["passed", "failed", "skipped", "execution_error"]);
const outputLimit = 1200;

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

export function classifyQaLabels(labels) {
  const assignment = classifyExecutionLabels(labels);
  if (assignment.status !== "routed") return assignment;
  return assignment.label === "agent:qa"
    ? { status: "routed", label: assignment.label, role: assignment.role }
    : { status: "not_qa", label: assignment.label, role: assignment.role };
}

export function validateQaManifest(manifest, repository) {
  invariant(
    manifest && typeof manifest === "object" && !Array.isArray(manifest),
    "manifest is invalid.",
  );
  invariant(manifest.schemaVersion === 1, "manifest schema version is unsupported.");
  invariant(
    manifest.status === "ready_for_agent_execution",
    "manifest is not ready for execution.",
  );
  invariant(
    typeof manifest.jobId === "string" && /^sf-issue-[a-f0-9]{32}$/.test(manifest.jobId),
    "manifest job ID is invalid.",
  );
  const payload = normalizeExecutionPayload(manifest.payload);
  invariant(
    payload.repository === repository,
    "manifest repository does not match this repository.",
  );
  invariant(
    payload.responsibleAgentLabel === "agent:qa" && payload.mappedAgentRole === "QA",
    "manifest is not assigned to QA.",
  );
  const assignment = classifyAgentLabels([payload.responsibleAgentLabel]);
  invariant(
    assignment.status === "routed" && assignment.role === payload.mappedAgentRole,
    "manifest agent assignment is invalid.",
  );
  return payload;
}

export function createQaArtifactName(jobId) {
  return createExecutionArtifactName(jobId);
}

export function findQaArtifact(artifacts, expectedName, expectedCommit, rejectedArtifactIds = []) {
  invariant(Array.isArray(artifacts), "artifacts must be an array.");
  const matches = artifacts.filter(
    (artifact) =>
      artifact?.name === expectedName &&
      artifact?.expired !== true &&
      artifact?.workflow_run?.head_sha?.toLowerCase() === expectedCommit?.toLowerCase() &&
      !rejectedArtifactIds.includes(artifact?.id),
  );
  matches.sort((left, right) =>
    String(left.created_at ?? "").localeCompare(String(right.created_at ?? "")),
  );
  return matches[0] ?? null;
}

export function createQaReportMarker(jobId, testedCommit) {
  invariant(
    typeof jobId === "string" && /^sf-issue-[a-f0-9]{32}$/.test(jobId),
    "job ID is invalid.",
  );
  invariant(
    typeof testedCommit === "string" && /^[a-f0-9]{40}$/i.test(testedCommit),
    "tested commit must be a full SHA.",
  );
  return `<!-- studyforge-qa-report:${jobId}:${testedCommit.toLowerCase()} -->`;
}

export function hasQaReport(comments, marker) {
  return (
    Array.isArray(comments) &&
    comments.some(
      (comment) =>
        comment?.user?.type === "Bot" &&
        typeof comment.body === "string" &&
        comment.body.includes(marker),
    )
  );
}

function redactSecrets(value) {
  return String(value ?? "")
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, "[REDACTED PRIVATE KEY]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g, "[REDACTED TOKEN]")
    .replace(/(\bBearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[REDACTED]")
    .replace(/\b([A-Za-z0-9_-]*(?:SECRET|TOKEN|PASSWORD|API[_-]?KEY|PRIVATE[_-]?KEY|SERVICE[_-]?ROLE[_-]?KEY)[A-Za-z0-9_-]*)(\s*[:=]\s*)[^\s,;]+/gi, "$1$2[REDACTED]");
}

function conciseOutput(value) {
  let output = "";
  let escapeState = "normal";
  for (const character of String(value ?? "")) {
    const code = character.codePointAt(0);
    if (escapeState === "escape") {
      escapeState = code === 0x5b ? "csi" : "normal";
      continue;
    }
    if (escapeState === "csi") {
      if (code >= 0x40 && code <= 0x7e) escapeState = "normal";
      continue;
    }
    if (code === 0x1b) {
      escapeState = "escape";
      continue;
    }
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) continue;
    if (code === 0x7f) continue;
    output += character;
  }
  output = redactSecrets(output).replace(/\r\n?/g, "\n").trim();
  return output.length > outputLimit
    ? `${output.slice(0, outputLimit)}\n… output truncated`
    : output;
}

export function createQaReport(input, results, { setupError = "" } = {}) {
  invariant(input && typeof input === "object", "QA report input is invalid.");
  invariant(
    typeof input.repository === "string" &&
      /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repository),
    "repository is invalid.",
  );
  invariant(
    Number.isSafeInteger(input.issueNumber) && input.issueNumber > 0,
    "Issue number is invalid.",
  );
  invariant(typeof input.issueTitle === "string", "Issue title must be a string.");
  invariant(
    typeof input.testedCommit === "string" && /^[a-f0-9]{40}$/i.test(input.testedCommit),
    "tested commit must be a full SHA.",
  );
  const timestamp = new Date(input.timestamp);
  invariant(Number.isFinite(timestamp.getTime()), "timestamp is invalid.");
  const marker = createQaReportMarker(input.jobId, input.testedCommit);
  invariant(Array.isArray(results), "check results must be an array.");

  const byName = new Map();
  for (const result of results) {
    invariant(
      result && typeof result.name === "string" && QA_COMMANDS.includes(result.name),
      "result contains a non-allowlisted check.",
    );
    invariant(!byName.has(result.name), "check results must not contain duplicates.");
    invariant(checkStates.has(result.state), `invalid check state for ${result.name}.`);
    if (result.state === "passed") invariant(result.exitCode === 0, "passed checks must have exit code 0.");
    if (result.state === "failed") invariant(Number.isInteger(result.exitCode) && result.exitCode !== 0, "failed checks must have a nonzero exit code.");
    if (result.state === "skipped" || result.state === "execution_error") {
      invariant(result.exitCode === null || result.exitCode === undefined, `${result.state} checks must not have an exit code.`);
    }
    byName.set(result.name, {
      name: result.name,
      command: `npm run ${result.name}`,
      state: result.state,
      exitCode: Number.isInteger(result.exitCode) ? result.exitCode : null,
      output: conciseOutput(result.output),
      error: conciseOutput(result.error),
    });
  }

  const checks = QA_COMMANDS.map(
    (name) =>
      byName.get(name) ?? {
        name,
        command: `npm run ${name}`,
        state: "skipped",
        exitCode: null,
        output: "",
        error: setupError ? "Skipped because locked dependency installation failed." : "Not run.",
      },
  );
  const passedChecks = checks.filter((check) => check.state === "passed");
  const failedChecks = checks.filter((check) => check.state === "failed");
  const skippedChecks = checks.filter((check) => check.state === "skipped");
  const executionErrors = checks.filter((check) => check.state === "execution_error");
  if (setupError) {
    executionErrors.push({
      name: "dependency_install",
      command: "npm ci --no-audit --no-fund",
      state: "execution_error",
      exitCode: null,
      output: "",
      error: conciseOutput(setupError),
    });
  }
  const overallStatus =
    failedChecks.length || executionErrors.length
      ? "failed"
      : skippedChecks.length
        ? "incomplete"
        : "passed";

  return {
    schemaVersion: 1,
    marker,
    issueNumber: input.issueNumber,
    issueTitle: conciseOutput(input.issueTitle.normalize("NFC")),
    repository: input.repository,
    testedCommit: input.testedCommit.toLowerCase(),
    timestamp: timestamp.toISOString(),
    qaRole: "QA",
    overallStatus,
    passedChecks,
    failedChecks,
    skippedChecks,
    executionErrors,
  };
}

function escapeTitle(title) {
  return title
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/`/g, "&#96;")
    .replace(/\r?\n/g, " ");
}

function escapeReportText(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/`/g, "&#96;");
}

function renderChecks(heading, checks, stateLabel) {
  const lines = [`### ${heading}`];
  if (checks.length === 0) lines.push("- None.");
  for (const check of checks) {
    lines.push(
      `- **${stateLabel}** — \`${check.command}\`${check.exitCode === null ? "" : ` (exit ${check.exitCode})`}`,
    );
    const detail = check.error || check.output;
    if (detail) lines.push(`  - ${escapeReportText(detail).split("\n").join("\n  - ")}`);
  }
  return lines.join("\n");
}

export function formatQaReport(report) {
  invariant(report && typeof report === "object", "QA report is invalid.");
  const title = escapeTitle(report.issueTitle);
  return [
    report.marker,
    "## Read-only QA evidence",
    `- Issue: #${report.issueNumber} — ${title}`,
    `- Repository: \`${report.repository}\``,
    `- Tested commit: \`${report.testedCommit}\``,
    `- Timestamp: \`${report.timestamp}\``,
    "- QA agent role: **QA**",
    `- Overall status: **${report.overallStatus.toUpperCase()}**`,
    "- Issue title/body were treated as data; no Issue-provided commands were executed.",
    "",
    renderChecks("Passed checks", report.passedChecks, "PASS"),
    "",
    renderChecks("Failed checks", report.failedChecks, "FAIL"),
    "",
    renderChecks("Skipped checks", report.skippedChecks, "SKIP"),
    "",
    renderChecks("Execution errors", report.executionErrors, "ERROR"),
    "",
    "This QA run used read-only repository access and did not modify, commit, push, approve, merge, or close anything.",
  ].join("\n");
}
