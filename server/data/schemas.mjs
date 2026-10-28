import { z } from "zod";

const optionalText = (limit) => z.string().trim().max(limit).optional().default("");

export const interviewSchema = z.object({
  id: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  createdAt: z.string().datetime({ offset: true }).optional(),
  updatedAt: z.string().datetime({ offset: true }).optional(),
  companyName: z.string().trim().min(1, "Company name is required.").max(160),
  profile: z.string().trim().min(1, "Profile / role is required.").max(200),
  rounds: z.array(z.object({
    id: z.string().min(1).max(100).optional(),
    roundName: z.string().trim().min(1).max(120),
    mode: z.enum(["phone", "video", "onsite"]),
    dateTime: z.string().datetime({ offset: true }),
    duration: z.number().int().min(5).max(600),
    status: z.enum(["Scheduled", "Completed", "Awaiting result", "Selected", "Rejected", "On hold", "Withdrawn"]),
    notes: optionalText(5000),
  }).strict()).max(50).default([]),
  status: z.enum(["Scheduled", "Completed", "Awaiting result", "Selected", "Rejected", "On hold", "Withdrawn"]),
  hr: z.object({
    name: optionalText(120),
    email: z.union([z.literal(""), z.string().trim().email().max(254)]).optional().default(""),
    phone: z.union([z.literal(""), z.string().trim().regex(/^\+?[0-9\s().-]{7,25}$/).max(25)]).optional().default(""),
    linkedInUrl: z.union([z.literal(""), z.string().trim().url().max(500)]).optional().default(""),
  }).strict().default({}),
  jobLink: z.union([z.literal(""), z.string().trim().url().max(1500)]).optional().default(""),
  linkedApplicationId: optionalText(200),
  questions: z.array(z.object({
    id: z.string().min(1).max(100).optional(),
    questionText: z.string().trim().min(1).max(5000),
    round: optionalText(120),
    topic: z.string().trim().min(1).max(120),
    myAnswer: optionalText(10000),
    howItWent: z.enum(["Good", "Average", "Poor"]).default("Average"),
    correctAnswer: optionalText(10000),
    studyItemId: optionalText(100),
  }).strict()).max(200).default([]),
  overallNotes: optionalText(10000),
  feedbackReceived: optionalText(10000),
  offerDetails: z.object({
    ctc: optionalText(120),
    joiningDate: z.union([z.literal(""), z.string().date()]).optional().default(""),
  }).strict().default({}),
}).strict();

export const studyItemSchema = z.object({
  id: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  createdAt: z.string().datetime({ offset: true }).optional(),
  updatedAt: z.string().datetime({ offset: true }).optional(),
  topic: z.string().trim().min(1, "Topic is required.").max(120),
  question: z.string().trim().min(1, "Question is required.").max(5000),
  answer: z.string().max(80000).default(""),
  diagram: z.object({
    type: z.enum(["mermaid", "image"]),
    content: z.string().max(80000),
  }).nullable().optional().default(null),
  tags: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
  difficulty: z.enum(["Easy", "Medium", "Hard"]).default("Medium"),
  source: z.enum(["company interview", "book", "own"]).default("own"),
  sourceInterviewId: optionalText(100),
  confidence: z.number().int().min(1).max(5).default(3),
  lastReviewed: z.string().datetime({ offset: true }).nullable().default(null),
  nextReviewAt: z.string().datetime({ offset: true }).nullable().default(null),
  bookmarked: z.boolean().default(false),
  sourceCompanies: z.array(z.string().max(160)).max(50).default([]),
}).strict().superRefine((item, context) => {
  if (item.diagram?.type === "image" && !/^\/api\/study-items\/diagrams\/[a-zA-Z0-9_-]+\.(?:png|jpe?g|svg)$/i.test(item.diagram.content)) {
    context.addIssue({ code: "custom", path: ["diagram", "content"], message: "Diagram image must use a validated local upload path." });
  }
});

export const listQuerySchema = z.object({
  q: z.string().trim().max(300).optional(),
  status: z.enum(["Scheduled", "Completed", "Awaiting result", "Selected", "Rejected", "On hold", "Withdrawn"]).optional(),
  company: z.string().trim().max(160).optional(),
  topic: z.string().trim().max(120).optional(),
  difficulty: z.enum(["Easy", "Medium", "Hard"]).optional(),
  confidence: z.coerce.number().int().min(1).max(5).optional(),
  bookmarked: z.enum(["true", "false"]).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict().superRefine((query, context) => {
  if (query.from && query.to && query.from > query.to) {
    context.addIssue({ code: "custom", path: ["to"], message: "The end date must be on or after the start date." });
  }
});
