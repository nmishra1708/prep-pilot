// @vitest-environment node
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDatabase } from "./database.mjs";
import { registerDataRoutes } from "./api.mjs";
import { interviewSchema, studyItemSchema } from "./schemas.mjs";

let database;
let server;
let baseUrl;
let tempDirectory;
const defaultTestUser = "11111111-1111-4111-8111-111111111111";
const secondTestUser = "22222222-2222-4222-8222-222222222222";

const interviewInput = {
  companyName: "Example Systems",
  profile: "Senior Node.js Developer",
  rounds: [{
    roundName: "Technical 1", mode: "video", dateTime: "2027-01-08T10:00:00.000Z",
    duration: 60, status: "Scheduled", notes: "",
  }],
  status: "Scheduled",
  hr: { name: "", email: "", phone: "", linkedInUrl: "" },
  jobLink: "", linkedApplicationId: "",
  questions: [{
    questionText: "How do Node.js streams manage backpressure?",
    round: "Technical 1", topic: "Node.js", myAnswer: "A stream pauses when the writable buffer fills.",
    howItWent: "Good", correctAnswer: "", studyItemId: "",
  }],
  overallNotes: "", feedbackReceived: "", offerDetails: { ctc: "", joiningDate: "" },
};

const studyInput = {
  topic: "Node.js",
  question: "How does backpressure work?",
  answer: "Wait for `drain` before writing more.",
  diagram: { type: "mermaid", content: "flowchart LR\n A --> B" },
  tags: ["streams"],
  difficulty: "Medium",
  source: "own",
  sourceInterviewId: "",
  confidence: 3,
  lastReviewed: null,
  nextReviewAt: null,
  bookmarked: true,
  sourceCompanies: [],
};

beforeAll(async () => {
  tempDirectory = await mkdtemp(path.join(os.tmpdir(), "interview-study-test-"));
  database = await createDatabase({ filename: ":memory:", seedData: false });
  const app = express();
  app.use(express.json({ limit: "128kb" }));
  app.use((req, _res, next) => {
    req.auth = { userId: req.get("x-test-user") ?? defaultTestUser };
    next();
  });
  registerDataRoutes(app, { db: database, uploadsDirectory: path.join(tempDirectory, "uploads") });
  server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  database.close();
  await rm(tempDirectory, { recursive: true, force: true });
});

describe("interview and study schemas", () => {
  it("requires company, role, and valid HR contact details", () => {
    expect(interviewSchema.safeParse(interviewInput).success).toBe(true);
    expect(interviewSchema.safeParse({ ...interviewInput, companyName: "" }).success).toBe(false);
    expect(interviewSchema.safeParse({ ...interviewInput, hr: { ...interviewInput.hr, email: "not-an-email" } }).success).toBe(false);
  });

  describe("SQLite persistence", () => {
    it("seeds the requested sample dataset on a new local database", async () => {
      const seeded = await createDatabase({ filename: ":memory:" });
      expect(seeded.all("interviews")).toHaveLength(3);
      expect(seeded.all("study_items")).toHaveLength(10);
      expect(seeded.all("study_items").some((item) => item.diagram?.type === "mermaid")).toBe(true);
      seeded.close();
    });

    it("keeps records after reopening the database", async () => {
      const filename = path.join(tempDirectory, "persisted.sqlite");
      const first = await createDatabase({ filename, seedData: false });
      const now = new Date().toISOString();
      await first.put("study_items", { ...studyInput, id: "persistence-check", createdAt: now, updatedAt: now });
      await first.put("study_items", { ...studyInput, id: "persistence-check", question: "Updated question", createdAt: now, updatedAt: now });
      first.close();
      const second = await createDatabase({ filename, seedData: false });
      expect(second.get("study_items", "persistence-check")?.question).toBe("Updated question");
      second.close();
    });
  });

  it("validates diagram paths and study confidence", () => {
    expect(studyItemSchema.safeParse(studyInput).success).toBe(true);
    expect(studyItemSchema.safeParse({ ...studyInput, confidence: 6 }).success).toBe(false);
    expect(studyItemSchema.safeParse({ ...studyInput, diagram: { type: "image", content: "/uploads/unsafe.svg?x=1" } }).success).toBe(false);
  });
});

describe("interview and study REST endpoints", () => {
  it("validates inputs and provides paginated interview CRUD", async () => {
    const invalid = await fetch(`${baseUrl}/api/interviews`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...interviewInput, companyName: "" }),
    });
    expect(invalid.status).toBe(400);

    const createdResponse = await fetch(`${baseUrl}/api/interviews`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(interviewInput),
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json();
    expect(created.id).toBeTruthy();

    const page = await fetch(`${baseUrl}/api/interviews?q=Example&limit=1`).then((response) => response.json());
    expect(page.total).toBe(1);
    expect(page.items[0].companyName).toBe("Example Systems");

    const updated = await fetch(`${baseUrl}/api/interviews/${created.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...created, status: "Awaiting result" }),
    }).then((response) => response.json());
    expect(updated.status).toBe("Awaiting result");

    const deleted = await fetch(`${baseUrl}/api/interviews/${created.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(204);
    expect((await fetch(`${baseUrl}/api/interviews/${created.id}`)).status).toBe(404);
    const restored = await fetch(`${baseUrl}/api/interviews`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(created),
    });
    expect(restored.status).toBe(201);
    expect((await restored.json()).id).toBe(created.id);
    await fetch(`${baseUrl}/api/interviews/${created.id}`, { method: "DELETE" });
  });

  it("persists study CRUD, filters, and rejects invalid diagram uploads", async () => {
    const createdResponse = await fetch(`${baseUrl}/api/study-items`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(studyInput),
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json();
    const filtered = await fetch(`${baseUrl}/api/study-items?topic=Node.js&bookmarked=true`).then((response) => response.json());
    expect(filtered.items.some((item) => item.id === created.id)).toBe(true);

    const updateResponse = await fetch(`${baseUrl}/api/study-items/${created.id}`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...created, confidence: 5 }),
    });
    expect((await updateResponse.json()).confidence).toBe(5);

    const form = new FormData();
    form.append("diagram", new Blob(["not an image"], { type: "text/plain" }), "bad.txt");
    const upload = await fetch(`${baseUrl}/api/study-items/diagrams`, { method: "POST", body: form });
    expect(upload.status).toBe(400);

    expect((await fetch(`${baseUrl}/api/study-items/${created.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await fetch(`${baseUrl}/api/data/export`).then((response) => response.json())).studyItems).toHaveLength(0);
  });

  it("sanitizes and stores SVG uploads, then removes their files when the item is deleted", async () => {
    const form = new FormData();
    form.append("diagram", new Blob(['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><path d="M0 0"/></svg>'], { type: "image/svg+xml" }), "diagram.svg");
    const response = await fetch(`${baseUrl}/api/study-items/diagrams`, { method: "POST", body: form });
    const responseText = await response.text();
    expect(response.status, responseText).toBe(201);
    const diagram = JSON.parse(responseText);
    const filepath = path.join(tempDirectory, "uploads", defaultTestUser, path.basename(diagram.content));
    const sanitized = await readFile(filepath, "utf8");
    expect(sanitized).toContain("<svg");
    expect(sanitized).not.toMatch(/<script|onload=/i);

    const created = await fetch(`${baseUrl}/api/study-items`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...studyInput, diagram }),
    }).then((result) => result.json());
    expect((await fetch(`${baseUrl}/api/study-items/${created.id}`, { method: "DELETE" })).status).toBe(204);
    await expect(access(filepath)).rejects.toThrow();
  });

  it("rejects images larger than the upload limit", async () => {
    const oversized = new Uint8Array(2 * 1024 * 1024 + 1);
    oversized.set([137, 80, 78, 71, 13, 10, 26, 10]);
    const form = new FormData();
    form.append("diagram", new Blob([oversized], { type: "image/png" }), "large.png");
    expect((await fetch(`${baseUrl}/api/study-items/diagrams`, { method: "POST", body: form })).status).toBe(400);
  });

  it("clears every server-side record on request", async () => {
    await fetch(`${baseUrl}/api/interviews`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(interviewInput) });
    expect((await fetch(`${baseUrl}/api/data`, { method: "DELETE" })).status).toBe(204);
    expect((await fetch(`${baseUrl}/api/interviews`).then((response) => response.json())).total).toBe(0);
  });

  it("does not expose one user's interview to another user", async () => {
    const createdResponse = await fetch(`${baseUrl}/api/interviews`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": defaultTestUser },
      body: JSON.stringify(interviewInput),
    });
    const created = await createdResponse.json();
    const response = await fetch(`${baseUrl}/api/interviews/${created.id}`, { headers: { "x-test-user": secondTestUser } });
    expect(response.status).toBe(404);
    expect((await fetch(`${baseUrl}/api/interviews`, { headers: { "x-test-user": secondTestUser } }).then((result) => result.json())).total).toBe(0);
  });
});
