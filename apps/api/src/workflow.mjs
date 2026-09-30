import { randomUUID } from "node:crypto";
import { ApiError } from "./contracts.mjs";
import { agentRoles, handoff, listAgentRoles, requireAgentRole } from "./agent-contracts.mjs";
import { logEvent } from "./observability.mjs";

const maxItems = 50;
const maxItemLength = 500;

function stringList(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value))
    throw new ApiError(422, "invalid_input", `${field} must be an array of strings.`);
  if (value.length > maxItems)
    throw new ApiError(422, "invalid_input", `${field} must contain at most ${maxItems} items.`);
  return value.map((item, index) => {
    if (typeof item !== "string" || !item.trim())
      throw new ApiError(422, "invalid_input", `${field}[${index}] must be a non-empty string.`);
    return item.trim().slice(0, maxItemLength);
  });
}

/**
 * Structured, bounded development task. This is the unit of work the orchestrator routes to a
 * specialist agent; it is never a free-form shell command or an unrestricted tool call.
 */
export function createWorkflowTask(input = {}, userId = "workflow") {
  const role = requireAgentRole(input.agent);
  if (role.error) throw new ApiError(422, "invalid_input", role.error);
  const title = typeof input.title === "string" ? input.title.trim().slice(0, 200) : "";
  if (!title) throw new ApiError(422, "invalid_input", "title is required.");
  const id =
    typeof input.id === "string" && input.id.trim()
      ? input.id.trim().slice(0, 80)
      : `task-${randomUUID()}`;
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new ApiError(422, "invalid_input", "id is invalid.");
  return {
    id,
    title,
    agent: role.id,
    agentName: role.role.name,
    userId,
    requirements: stringList(input.requirements, "requirements"),
    changes: stringList(input.changes, "changes"),
    tests: stringList(input.tests, "tests"),
    status: "draft",
    createdAt: new Date().toISOString(),
  };
}

/**
 * Independent review. Returns a structured result and never approves a task whose test evidence
 * contains a failure.
 */
export function runReviewer(task, evidence = {}) {
  const findings = [];
  const requiredChanges = [];
  const tests = Array.isArray(evidence.tests) ? evidence.tests : [];

  if (!task.requirements.length) requiredChanges.push("Record at least one requirement.");
  if (!task.changes.length) requiredChanges.push("Record at least one implemented change.");
  if (!tests.length) requiredChanges.push("Attach test evidence before review.");

  const failed = tests.filter((test) => test.status === "fail");
  if (failed.length) {
    findings.push({
      severity: "critical",
      area: "tests",
      message: `${failed.length} test(s) failed.`,
    });
    requiredChanges.push("Fix failing tests before approval.");
  }
  const blocked = tests.filter((test) => test.status === "blocked");
  if (blocked.length) {
    findings.push({
      severity: "info",
      area: "tests",
      message: `${blocked.length} test(s) blocked by an external dependency.`,
    });
  }
  if (Array.isArray(evidence.securityIssues) && evidence.securityIssues.length) {
    findings.push({
      severity: "critical",
      area: "security",
      message: `${evidence.securityIssues.length} authorization or guardrail issue(s) reported.`,
    });
    requiredChanges.push("Resolve the reported security issues.");
  }
  if (evidence.ungroundedOutput) {
    findings.push({
      severity: "major",
      area: "grounding",
      message: "Ungrounded study output was detected.",
    });
    requiredChanges.push("Restore grounded generation with verified sources.");
  }
  if (Array.isArray(evidence.regressions) && evidence.regressions.length) {
    findings.push({
      severity: "major",
      area: "regression",
      message: `${evidence.regressions.length} regression(s) reported.`,
    });
    requiredChanges.push("Resolve the reported regressions.");
  }
  if (evidence.scopeCreep) {
    findings.push({
      severity: "major",
      area: "scope",
      message: "The change exceeds the stated task scope.",
    });
    requiredChanges.push("Reduce the change to the approved scope.");
  }

  return {
    status: requiredChanges.length ? "changes_requested" : "approved",
    findings,
    required_changes: requiredChanges,
    tests: tests.map((test) => ({ id: test.id || test.name || "unnamed", status: test.status })),
  };
}

/**
 * QA gate. Distinguishes PASS / FAIL / BLOCKED and never hides a failure.
 */
export function runQaGate(evidence = {}) {
  const tests = Array.isArray(evidence.tests) ? evidence.tests : [];
  const failed = tests.filter((test) => test.status === "fail");
  const blocked = tests.filter((test) => test.status === "blocked");
  const passed = tests.filter((test) => test.status === "pass");
  const build = evidence.build === true ? "PASS" : evidence.build === false ? "FAIL" : "BLOCKED";
  const status =
    failed.length || build === "FAIL"
      ? "FAIL"
      : !tests.length || blocked.length
        ? "BLOCKED"
        : "PASS";
  return {
    status,
    checks: {
      total: tests.length,
      passed: passed.length,
      failed: failed.length,
      blocked: blocked.length,
      build,
    },
    failures: failed.map((test) => ({
      id: test.id || test.name || "unnamed",
      reason: test.reason || "Test reported a failure.",
    })),
    blockedChecks: blocked.map((test) => ({
      id: test.id || test.name || "unnamed",
      reason: test.reason || "Blocked by an external dependency.",
    })),
  };
}

/**
 * GitHub issue-tracker integration point.
 * Read-only by default: this repository has no authorized GitHub write integration, so no issue is
 * created, closed, or deleted automatically. When GITHUB_TOKEN and GITHUB_REPOSITORY are supplied the
 * tracker still refuses automatic mutation and only reports what it would publish.
 */
export function createIssueTracker(env = process.env) {
  const token = env.GITHUB_TOKEN?.trim();
  const repository = env.GITHUB_REPOSITORY?.trim();
  const configured = Boolean(token && repository);
  return {
    mode: configured ? "github" : "local",
    configured,
    repository: repository || null,
    draft(task) {
      return {
        title: `[${task.agent}] ${task.title}`,
        labels: [`agent:${task.agent}`, task.status],
        body: [
          "## Requirements",
          ...(task.requirements.length
            ? task.requirements.map((item) => `- ${item}`)
            : ["- None recorded"]),
          "## Changes",
          ...(task.changes.length ? task.changes.map((item) => `- ${item}`) : ["- None recorded"]),
          "## Tests",
          ...(task.tests.length ? task.tests.map((item) => `- ${item}`) : ["- None recorded"]),
        ].join("\n"),
      };
    },
    async publish() {
      if (!configured) return { published: false, reason: "github_not_configured" };
      return { published: false, reason: "automatic_issue_mutation_disabled" };
    },
  };
}

/**
 * Runs the orchestrator -> specialist -> reviewer -> QA pipeline for one structured task.
 * A task is only approved when the reviewer approves it AND QA reports PASS.
 */
export function runDevelopmentWorkflow(input = {}, options = {}) {
  const task = createWorkflowTask(input, input.userId || options.userId || "workflow");
  const tracker = options.tracker || createIssueTracker();
  const evidence = input.evidence || {};
  const review = runReviewer(task, evidence);
  const qa = runQaGate(evidence);
  const approved = review.status === "approved" && qa.status === "PASS";
  const status = approved ? "approved" : qa.status === "FAIL" ? "reopened" : "blocked";
  const result = {
    task: { ...task, status },
    orchestration: {
      orchestrator: agentRoles.orchestrator.name,
      agent: task.agentName,
      handoff: handoff(
        task.agentName,
        task.userId,
        task.agent,
        { requirements: task.requirements },
        "implementation",
      ),
      routing: ["orchestrator", task.agent, "reviewer", "qa"],
    },
    review,
    qa,
    status,
    issue: {
      ...tracker.draft({ ...task, status }),
      mode: tracker.mode,
      repository: tracker.repository,
    },
  };
  logEvent("workflow.completed", {
    userId: task.userId,
    taskId: task.id,
    agent: task.agent,
    status,
    qaStatus: qa.status,
  });
  return result;
}

export { listAgentRoles };
