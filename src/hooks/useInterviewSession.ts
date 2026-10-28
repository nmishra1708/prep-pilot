import { useCallback, useState } from "react";
import { combineReports } from "../interview/scoring";
import { saveInterview } from "../interview/storage";
import type {
  AnswerRecord,
  InterviewQuestion,
  InterviewReport,
  SessionConfig,
} from "../interview/types";
import questionBank from "../interview/question-bank.json";

const roleEntries = questionBank as Record<string, {
  label: string;
  questions: InterviewQuestion[];
}>;

function makeSessionId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useInterviewSession() {
  const [config, setConfig] = useState<SessionConfig | null>(null);
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [report, setReport] = useState<InterviewReport | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);

  const begin = useCallback((nextConfig: SessionConfig, additionalQuestions: InterviewQuestion[] = []) => {
    const selected = roleEntries[nextConfig.role].questions
      .filter((question) => nextConfig.type === "mixed" || question.type === nextConfig.type)
      .concat(additionalQuestions.filter((question) => nextConfig.type === "mixed" || question.type === nextConfig.type));
    const shuffled = [...selected].sort(() => Math.random() - 0.5);
    const picked = Array.from({ length: nextConfig.questionCount }, (_, position) =>
      shuffled[position % shuffled.length],
    );
    setConfig(nextConfig);
    setQuestions(picked);
    setIndex(0);
    setAnswers([]);
    setReport(null);
    setStorageError(null);
  }, []);

  const retry = useCallback(() => {
    setAnswers((current) => current.slice(0, index));
  }, [index]);

  const clear = useCallback(() => {
    setConfig(null);
    setQuestions([]);
    setIndex(0);
    setAnswers([]);
    setReport(null);
    setStorageError(null);
  }, []);

  const createReport = useCallback(async (answer: AnswerRecord): Promise<InterviewReport | null> => {
    if (!config) return null;
    const completedAnswers = [...answers.slice(0, index), answer];
    setAnswers(completedAnswers);
    const roleLabel = roleEntries[config.role].label;
    const categories = combineReports(completedAnswers.map((answer) => answer.report));
    const strengths = [...categories]
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((item) => `${item.category} (${item.score}/100)`);
    const fixes = [...categories]
      .sort((a, b) => a.score - b.score)
      .slice(0, 3)
      .map((item) => item.fix);
    const result: InterviewReport = {
      id: makeSessionId(),
      role: config.role,
      roleLabel,
      type: config.type,
      createdAt: Date.now(),
      answers: completedAnswers,
      categories,
      strengths,
      fixes,
      practicePlan: "Over the next 7 days: practise one answer each day, record a timed attempt, and review one specific rubric point and one delivery marker. Compare the next session rather than treating a single score as a verdict.",
    };
    setReport(result);
    try {
      await saveInterview(result);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "Could not save interview locally.");
    }
    return result;
  }, [answers, config, index, questions.length]);

  const next = useCallback(async (answer: AnswerRecord): Promise<InterviewReport | null> => {
    if (index < questions.length - 1) {
      setAnswers((current) => [...current.slice(0, index), answer]);
      setIndex((current) => current + 1);
      return null;
    }
    return createReport(answer);
  }, [createReport, index, questions.length]);

  const complete = createReport;

  return {
    config,
    questions,
    index,
    answers,
    report,
    storageError,
    begin,
    retry,
    clear,
    next,
    complete,
    currentQuestion: questions[index] ?? null,
    roleLabel: config ? roleEntries[config.role].label : "",
  };
}
