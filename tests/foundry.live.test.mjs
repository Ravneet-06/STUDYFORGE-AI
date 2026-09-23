import { describe, expect, it } from "vitest";
import { createFoundryProvider, getFoundryConfig } from "../apps/api/src/foundry.mjs";

const config = getFoundryConfig();
const live = Boolean(config);

describe.skipIf(!live)("live Microsoft Foundry agent", () => {
  it("invokes the configured StudyForge agent with Entra credentials", async () => {
    const result = await createFoundryProvider(config).run({
      message:
        "Answer briefly: what is the main subject of the Introduction to Computer Networks study material?",
    });
    expect(result.answer).toEqual(expect.any(String));
    expect(result.answer.length).toBeGreaterThan(0);
    expect(result.responseId).toEqual(expect.any(String));
  }, 30_000);
});
