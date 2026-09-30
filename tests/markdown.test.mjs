import { describe, expect, it } from "vitest";
import { renderEvidence, renderMarkdown, renderPracticeEvidence } from "../apps/web/markdown.mjs";

describe("frontend Markdown rendering", () => {
  it("renders safe headings, emphasis, lists, paragraphs, and line breaks", () => {
    const html = renderMarkdown(
      "# OSI model\n\n**Seven layers**:\n\n1. Physical\n2. Data Link\n\n- Reliable delivery\n- <script>alert(1)</script>\n\nFinal line\nwith a line break",
    );
    expect(html).toContain("<h1>OSI model</h1>");
    expect(html).toContain("<strong>Seven layers</strong>");
    expect(html).toContain("<ol><li>Physical</li><li>Data Link</li></ol>");
    expect(html).toContain("<ul>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("<br />");
    expect(html).not.toContain("<script>");
  });

  it("removes internal citation markers before rendering", () => {
    const html = renderMarkdown("Supported answer \u30104:4\u2020source\u3011\n\n**Evidence**");
    expect(html).toContain("<p>Supported answer </p>");
    expect(html).not.toContain("【4:4");
    expect(html).not.toContain("**Evidence**");
  });

  it("renders escaped Study Agent Markdown safely", () => {
    const html = renderMarkdown(
      "\\### Key idea\n\n\\*\\*Important\\*\\*\n\n\\1. First step\n\\2. Second step\n\n\\- Supporting detail",
    );
    expect(html).toContain("<h3>Key idea</h3>");
    expect(html).toContain("<strong>Important</strong>");
    expect(html).toContain("<ol><li>First step</li><li>Second step</li></ol>");
    expect(html).toContain("<ul><li>Supporting detail</li></ul>");
    expect(html).not.toContain("\\###");
    expect(html).not.toContain("\\*\\*");
  });

  it("renders Practice Lab evidence with the clean source presentation", () => {
    const sources = [{ excerpt: "Grounded excerpt <script>alert(1)</script>" }];
    const html = renderPracticeEvidence(sources);
    expect(html).toContain("EVIDENCE");
    expect(html).toContain("Source 1");
    expect(html).toContain("Grounded excerpt &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("[1]");
    expect(html).not.toContain("source-line");
    expect(html).not.toContain("<script>");
    expect(html).toBe(renderEvidence(sources));
  });
});
