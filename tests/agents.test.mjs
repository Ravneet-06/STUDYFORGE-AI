import { describe, expect, it } from "vitest";
import { agentRoles, handoff } from "../apps/api/src/agent-contracts.mjs";
import {
  orchestrate,
  reviewResponse,
  runQaAgent,
  runQuizAgent,
  selectAgents,
} from "../apps/api/src/agents.mjs";
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

  it("creates open-ended grounded Viva questions without MCQ options", () => {
    const result = runQuizAgent(
      { userId: "user-1", kind: "viva", topic: "photosynthesis" },
      {
        context: [
          {
            text: "Photosynthesis converts light into chemical energy.",
          },
        ],
        sources: [{ documentId: "doc-1", chunkId: "chunk-1" }],
      },
    );
    expect(result.questions).toHaveLength(5);
    expect(result.questions[0]).not.toHaveProperty("options");
    expect(result.questions[0].answer).toContain("Photosynthesis converts");
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

  it("calls the Foundry Responses API through the provider boundary and preserves citations", async () => {
    const create = async (...args) => {
      expect(args[0]).toEqual({ input: "Explain networking." });
      expect(args[1]).toEqual({
        body: {
          agent_reference: { name: "StudyForge-Study-Agent", type: "agent_reference" },
        },
      });
      return {
        id: "response-1",
        output_text: "Networking connects devices.",
        output: [
          {
            content: [
              {
                annotations: [
                  { file_id: "source-1", chunk_id: "chunk-1", quote: "Networks connect devices." },
                ],
              },
            ],
          },
        ],
      };
    };
    const provider = createFoundryProvider(
      {
        endpoint: "https://example.services.ai.azure.com/api/projects/studyforge",
        agentName: "StudyForge-Study-Agent",
      },
      { client: { responses: { create } } },
    );
    await expect(provider.run({ message: "Explain networking." })).resolves.toMatchObject({
      answer: "Networking connects devices.",
      responseId: "response-1",
      sources: [{ documentId: "source-1", chunkId: "chunk-1" }],
    });
  });

  it("reports configured Foundry failures with a safe, provider-specific error", async () => {
    const provider = createFoundryProvider(
      {
        endpoint: "https://example.services.ai.azure.com/api/projects/studyforge",
        agentName: "StudyForge-Study-Agent",
      },
      {
        client: {
          responses: {
            create: async () => {
              throw new Error("credential token must not be exposed");
            },
          },
        },
      },
    );
    await expect(provider.run({ message: "Explain networking." })).rejects.toMatchObject({
      code: "foundry_unavailable",
      status: 502,
      message: "Microsoft Foundry could not complete this request. Try again shortly.",
    });
  });

  it("uses the configured provider while retaining the reviewer and QA boundary", async () => {
    const provider = {
      mode: "foundry",
      configured: true,
      async run() {
        return {
          answer: "Photosynthesis converts light into chemical energy.",
          sources: [{ documentId: "source-1", chunkId: "chunk-1" }],
        };
      },
    };
    const result = await orchestrate(
      "assistant",
      { userId: "user-1", question: "Explain photosynthesis." },
      store,
      { provider },
    );
    expect(result.provider).toBe("foundry");
    expect(result.answer).toBe("Photosynthesis converts light into chemical energy.");
    expect(result.reviewer.approved).toBe(true);
    expect(result.qa.passed).toBe(true);
  });

  it("refuses off-topic assistant requests without calling the provider", async () => {
    const provider = {
      mode: "foundry",
      configured: true,
      async run() {
        throw new Error("provider should not be called without supporting context");
      },
    };
    const result = await orchestrate(
      "assistant",
      { userId: "user-1", question: "What is the recipe for making pizza?" },
      store,
      { provider },
    );
    expect(result.grounded).toBe(false);
    expect(result.answer).toContain("couldn't find that in your uploaded study material");
    expect(result.sources).toEqual([]);
  });

  it("surfaces a first-request retrieval failure as retryable and grounds the identical retry", async () => {
    let calls = 0;
    const intermittentStore = {
      ...store,
      async getChunks(userId) {
        calls += 1;
        if (calls === 1) throw new Error("temporary retrieval startup failure");
        return [
          {
            id: "osi-1",
            documentId: "networking-notes",
            userId,
            index: 0,
            text: "The OSI model has seven layers.",
            keywords: ["osi", "model", "seven", "layers"],
          },
        ];
      },
    };
    const input = { userId: "user-1", question: "whar is osi" };
    await expect(orchestrate("assistant", input, intermittentStore)).rejects.toMatchObject({
      status: 503,
      code: "retrieval_unavailable",
      publicMessage: "Study material search is temporarily unavailable. Please try again.",
    });
    const retried = await orchestrate("assistant", input, intermittentStore);
    expect(calls).toBe(2);
    expect(retried.grounded).toBe(true);
    expect(retried.answer).toContain("The OSI model has seven layers.");
    expect(retried.sources).toEqual([expect.objectContaining({ documentId: "networking-notes" })]);
  });

  it("retrieves short technical acronyms from legacy chunks on the very first request", async () => {
    const legacyIndexedStore = {
      ...store,
      async getChunks(userId) {
        return [
          {
            id: "osi-legacy",
            documentId: "networking-notes",
            userId,
            index: 0,
            text: "OSI is the Open Systems Interconnection model with seven layers.",
            keywords: ["open", "systems", "interconnection", "model", "with", "seven", "layers"],
          },
        ];
      },
    };
    const input = { userId: "user-1", question: "whar is osi" };
    const first = await orchestrate("assistant", input, legacyIndexedStore);
    const repeated = await orchestrate("assistant", input, legacyIndexedStore);
    expect(first.grounded).toBe(true);
    expect(first.answer).toContain("OSI is the Open Systems Interconnection model");
    expect(first.sources).toEqual([expect.objectContaining({ documentId: "networking-notes" })]);
    expect(repeated.grounded).toBe(true);
  });

  it("returns evidence-not-found only when retrieval completed successfully with no matches", async () => {
    const emptyStore = {
      ...store,
      async getChunks() {
        return [];
      },
    };
    const result = await orchestrate(
      "assistant",
      { userId: "user-1", question: "whar is osi" },
      emptyStore,
    );
    expect(result).toMatchObject({ grounded: false, sources: [] });
    expect(result.answer).toContain("couldn't find that in your uploaded study material");
  });

  it("grounds Foundry answers in authorized retrieved chunks", async () => {
    let message;
    const provider = {
      mode: "foundry",
      configured: true,
      async run(input) {
        message = input.message;
        return {
          answer:
            "The model has seven layers.\u3010Source 1 | Source 2 | Source 3\u3011 \u30104:4\u2020source\u3011",
          sources: [{ documentId: "unrelated-foundry-file", chunkId: "unrelated-chunk" }],
        };
      },
    };
    const groundedStore = {
      ...store,
      async getChunks() {
        return [
          {
            id: "chunk-osi-1",
            documentId: "uploaded-osi",
            index: 4,
            text: "The OSI model separates network communication into seven layers.",
            keywords: ["model", "separates", "network", "communication", "seven", "layers"],
          },
        ];
      },
    };
    const result = await orchestrate(
      "assistant",
      { userId: "user-1", question: "How many OSI layers are there?" },
      groundedStore,
      { provider },
    );
    expect(message).toContain("The OSI model separates network communication into seven layers.");
    expect(result.grounded).toBe(true);
    expect(result.sources).toEqual([
      expect.objectContaining({ documentId: "uploaded-osi", chunkId: "chunk-osi-1" }),
    ]);
    expect(result.sources).not.toContainEqual(
      expect.objectContaining({ documentId: "unrelated-foundry-file" }),
    );
    expect(result.answer).not.toContain("【4:4");
    expect(result.answer).not.toContain("【Source 1");
  });

  it("requests structured Markdown without changing the authorized context", async () => {
    let message;
    const provider = {
      mode: "foundry",
      configured: true,
      async run(input) {
        message = input.message;
        return {
          answer: "1. First point\n2. Second point",
          sources: [],
        };
      },
    };
    await orchestrate(
      "assistant",
      { userId: "user-1", question: "Explain photosynthesis." },
      store,
      { provider },
    );
    expect(message).toContain("Write a concise, student-friendly Markdown response.");
    expect(message).toContain(
      "When the answer naturally contains multiple items, use a real Markdown list with one item per line",
    );
    expect(message).toContain("Keep every claim grounded in the authorized source context.");
    expect(message).toContain("Photosynthesis converts light into chemical energy.");
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
      input: { plan: "Review the OSI model." },
      store,
      userId: "user-1",
    });
    expect(result.progress.plan).toBe("Review the OSI model.");
    await expect(
      executeTool({
        tool: "record_progress",
        input: { completed: 100 },
        store,
        userId: "user-1",
      }),
    ).rejects.toMatchObject({ code: "tool_denied", status: 403 });
  });
});
