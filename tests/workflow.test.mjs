import { describe, expect, it } from "vitest";
import { listAgentRoles, requireAgentRole } from "../apps/api/src/agent-contracts.mjs";
import {
  createIssueTracker,
  createWorkflowTask,
  runDevelopmentWorkflow,
  runQaGate,
  runReviewer,
} from "../apps/api/src/workflow.mjs";
import { executeTool, listTools, validateToolInput } from "../apps/api/src/mcp.mjs";

const task = {
  title: "Add Viva evaluation",
  agent: "backend",
  requirements: ["Evaluate Viva answers deterministically"],
  changes: ["Added apps/api/src/viva.mjs"],
  tests: ["tests/viva.test.mjs"],
};

describe("development workflow agents", () => {
  it("exposes a bounded specialist agent set", () => {
    const ids = listAgentRoles().map((role) => role.id);
    for (const expected of [
      "orchestrator",
      "frontend",
      "backend",
      "database",
      "rag",
      "mcp",
      "security",
      "qa",
      "reviewer",
    ]) {
      expect(ids).toContain(expected);
    }
    expect(requireAgentRole("shell").error).toBeTruthy();
    expect(requireAgentRole("backend").role.name).toBe("Backend Agent");
  });

  it("builds a structured task and rejects malformed tasks", () => {
    const created = createWorkflowTask(task, "workflow-user");
    expect(created.agent).toBe("backend");
    expect(created.requirements).toHaveLength(1);
    expect(created.status).toBe("draft");
    expect(() => createWorkflowTask({ ...task, agent: "unbounded" })).toThrow();
    expect(() => createWorkflowTask({ ...task, title: "" })).toThrow();
    expect(() => createWorkflowTask({ ...task, requirements: "not-a-list" })).toThrow();
  });

  it("never approves a task whose tests failed", () => {
    const review = runReviewer(createWorkflowTask(task, "u"), {
      tests: [{ id: "unit", status: "fail" }],
      build: true,
    });
    expect(review.status).toBe("changes_requested");
    expect(review.required_changes).toContain("Fix failing tests before approval.");
    expect(review.findings.some((finding) => finding.severity === "critical")).toBe(true);
  });

  it("reports PASS, FAIL, and BLOCKED distinctly without hiding failures", () => {
    expect(runQaGate({ tests: [{ id: "unit", status: "pass" }], build: true }).status).toBe("PASS");
    expect(runQaGate({ tests: [{ id: "unit", status: "fail" }], build: true }).status).toBe("FAIL");
    expect(runQaGate({ tests: [{ id: "live", status: "blocked" }], build: true }).status).toBe(
      "BLOCKED",
    );
    const failed = runQaGate({ tests: [{ id: "unit", status: "fail", reason: "boom" }] });
    expect(failed.failures).toEqual([{ id: "unit", reason: "boom" }]);
  });

  it("approves only when reviewer and QA both pass", () => {
    const approved = runDevelopmentWorkflow({
      ...task,
      userId: "workflow-user",
      evidence: { tests: [{ id: "unit", status: "pass" }], build: true },
    });
    expect(approved.status).toBe("approved");
    expect(approved.qa.status).toBe("PASS");
    expect(approved.orchestration.routing).toEqual(["orchestrator", "backend", "reviewer", "qa"]);

    const reopened = runDevelopmentWorkflow({
      ...task,
      evidence: { tests: [{ id: "unit", status: "fail" }], build: true },
    });
    expect(reopened.status).toBe("reopened");
    expect(reopened.review.status).toBe("changes_requested");
  });

  it("blocks a task when test evidence is missing or externally blocked", () => {
    const blocked = runDevelopmentWorkflow({ ...task, evidence: { tests: [] } });
    expect(blocked.status).toBe("blocked");
    expect(blocked.qa.status).toBe("BLOCKED");
  });

  it("keeps GitHub synchronization read-only until writing is explicitly authorized", async () => {
    const local = createIssueTracker({});
    expect(local.mode).toBe("local");
    expect((await local.publish()).published).toBe(false);
    const configured = createIssueTracker({
      GITHUB_TOKEN: "placeholder-token",
      GITHUB_REPOSITORY: "owner/repo",
    });
    expect(configured.mode).toBe("github");
    expect((await configured.publish()).reason).toBe("automatic_issue_mutation_disabled");
    expect(configured.draft(createWorkflowTask(task, "u")).labels).toEqual([
      "agent:backend",
      "draft",
    ]);
  });
});

describe("MCP tools", () => {
  const store = {
    async getChunks(userId) {
      return [{ id: "chunk-1", userId, text: "Mitochondria produce energy." }];
    },
    async listDocuments(userId) {
      return [{ id: "doc-1", userId }];
    },
    async getProgress() {
      return { userId: "user-1", completed: 0, points: 0 };
    },
    async updateProgress(userId, patch) {
      return { userId, ...patch };
    },
  };

  it("allowlists only known tools with valid arguments", () => {
    const names = listTools().map((tool) => tool.name);
    expect(names).toContain("record_activity");
    expect(
      validateToolInput({ tool: "record_activity", input: { type: "quiz_attempt" } }).allowed,
    ).toBe(true);
    expect(validateToolInput({ tool: "record_activity", input: { command: "dir" } }).allowed).toBe(
      false,
    );
    expect(validateToolInput({ tool: "shell", input: { command: "dir" } }).allowed).toBe(false);
  });

  it("denies unauthorized document access and unknown tools", async () => {
    await expect(
      executeTool({ tool: "get_document_chunks", input: {}, store, userId: "user-1" }),
    ).rejects.toMatchObject({ code: "tool_denied" });
    await expect(
      executeTool({ tool: "shell", input: {}, store, userId: "user-1" }),
    ).rejects.toMatchObject({ code: "tool_denied" });
    await expect(
      executeTool({
        tool: "get_document_chunks",
        input: { documentId: "a".repeat(200) },
        store,
        userId: "user-1",
      }),
    ).rejects.toMatchObject({ code: "invalid_tool_input" });
  });

  it("records bounded activity through the allowlisted tool", async () => {
    const result = await executeTool({
      tool: "record_activity",
      input: { type: "study_plan" },
      store,
      userId: "user-1",
    });
    expect(result.progress.studyPlans).toBe(1);
    await expect(
      executeTool({ tool: "record_activity", input: { type: "shell" }, store, userId: "user-1" }),
    ).rejects.toMatchObject({ code: "invalid_tool_input" });
    await expect(
      executeTool({
        tool: "record_activity",
        input: { type: "quiz_attempt", score: 100 },
        store,
        userId: "user-1",
      }),
    ).rejects.toMatchObject({ code: "invalid_tool_input" });
    await expect(
      executeTool({
        tool: "record_activity",
        input: { type: "study_generation" },
        store,
        userId: "user-1",
      }),
    ).rejects.toMatchObject({ code: "invalid_tool_input" });
  });
});
