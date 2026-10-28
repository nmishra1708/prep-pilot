import { randomUUID } from "node:crypto";
import { mkdir, rm, unlink } from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import sanitizeHtml from "sanitize-html";
import { interviewSchema, listQuerySchema, studyItemSchema } from "./schemas.mjs";

function failure(res, status, message) {
  res.status(status).json({ error: message });
}

function matchesSearch(record, query) {
  const value = query.toLowerCase();
  return JSON.stringify(record).toLowerCase().includes(value);
}

function paginate(records, page, limit) {
  const total = records.length;
  return { items: records.slice((page - 1) * limit, page * limit), page, limit, total, pages: Math.ceil(total / limit) };
}

function parsePage(req, res) {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    failure(res, 400, "List filters are invalid. Check search, date, and pagination values.");
    return null;
  }
  return parsed.data;
}

async function removeDiagramFile(diagram, uploadsDirectory, userId) {
  if (diagram?.type !== "image" || !diagram.content.startsWith("/api/study-items/diagrams/")) return;
  const filename = path.basename(diagram.content);
  try {
    await unlink(path.join(uploadsDirectory, userId, filename));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export function registerDataRoutes(app, { db, uploadsDirectory }) {
  const userDb = (req) => db.userScoped(req.auth.userId);
  const storage = multer.diskStorage({
    destination: (req, _file, callback) => {
      const directory = path.join(uploadsDirectory, req.auth.userId);
      void mkdir(directory, { recursive: true }).then(() => callback(null, directory), callback);
    },
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase();
      callback(null, `${randomUUID()}${extension}`);
    },
  });
  const upload = multer({
    storage,
    limits: { fileSize: 2 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, callback) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const valid = (file.mimetype === "image/png" && ext === ".png")
        || (file.mimetype === "image/jpeg" && [".jpg", ".jpeg"].includes(ext))
        || (file.mimetype === "image/svg+xml" && ext === ".svg");
      callback(valid ? null : new Error("Upload a PNG, JPG, or SVG image only."), valid);
    },
  });

  app.get("/api/interviews", (req, res) => {
    const query = parsePage(req, res);
    if (!query) return;
    let items = userDb(req).all("interviews");
    if (query.q) items = items.filter((item) => matchesSearch(item, query.q));
    if (query.status) items = items.filter((item) => item.status === query.status);
    if (query.company) items = items.filter((item) => item.companyName.toLowerCase().includes(query.company.toLowerCase()));
    if (query.from || query.to) {
      items = items.filter((item) => item.rounds.some((round) => {
        const date = round.dateTime.slice(0, 10);
        return (!query.from || date >= query.from) && (!query.to || date <= query.to);
      }));
    }
    items.sort((a, b) => nextRoundTime(a) - nextRoundTime(b));
    res.json(paginate(items, query.page, query.limit));
  });
  app.get("/api/interviews/:id", (req, res) => {
    const item = userDb(req).get("interviews", req.params.id);
    if (!item) return failure(res, 404, "Interview was not found.");
    res.json(item);
  });
  app.post("/api/interviews", async (req, res, next) => {
    const parsed = interviewSchema.safeParse(req.body);
    if (!parsed.success) return failure(res, 400, parsed.error.issues[0]?.message ?? "Interview details are invalid.");
    const now = new Date().toISOString();
    const item = {
      ...parsed.data,
      id: parsed.data.id ?? randomUUID(),
      userId: req.auth.userId,
      createdAt: parsed.data.createdAt ?? now,
      updatedAt: now,
      rounds: parsed.data.rounds.map((round) => ({ ...round, id: round.id ?? randomUUID() })),
      questions: parsed.data.questions.map((question) => ({ ...question, id: question.id ?? randomUUID() })),
    };
    try {
      if (userDb(req).get("interviews", item.id)) return failure(res, 409, "An interview with this ID already exists.");
      await userDb(req).put("interviews", item);
      res.status(201).json(item);
    } catch (error) {
      if (error?.message === "Record not found.") return failure(res, 404, "Interview was not found.");
      next(error);
    }
  });
  app.put("/api/interviews/:id", updateInterview);
  app.patch("/api/interviews/:id", updateInterview);
  async function updateInterview(req, res, next) {
    const existing = userDb(req).get("interviews", req.params.id);
    if (!existing) return failure(res, 404, "Interview was not found.");
    const parsed = interviewSchema.safeParse({ ...existing, ...req.body, id: existing.id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() });
    if (!parsed.success) return failure(res, 400, parsed.error.issues[0]?.message ?? "Interview details are invalid.");
    const item = {
      ...parsed.data,
      id: existing.id,
      userId: req.auth.userId,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
      rounds: parsed.data.rounds.map((round) => ({ ...round, id: round.id ?? randomUUID() })),
      questions: parsed.data.questions.map((question) => ({ ...question, id: question.id ?? randomUUID() })),
    };
    try {
      await userDb(req).put("interviews", item);
      res.json(item);
    } catch (error) {
      if (error?.message === "Record not found.") return failure(res, 404, "Interview was not found.");
      next(error);
    }
  }
  app.delete("/api/interviews/:id", async (req, res, next) => {
    const item = userDb(req).get("interviews", req.params.id);
    if (!item) return failure(res, 404, "Interview was not found.");
    try {
      await userDb(req).remove("interviews", item.id);
      res.status(204).end();
    } catch (error) { next(error); }
  });

  app.get("/api/study-items", (req, res) => {
    const query = parsePage(req, res);
    if (!query) return;
    let items = userDb(req).all("study_items");
    if (query.q) items = items.filter((item) => matchesSearch(item, query.q));
    if (query.topic) items = items.filter((item) => item.topic.toLowerCase() === query.topic.toLowerCase());
    if (query.difficulty) items = items.filter((item) => item.difficulty === query.difficulty);
    if (query.confidence) items = items.filter((item) => item.confidence === query.confidence);
    if (query.bookmarked) items = items.filter((item) => item.bookmarked === (query.bookmarked === "true"));
    items.sort((a, b) => a.topic.localeCompare(b.topic) || a.question.localeCompare(b.question));
    res.json(paginate(items, query.page, query.limit));
  });
  app.get("/api/study-items/:id", (req, res) => {
    const item = userDb(req).get("study_items", req.params.id);
    if (!item) return failure(res, 404, "Study item was not found.");
    const companies = userDb(req).all("interviews")
      .filter((interview) => interview.questions.some((question) => question.studyItemId === item.id))
      .map((interview) => interview.companyName);
    res.json({ ...item, sourceCompanies: [...new Set([...(item.sourceCompanies ?? []), ...companies])] });
  });
  app.post("/api/study-items", async (req, res, next) => {
    const parsed = studyItemSchema.safeParse(req.body);
    if (!parsed.success) return failure(res, 400, parsed.error.issues[0]?.message ?? "Study item details are invalid.");
    const now = new Date().toISOString();
    const item = { ...parsed.data, id: parsed.data.id ?? randomUUID(), userId: req.auth.userId, createdAt: parsed.data.createdAt ?? now, updatedAt: now };
    try {
      if (userDb(req).get("study_items", item.id)) return failure(res, 409, "A study item with this ID already exists.");
      await userDb(req).put("study_items", item);
      res.status(201).json(item);
    } catch (error) {
      if (error?.message === "Record not found.") return failure(res, 404, "Study item was not found.");
      next(error);
    }
  });
  app.put("/api/study-items/:id", updateStudyItem);
  app.patch("/api/study-items/:id", updateStudyItem);
  async function updateStudyItem(req, res, next) {
    const existing = userDb(req).get("study_items", req.params.id);
    if (!existing) return failure(res, 404, "Study item was not found.");
    const parsed = studyItemSchema.safeParse({ ...existing, ...req.body, id: existing.id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() });
    if (!parsed.success) return failure(res, 400, parsed.error.issues[0]?.message ?? "Study item details are invalid.");
    const item = { ...parsed.data, id: existing.id, userId: req.auth.userId, createdAt: existing.createdAt, updatedAt: new Date().toISOString() };
    try {
      if (existing.diagram?.type === "image" && existing.diagram.content !== item.diagram?.content) await removeDiagramFile(existing.diagram, uploadsDirectory, req.auth.userId);
      await userDb(req).put("study_items", item);
      res.json(item);
    } catch (error) {
      if (error?.message === "Record not found.") return failure(res, 404, "Study item was not found.");
      next(error);
    }
  }
  app.delete("/api/study-items/:id", async (req, res, next) => {
    const item = userDb(req).get("study_items", req.params.id);
    if (!item) return failure(res, 404, "Study item was not found.");
    try {
      await removeDiagramFile(item.diagram, uploadsDirectory, req.auth.userId);
      await userDb(req).remove("study_items", item.id);
      const interviews = userDb(req).all("interviews").map((interview) => ({
        ...interview,
        questions: interview.questions.map((question) => question.studyItemId === item.id
          ? { ...question, studyItemId: "" }
          : question),
      }));
      for (const interview of interviews.filter((entry) => userDb(req).get("interviews", entry.id)?.questions.some((question) => question.studyItemId === item.id))) {
        await userDb(req).put("interviews", { ...interview, updatedAt: new Date().toISOString() });
      }
      res.status(204).end();
    } catch (error) { next(error); }
  });

  app.post("/api/study-items/diagrams", (req, res, next) => {
    upload.single("diagram")(req, res, async (error) => {
      if (error) return failure(res, 400, error.code === "LIMIT_FILE_SIZE" ? "Diagram image must be 2 MB or smaller." : error.message);
      if (!req.file) return failure(res, 400, "Choose a PNG, JPG, or SVG diagram image.");
      const extension = path.extname(req.file.filename).toLowerCase();
      const bytes = await (await import("node:fs/promises")).readFile(req.file.path);
      if ((extension === ".png" && !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        || [".jpg", ".jpeg"].includes(extension) && !(bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255))) {
        await unlink(req.file.path).catch(() => {});
        return failure(res, 400, "The file contents do not match the selected image type.");
      }
      if (extension === ".svg") {
        try {
          const contents = bytes.toString("utf8");
          const sanitized = sanitizeHtml(contents, {
            allowedTags: ["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "defs", "marker", "title", "desc", "linearGradient", "stop"],
            allowedAttributes: {
              "*": ["id", "class", "x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry", "width", "height", "viewBox", "fill", "stroke", "stroke-width", "d", "points", "transform", "opacity", "offset", "stop-color", "xmlns", "font-size", "text-anchor", "marker-end"],
            },
            allowedSchemes: [],
          });
          if (!sanitized.includes("<svg")) throw new Error("SVG image could not be sanitized.");
          await (await import("node:fs/promises")).writeFile(req.file.path, sanitized, "utf8");
        } catch {
          await unlink(req.file.path).catch(() => {});
          return failure(res, 400, "SVG diagram is invalid or contains unsafe markup.");
        }
      }
      res.status(201).json({ type: "image", content: `/api/study-items/diagrams/${req.file.filename}` });
    });
  });

  app.get("/api/study-items/diagrams/:filename", (req, res, next) => {
    if (!/^[a-zA-Z0-9_-]+\.(?:png|jpe?g|svg)$/i.test(req.params.filename)) return failure(res, 404, "Diagram was not found.");
    const content = `/api/study-items/diagrams/${req.params.filename}`;
    const ownsFile = userDb(req).all("study_items").some((item) => item.diagram?.type === "image" && item.diagram.content === content);
    if (!ownsFile) return failure(res, 404, "Diagram was not found.");
    res.set({ "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" });
    res.sendFile(path.join(uploadsDirectory, req.auth.userId, req.params.filename), (error) => { if (error) next(error); });
  });

  app.get("/api/data/export", (_req, res) => {
    res.json({ exportedAt: new Date().toISOString(), interviews: userDb(_req).all("interviews"), studyItems: userDb(_req).all("study_items") });
  });
  app.delete("/api/data", async (req, res, next) => {
    try {
      await userDb(req).clear();
      await rm(path.join(uploadsDirectory, req.auth.userId), { recursive: true, force: true });
      res.status(204).end();
    } catch (error) { next(error); }
  });
}

function nextRoundTime(interview) {
  const future = interview.rounds.map((round) => Date.parse(round.dateTime)).filter((time) => Number.isFinite(time));
  return future.length ? Math.min(...future) : Number.MAX_SAFE_INTEGER;
}
