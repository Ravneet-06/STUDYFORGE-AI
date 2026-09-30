import { describe, expect, it } from "vitest";
import {
  classifyAgentLabels,
  formatRoutingComment,
  hasRoutingComment,
  routingCommentMarker,
} from "../scripts/issue-routing.mjs";

describe("deterministic GitHub Issue routing", () => {
  it("reports a missing responsible agent when no recognized agent label is present", () => {
    const result = classifyAgentLabels([{ name: "enhancement" }, "priority:high"]);

    expect(result).toEqual({ status: "missing", labels: [] });
    expect(formatRoutingComment(result, "<!-- route -->")).toContain("Missing responsible agent.");
  });

  it.each([
    ["agent:orchestrator", "Orchestrator"],
    ["agent:database", "Database"],
    ["agent:backend", "Backend"],
    ["agent:rag", "RAG"],
    ["agent:mcp", "MCP"],
    ["agent:frontend", "Frontend"],
    ["agent:security", "Security"],
    ["agent:qa", "QA"],
    ["agent:reviewer", "Reviewer"],
  ])("routes exactly one %s label to %s", (label, role) => {
    expect(classifyAgentLabels([{ name: label }])).toEqual({ status: "routed", label, role });
  });

  it("requires exactly one responsible agent when multiple recognized labels are present", () => {
    const result = classifyAgentLabels(["agent:qa", "agent:backend", "enhancement"]);

    expect(result).toEqual({ status: "multiple", labels: ["agent:backend", "agent:qa"] });
    expect(formatRoutingComment(result, "<!-- route -->")).toContain(
      "Exactly one responsible agent label is required",
    );
  });

  it("treats duplicate copies of the same label as one responsible agent", () => {
    expect(classifyAgentLabels(["agent:qa", { name: "agent:qa" }])).toEqual({
      status: "routed",
      label: "agent:qa",
      role: "QA",
    });
  });

  it("creates distinct deduplication markers for separate opened and reopened events", () => {
    expect(routingCommentMarker("opened", "2026-09-30T12:00:00Z")).not.toBe(
      routingCommentMarker("reopened", "2026-09-30T12:00:00Z"),
    );
    expect(routingCommentMarker("reopened", "2026-09-30T12:00:00Z")).toBe(
      routingCommentMarker("reopened", "2026-09-30T12:00:00Z"),
    );
  });

  it("detects a matching bot routing comment but ignores human-authored markers", () => {
    const marker = "<!-- studyforge-issue-routing:opened:2026-09-30 -->";

    expect(
      hasRoutingComment([{ user: { type: "Bot" }, body: `${marker}\nAlready routed` }], marker),
    ).toBe(true);
    expect(hasRoutingComment([{ user: { type: "User" }, body: marker }], marker)).toBe(false);
    expect(hasRoutingComment([], marker)).toBe(false);
  });
});
