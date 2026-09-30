import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("frontend text encoding", () => {
  it("keeps symbols and punctuation as valid UTF-8 source text", async () => {
    const source = await readFile("apps/web/app.js", "utf8");
    expect(source).toContain("✦");
    expect(source).toContain("✓");
    expect(source).toContain("→");
    expect(source).toContain("Loading your workspace…");
    expect(source).not.toMatch(/(?:â(?:€|œ|†|—|–)|ï¼|Â·|�)/u);
  });
});
