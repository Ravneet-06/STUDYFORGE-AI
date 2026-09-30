import { describe, expect, it } from "vitest";
import { conceptTerms, evaluateVivaAnswer, evaluateVivaSet } from "../apps/api/src/viva.mjs";

describe("Viva assessment", () => {
  it("awards full correctness only for substantial concept coverage", () => {
    const reference = "Mitochondria produce energy for the cell through cellular respiration.";
    const strong = evaluateVivaAnswer(
      reference,
      "Mitochondria produce energy for the cell using cellular respiration",
    );
    expect(strong.verdict).toBe("correct");
    expect(strong.score).toBeGreaterThanOrEqual(60);
  });

  it("never awards full correctness for a non-empty answer without the concepts", () => {
    const result = evaluateVivaAnswer("Mitochondria produce energy.", "yes");
    expect(result.verdict).toBe("incorrect");
    expect(result.score).toBeLessThan(30);
  });

  it("scores zero and explains a missing answer", () => {
    const result = evaluateVivaAnswer("Anything goes here", "   ");
    expect(result).toMatchObject({ verdict: "incorrect", score: 0 });
    expect(result.explanation).toMatch(/no answer/i);
  });

  it("caps credit when the reference exposes no comparable concepts", () => {
    const result = evaluateVivaAnswer("of to by", "an answer with several words in it here");
    expect(result.verdict).toBe("partial");
    expect(result.score).toBeLessThanOrEqual(50);
  });

  it("evaluates a full set and rejects malformed payloads", () => {
    const set = evaluateVivaSet({
      questions: [
        {
          question: "Explain respiration.",
          answer: "Mitochondria produce energy through respiration.",
        },
        {
          question: "Explain photosynthesis.",
          answer: "Chloroplasts convert light into chemical energy.",
        },
      ],
      answers: ["Mitochondria produce energy through respiration", "I do not know"],
    });
    expect(set.total).toBe(2);
    expect(set.results[0].verdict).toBe("correct");
    expect(set.results[1].verdict).toBe("incorrect");
    expect(set.completed).toBe(2);
    expect(set.verdict).toBe("partial");
    expect(() => evaluateVivaSet({ questions: [], answers: [] })).toThrow();
    expect(() =>
      evaluateVivaSet({ questions: [{ question: "a", answer: "b" }], answers: [] }),
    ).toThrow();
  });

  it("derives concept terms without exposing stopwords", () => {
    expect(conceptTerms("Explain this concept: mitochondria energy")).toEqual([
      "mitochondria",
      "energy",
    ]);
  });
});
