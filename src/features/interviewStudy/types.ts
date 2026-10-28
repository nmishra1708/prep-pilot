export type InterviewStatus = "Scheduled" | "Completed" | "Awaiting result" | "Selected" | "Rejected" | "On hold" | "Withdrawn";
export type RoundStatus = InterviewStatus;
export type StudyDifficulty = "Easy" | "Medium" | "Hard";

export interface InterviewRound {
  id?: string;
  roundName: string;
  mode: "phone" | "video" | "onsite";
  dateTime: string;
  duration: number;
  status: RoundStatus;
  notes: string;
}

export interface InterviewQuestion {
  id?: string;
  questionText: string;
  round: string;
  topic: string;
  myAnswer: string;
  howItWent: "Good" | "Average" | "Poor";
  correctAnswer: string;
  studyItemId: string;
}

export interface Interview {
  id: string;
  userId?: string;
  createdAt: string;
  updatedAt: string;
  companyName: string;
  profile: string;
  rounds: InterviewRound[];
  status: InterviewStatus;
  hr: { name: string; email: string; phone: string; linkedInUrl: string };
  jobLink: string;
  linkedApplicationId: string;
  questions: InterviewQuestion[];
  overallNotes: string;
  feedbackReceived: string;
  offerDetails: { ctc: string; joiningDate: string };
}

export interface StudyItem {
  id: string;
  userId?: string;
  createdAt: string;
  updatedAt: string;
  topic: string;
  question: string;
  answer: string;
  diagram: { type: "mermaid" | "image"; content: string } | null;
  tags: string[];
  difficulty: StudyDifficulty;
  source: "company interview" | "book" | "own";
  sourceInterviewId: string;
  confidence: number;
  lastReviewed: string | null;
  nextReviewAt: string | null;
  bookmarked: boolean;
  sourceCompanies: string[];
}

export interface PageResult<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export const interviewStatuses: InterviewStatus[] = ["Scheduled", "Completed", "Awaiting result", "Selected", "Rejected", "On hold", "Withdrawn"];
export const roundStatuses: RoundStatus[] = ["Scheduled", "Completed", "Awaiting result", "Selected", "Rejected", "On hold", "Withdrawn"];

export function newRound(): InterviewRound {
  return { roundName: "", mode: "video", dateTime: "", duration: 45, status: "Scheduled", notes: "" };
}

export function newQuestion(): InterviewQuestion {
  return { questionText: "", round: "", topic: "", myAnswer: "", howItWent: "Average", correctAnswer: "", studyItemId: "" };
}
