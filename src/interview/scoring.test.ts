import { describe, expect, it } from "vitest";
import { calcPace, checkSTAR, detectFillers, detectPauses, scoreAnswer } from "./scoring";
import questionBank from "./question-bank.json";
import type { RoleId } from "./types";

describe("interview scoring helpers", () => {
  it("finds common fillers with their transcript offsets", () => {
    expect(detectFillers("Um, I would, like, add caching.")).toEqual([
      { word: "Um", index: 0 },
      { word: "like", index: 13 },
    ]);
  });

  it("calculates pace and pause markers safely", () => {
    expect(calcPace(120, 60_000)).toBe(120);
    expect(calcPace(10, 0)).toBe(0);
    expect(detectPauses({ longPauseSeconds: 4 }, 40)).toEqual([{ seconds: 20, durationSeconds: 4 }]);
  });

  it("checks STAR sections and assigns all six report categories", () => {
    const star = checkSTAR(
      "When the release failed, my role was to recover it. I led a rollback and improved monitoring. The result reduced incidents.",
      true,
    );
    expect(star.missing).toEqual([]);

    const bankQuestion = questionBank["fullstack" as RoleId].questions[0];
    const question = { ...bankQuestion, type: "technical" as const };
    const report = scoreAnswer({
      question,
      transcript: "I would authenticate and authorize each user, validate input, handle errors, add observability and rate limiting.",
      durationMs: 60_000,
      timeLimitSeconds: 120,
      firstWordSeconds: 1.2,
    });
    expect(report).toHaveLength(6);
    expect(report.every((item) => item.score >= 0 && item.score <= 100)).toBe(true);
    expect(report.every((item) => item.evidence.length > 0 && item.fix.length > 0)).toBe(true);
    expect(report[0].score).toBeGreaterThan(50);
  });
});
