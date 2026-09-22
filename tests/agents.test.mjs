import { describe, expect, it } from "vitest";
import { agentRoles, handoff } from "../apps/api/src/agent-contracts.mjs";
import { orchestrate, reviewResponse, runQaAgent, selectAgents } from "../apps/api/src/agents.mjs";
import { createFoundryProvider } from "../apps/api/src/foundry.mjs";
import { executeTool, validateToolInput } from "../apps/api/src/mcp.mjs";

const store = {
  async getChunks(userId) {
    return [
      {
        id: "chunk-1",
        documentId: "doc-1",
        userId,
        index: 0,
        text: "Photosynthesis converts light into chemical energy.",
        keywords: ["photosynthesis", "converts", "light", "chemical", "energy"],
      },
    ];
  },
  async listDocuments(userId) {
    return [{ id: "doc-1", userId }];
  },
  async updateProgress(userId, patch) {
    return { userId, ...patch };
  },
  async getProgress(userId) {
    return { userId, completed: 20 };
  },
};

describe("multi-agent orchestration and MCP", () => {
  it("selects specialist routes and preserves typed handoffs", () => {
    expect(selectAgents("mcq")).toEqual(["rag", "quiz", "reviewer", "qa"]);
    expect(selectAgents("summary")).toContain("study");
    expect(handoff(agentRoles.rag.name, "user-1", "retrieve", {}, "context")).toMatchObject({
      agent: "RAG/Research Agent",
      userId: "user-1",
      outputSchema: "context",
    });
  });

  it("runs RAG and quiz specialists through reviewer and QA", async () => {
    const result = await orchestrate("mcq", { userId: "user-1", topic: "photosynthesis" }, store);
    expect(result.selectedAgents).toEqual([
      "RAG/Research Agent",
      "Quiz Agent",
      "Reviewer Agent",
      "QA Agent",
    ]);
    expect(result.agent).toBe("Quiz Agent");
    expect(result.reviewer.approved).toBe(true);
    expect(result.qa.passed).toBe(true);
    expect(result.sources[0].documentId).toBe("doc-1");
  });

  it("rejects unsupported output and reports QA failure", () => {
    const review = reviewResponse(
      { summary: "Unsupported claim", grounded: false, sources: [] },
      "summary",
    );
    expect(review.approved).toBe(false);
    expect(runQaAgent(review.result, review).passed).toBe(false);
    expect(runQaAgent(review.result, review).failures).toHaveLength(1);
  });

  it("keeps Foundry unconfigured instead of fabricating hosted responses", async () => {
    const provider = createFoundryProvider({});
    expect(provider.mode).toBe("local");
    await expect(provider.run()).rejects.toMatchObject({
      code: "foundry_not_configured",
      status: 503,
    });
  });

  it("denies unknown or malformed tools and executes only authenticated allowlisted tools", async () => {
    expect(validateToolInput({ tool: "shell", command: "dir" }).allowed).toBe(false);
    expect(validateToolInput({ tool: "record_progress" }).allowed).toBe(false);
    await expect(
      executeTool({ tool: "shell", input: {}, store, userId: "user-1" }),
    ).rejects.toMatchObject({
      code: "tool_denied",
      status: 403,
    });
    const result = await executeTool({
      tool: "record_progress",
      input: { completed: 40 },
      store,
      userId: "user-1",
    });
    expect(result.progress.completed).toBe(40);
  });
});
