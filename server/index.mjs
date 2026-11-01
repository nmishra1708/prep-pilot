import "dotenv/config";
import express from "express";
import { z } from "zod";
import { registerJobRoutes } from "./jobs.mjs";
import { createDatabase } from "./data/database.mjs";
import { createPrismaDatabase } from "./data/prisma-database.mjs";
import { registerDataRoutes } from "./data/api.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import helmet from "helmet";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import { createAuthService } from "./auth/service.mjs";
import { createMailer } from "./auth/mailer.mjs";

const app = express();
const port = Number(process.env.PORT ?? 8787);
// const isLocalServer = !process.env.VERCEL && process.env.NODE_ENV !== "production";
const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const uploadsDirectory = path.join(serverDirectory, "uploads");
const appUrl = process.env.APP_URL
  ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : process.env.FRONTEND_ORIGIN ?? "http://localhost:5173");

const db = process.env.VERCEL || process.env.NODE_ENV === "production" || process.env.DATABASE_URL
  ? await createPrismaDatabase()
  : await createDatabase();


const mailer = createMailer();
const auth = createAuthService({ db, mailer, uploadsDirectory, baseUrl: appUrl });
const requestSchema = z.object({
  question: z.string().min(1).max(2000),
  transcript: z.string().max(30000),
  rubric: z.array(z.string().min(1).max(500)).min(1).max(20),
}).strict();
const resultSchema = z.object({
  status: z.enum(["correct", "partially correct", "incorrect"]),
  score: z.number().int().min(0).max(100),
  missingPoints: z.array(z.string()).max(20),
  factualErrors: z.array(z.string()).max(20),
  sampleAnswer: z.string().max(5000),
  followUp: z.string().max(1000).optional(),
  message: z.string().max(500).optional(),
});

app.disable("x-powered-by");
if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === "production" ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'", "blob:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
    },
  } : false,
}));
app.use(cors({
  origin: new URL(appUrl).origin,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-CSRF-Token"],
}));
app.use(express.json({ limit: "128kb" }));
if (process.env.NODE_ENV === "production") {
  app.use((req, res, next) => {
    if (!req.secure) return res.status(400).json({ error: "HTTPS is required." });
    next();
  });
}
const authIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many authentication attempts. Try again later." },
});
for (const route of ["/api/auth/signup", "/api/auth/login", "/api/auth/verify-email", "/api/auth/resend-verification", "/api/auth/forgot-password", "/api/auth/reset-password"]) {
  app.use(route, authIpLimiter);
}
auth.registerRoutes(app);
app.get("/api/health", async (_req, res, next) => {
  try {
    await db.health();
    res.json({ ok: true, database: "connected" });
  } catch (error) {
    next(error);
  }
});
app.use("/api", auth.requireAuth, auth.csrf);
app.use("/api/jobs", auth.requireVerified);
app.use("/api/evaluate", auth.requireVerified);
registerJobRoutes(app);
registerDataRoutes(app, { db, uploadsDirectory });

function localFallback(transcript, rubric) {
  const normalized = transcript.toLowerCase();
  const covered = rubric.filter((point) =>
    point.toLowerCase().split(/\s+/).some((word) => word.length > 4 && normalized.includes(word)),
  );
  const missingPoints = rubric.filter((point) => !covered.includes(point));
  const score = Math.round((covered.length / rubric.length) * 100);
  return {
    status: score >= 75 ? "correct" : score >= 35 ? "partially correct" : "incorrect",
    score,
    missingPoints,
    factualErrors: [],
    sampleAnswer: "LLM evaluation is not configured. Use the visible rubric as a guide and review this answer manually.",
    message: "Local rubric fallback used; no model evaluation was performed.",
  };
}

app.post("/api/evaluate", async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Please provide a question, transcript, and rubric in the expected format." });
    return;
  }
  const { question, transcript, rubric } = parsed.data;
  const apiKey = process.env.LLM_API_KEY;
  const endpoint = process.env.LLM_API_URL ?? "https://api.openai.com/v1/chat/completions";
  if (!apiKey) {
    res.json(resultSchema.parse(localFallback(transcript, rubric)));
    return;
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8_000),
      body: JSON.stringify({
        model: process.env.LLM_MODEL ?? "gpt-4o-mini",
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "Evaluate interview answers only against the supplied rubric. Do not invent evidence. Return JSON with status (correct, partially correct, incorrect), integer score 0-100, missingPoints, factualErrors, sampleAnswer, and optionally a concise followUp. If unsure, say so in message.",
          },
          {
            role: "user",
            content: JSON.stringify({ question, rubric, transcript }),
          },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Evaluator returned HTTP ${response.status}`);
    const body = await response.json();
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("Evaluator response had no structured content");
    const output = resultSchema.safeParse(JSON.parse(content));
    if (!output.success) throw new Error("Evaluator response did not match the required schema");
    res.json(output.data);
  } catch {
    res.json({
      ...localFallback(transcript, rubric),
      message: "The evaluator could not be reached or returned invalid data. A local rubric fallback is shown.",
    });
  }
});

app.use((error, _req, res, next) => {
  console.error("API request failed", {
    name: error?.name ?? "Error",
    code: error?.code ?? "UNKNOWN",
  });
  if (["MISSING_JWT_ACCESS_SECRET", "MISSING_TOKEN_HASH_SECRET", "MAIL_CONFIGURATION_MISSING"].includes(error?.code)) {
    res.status(503).json({ error: error.message });
    return;
  }
  if (typeof error?.code === "string" && error.code.startsWith("P")) {
    res.status(503).json({ error: "Database unavailable. Check the PostgreSQL connection and apply Prisma migrations." });
    return;
  }
  if (error instanceof SyntaxError && "body" in error) {
    res.status(400).json({ error: "Request body must be valid JSON." });
    return;
  }
  if (error?.code === "LIMIT_FILE_SIZE") {
    res.status(400).json({ error: "Diagram image must be 2 MB or smaller." });
    return;
  }
  if (error?.message?.includes("image only")) {
    res.status(400).json({ error: error.message });
    return;
  }
  if (res.headersSent) {
    next(error);
    return;
  }
  res.status(500).json({ error: "The server could not complete this request." });
});

// if (isLocalServer) {
//   app.listen(port, process.env.HOST ?? "127.0.0.1", () => {
//     console.log(`Interview evaluator listening on http://127.0.0.1:${port}`);
//   });
// }

export default app;
