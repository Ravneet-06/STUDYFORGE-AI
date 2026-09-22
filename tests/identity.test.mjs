import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getSupabaseConfig } from "../apps/api/src/supabase.mjs";

const root = join(import.meta.dirname, "..");

describe("Supabase identity foundation", () => {
  it("keeps local mode when provider credentials are absent", () => {
    expect(getSupabaseConfig({ SUPABASE_URL: "", SUPABASE_ANON_KEY: "" })).toBeNull();
  });

  it("rejects partial provider configuration", () => {
    expect(() =>
      getSupabaseConfig({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "" }),
    ).toThrow(/configured together/);
  });

  it("defines all user-owned tables and RLS coverage", () => {
    const schema = readFileSync(join(root, "supabase/migrations/0001_studyforge.sql"), "utf8");
    const rls = readFileSync(join(root, "supabase/migrations/0002_identity_rls.sql"), "utf8");
    for (const table of [
      "profiles",
      "documents",
      "document_chunks",
      "conversations",
      "messages",
      "quizzes",
      "quiz_questions",
      "quiz_attempts",
      "study_plans",
      "progress",
      "agent_tasks",
      "evaluations",
    ]) {
      expect(schema).toContain(`create table if not exists public.${table}`);
      expect(rls).toContain(table === "profiles" ? "user owns profiles" : `'${table}'`);
    }
    expect(rls).toContain("using (id = (select auth.uid()))");
    expect(rls).toContain("document ownership mismatch");
  });
});
