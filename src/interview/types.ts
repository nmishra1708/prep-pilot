export type RoleId = "fullstack" | "node-lead" | "ai-llm";
export type InterviewType = "technical" | "behavioural" | "mixed";
export type CategoryName =
  | "Answer accuracy"
  | "Communication"
  | "Time management"
  | "Voice delivery"
  | "Answer structure"
  | "Nervousness signals";

export interface InterviewQuestion {
  id: string;
  type: Exclude<InterviewType, "mixed">;
  prompt: string;
  rubric: string[];
  referenceAnswer: string;
}

export interface Evidence {
  seconds: number;
  label: string;
  detail: string;
}

export interface CategoryReport {
  category: CategoryName;
  score: number;
  level: "Low" | "Medium" | "High";
  evidence: Evidence[];
  fix: string;
  notes: string[];
}

export interface AnswerRecord {
  questionId: string;
  question: string;
  transcript: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  video?: Blob;
  paceSamples: Array<{ seconds: number; wordsPerMinute: number }>;
  report: CategoryReport[];
}

export interface InterviewReport {
  id: string;
  userId?: string;
  role: RoleId;
  roleLabel: string;
  type: InterviewType;
  createdAt: number;
  answers: AnswerRecord[];
  categories: CategoryReport[];
  strengths: string[];
  fixes: string[];
  practicePlan: string;
}

export interface SessionConfig {
  role: RoleId;
  type: InterviewType;
  questionCount: number;
  timeLimitSeconds: number;
}
