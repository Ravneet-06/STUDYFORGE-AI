import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");

describe("foundation workspace", () => {
  it("contains the documented workspace and CI entry points", () => {
    for (const path of [
      "package.json",
      "package-lock.json",
      ".env.example",
      ".github/workflows/ci.yml",
      "docs/SETUP.md",
      "docs/ENVIRONMENT.md",
    ]) {
      expect(existsSync(join(root, path))).toBe(true);
    }
  });

  it("keeps secret-bearing environment values blank in the template", () => {
    const environment = readFileSync(join(root, ".env.example"), "utf8");

    for (const variable of ["SUPABASE_SERVICE_ROLE_KEY", "AZURE_OPENAI_API_KEY"]) {
      expect(environment).toMatch(new RegExp(`^${variable}=$`, "m"));
    }
  });
});
