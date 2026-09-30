import { describe, expect, it } from "vitest";
import { makeQuestions, runQuizAgent } from "../apps/api/src/agents.mjs";

const context = [
  "Mitochondria produce energy for the cell through cellular respiration.",
  "Chloroplasts convert light energy into chemical energy during photosynthesis.",
  "Ribosomes assemble proteins from amino acids using messenger RNA.",
].join(" ");

describe("grounded MCQ generation", () => {
  it("uses material-derived options with exactly one correct answer", () => {
    const { questions } = runQuizAgent(
      { userId: "user-1", kind: "mcq", topic: "cells" },
      { context: [{ text: context }], sources: [{ documentId: "doc-1", chunkId: "chunk-1" }] },
    );
    expect(questions).toHaveLength(3);
    for (const question of questions) {
      expect(question.options).toHaveLength(4);
      expect(new Set(question.options).size).toBe(4);
      expect(question.options.filter((option) => option === question.answer)).toHaveLength(1);
      expect(question.answer).not.toBe("Review the source material");
      expect(question.question).toContain("study material");
    }
  });

  it("does not reuse the same correct answer for every question", () => {
    const { questions } = runQuizAgent(
      { userId: "user-1", kind: "mcq", topic: "cells" },
      { context: [{ text: context }], sources: [{ documentId: "doc-1", chunkId: "chunk-1" }] },
    );
    expect(new Set(questions.map((question) => question.answer)).size).toBeGreaterThan(1);
  });

  it("varies the position of the correct option", () => {
    const questions = makeQuestions(context, 3, false);
    const positions = questions.map((question) => question.options.indexOf(question.answer));
    expect(new Set(positions).size).toBeGreaterThan(1);
  });

  it("keeps Viva open-ended with a reference answer and no options", () => {
    const questions = makeQuestions(context, 5, true);
    expect(questions).toHaveLength(5);
    questions.forEach((question) => {
      expect(question).not.toHaveProperty("options");
      expect(typeof question.answer).toBe("string");
    });
  });

  it("falls back safely when the material has no usable concepts", () => {
    const questions = makeQuestions("", 3, false);
    expect(questions).toHaveLength(3);
    questions.forEach((question) => {
      expect(question.options).toHaveLength(4);
      expect(question.options.filter((option) => option === question.answer)).toHaveLength(1);
    });
  });
});
