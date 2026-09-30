import { describe, expect, it } from "vitest";
import {
  gradeQuiz,
  renderQuiz,
  renderQuizFeedback,
  renderViva,
  renderVivaFeedback,
} from "../apps/web/quiz.mjs";

const questions = [
  { question: "Which color is primary?", options: ["Red", "Green"], answer: "Red" },
  { question: "Which is a mammal?", options: ["Whale", "Lizard"], answer: "Whale" },
];

describe("Practice Lab quiz interactions", () => {
  it("renders each answer as a separate selectable radio option", () => {
    const html = renderQuiz(questions);
    expect((html.match(/type="radio"/g) || []).length).toBe(4);
    expect(html).toContain('name="question-0" value="0"');
    expect(html).toContain('name="question-0" value="1"');
    expect(html).toContain('name="question-1" value="0"');
    expect(html).toContain('name="question-1" value="1"');
    expect(html).toContain("Submit answers");
  });

  it("grades selected answers and renders correct and incorrect feedback", () => {
    const graded = gradeQuiz(questions, { 0: "0", 1: "1" });
    expect(graded).toMatchObject({ score: 1, total: 2 });
    expect(graded.results[0].correct).toBe(true);
    expect(graded.results[1].correct).toBe(false);
    const feedback = renderQuizFeedback(graded);
    expect(feedback).toContain("Score: 1/2");
    expect(feedback).toContain("Correct · Question 1");
    expect(feedback).toContain("Incorrect · Question 2");
    expect(feedback).toContain("Correct answer: Whale");
  });

  it("renders Viva as text answers without MCQ options", () => {
    const html = renderViva([
      { question: "Explain photosynthesis.", answer: "It converts light into energy." },
      { question: "Why is it important?", answer: "It supports life." },
    ]);
    expect((html.match(/<textarea/g) || []).length).toBe(2);
    expect(html).toContain('name="question-0"');
    expect(html).toContain('name="question-1"');
    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain('class="options"');
    expect(html).toContain("Check answers");
  });

  it("shows submitted Viva answers and completion feedback", () => {
    const feedback = renderVivaFeedback(
      [{ answer: "Reference explanation" }, { answer: "Reference importance" }],
      ["My explanation", ""],
    );
    expect(feedback).toContain("Answers submitted");
    expect(feedback).toContain("1/2 completed");
    expect(feedback).toContain("Your answer: My explanation");
    expect(feedback).toContain("No answer provided");
    expect(feedback).toContain("Reference answer: Reference explanation");
  });
});
