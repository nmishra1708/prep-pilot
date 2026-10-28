import { apiFetch } from "../auth/api";
import { z } from "zod";
import type { CategoryReport, InterviewReport } from "./types";
import { combineReports } from "./scoring";
import questionBank from "./question-bank.json";

const evaluationSchema = z.object({
  status: z.enum(["correct", "partially correct", "incorrect"]),
  score: z.number().int().min(0).max(100),
  missingPoints: z.array(z.string()),
  factualErrors: z.array(z.string()),
  sampleAnswer: z.string(),
  followUp: z.string().optional(),
  message: z.string().optional(),
});

export async function evaluateReport(report: InterviewReport): Promise<InterviewReport> {
  const answers = await Promise.all(report.answers.map(async (answer) => {
    try {
      const question = Object.values(questionBank)
        .flatMap((role) => role.questions)
        .find((item) => item.id === answer.questionId);
      if (!question) throw new Error("The answer rubric is unavailable.");
      const response = await apiFetch("/api/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(8_500),
        body: JSON.stringify({
          question: answer.question,
          transcript: answer.transcript,
          rubric: question.rubric,
        }),
      });
      if (!response.ok) throw new Error(`Evaluation service returned ${response.status}`);
      const evaluation = evaluationSchema.parse(await response.json());
      const updated = answer.report.map((category): CategoryReport => category.category !== "Answer accuracy"
        ? category
        : {
          ...category,
          score: evaluation.score,
          level: evaluation.score >= 75 ? "High" : evaluation.score >= 45 ? "Medium" : "Low",
          evidence: [{
            seconds: category.evidence[0]?.seconds ?? 0,
            label: `Rubric result: ${evaluation.status}`,
            detail: `${evaluation.message ?? "Server-side rubric evaluation."}${evaluation.factualErrors.length ? ` Factual concerns: ${evaluation.factualErrors.join("; ")}.` : ""}`,
          }],
          notes: evaluation.missingPoints,
          fix: `${evaluation.missingPoints.length
            ? `Cover these missing rubric points: ${evaluation.missingPoints.join(", ")}.`
            : "No rubric points were flagged as missing."} Sample stronger answer: ${evaluation.sampleAnswer}`,
        });
      return { ...answer, report: updated };
    } catch {
      return {
        ...answer,
        report: answer.report.map((category): CategoryReport =>
          category.category === "Answer accuracy"
            ? { ...category, notes: [...category.notes, "Server evaluation unavailable; local keyword rubric remains visible."] }
            : category,
        ),
      };
    }
  }));
  const categories = combineReports(answers.map((answer) => answer.report));
  return {
    ...report,
    answers,
    categories,
    strengths: [...categories].sort((a, b) => b.score - a.score).slice(0, 3)
      .map((item) => `${item.category} (${item.score}/100)`),
    fixes: [...categories].sort((a, b) => a.score - b.score).slice(0, 3).map((item) => item.fix),
  };
}
