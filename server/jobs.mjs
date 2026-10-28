import "dotenv/config";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CACHE_TTL_MS = 45 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12_000;
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;
const cache = new Map();
const requestWindows = new Map();
const mockPayload = JSON.parse(readFileSync(fileURLToPath(new URL("../src/jobs/mock-serpapi.json", import.meta.url)), "utf8"));

const querySchema = z.object({
  skills: z.string().max(500).default(""),
  experienceMode: z.enum(["years", "level"]).default("years"),
  years: z.coerce.number().int().min(0).max(30).default(0),
  level: z.enum(["Fresher", "Mid", "Senior", "Lead"]).default("Mid"),
  location: z.string().trim().max(150).default(""),
  remote: z.enum(["true", "false"]).default("false"),
  postedWithin: z.enum(["any", "24h", "3days", "week", "month"]).default("any"),
  jobType: z.enum(["any", "full-time", "contract"]).default("any"),
  sort: z.enum(["relevance", "newest"]).default("relevance"),
  pageToken: z.string().max(1000).optional(),
  mock: z.enum(["true", "false"]).default("false"),
}).strict();

function parseExperience(description = "") {
  const patterns = [
    /(\d{1,2})\s*\+\s*(?:years?|yrs?)\s+(?:of\s+)?experience/i,
    /(?:minimum|min\.?|at least)\s+(\d{1,2})\s*(?:years?|yrs?)/i,
    /(\d{1,2})\s*(?:-|to)\s*\d{1,2}\s*(?:years?|yrs?)\s+(?:of\s+)?experience/i,
    /(\d{1,2})\s*(?:years?|yrs?)\s+(?:of\s+)?experience/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(description);
    if (match) return Number(match[1]);
  }
  return null;
}

function normalizeJob(raw, targetYears = 0) {
  const extensions = Array.isArray(raw.extensions) ? raw.extensions.filter((item) => typeof item === "string") : [];
  const detected = raw.detected_extensions && typeof raw.detected_extensions === "object" ? raw.detected_extensions : {};
  const highlights = { qualifications: [], responsibilities: [], benefits: [] };
  for (const section of raw.job_highlights ?? []) {
    if (!section || typeof section !== "object") continue;
    const title = String(section.title ?? "").toLowerCase();
    const items = Array.isArray(section.items) ? section.items.filter((item) => typeof item === "string") : [];
    if (title.includes("qualif") || title.includes("require")) highlights.qualifications.push(...items);
    else if (title.includes("respons")) highlights.responsibilities.push(...items);
    else if (title.includes("benefit")) highlights.benefits.push(...items);
  }
  const description = String(raw.description ?? "");
  const experienceYears = parseExperience(description);
  const applyOptions = Array.isArray(raw.apply_options)
    ? raw.apply_options.flatMap((option) => {
      if (!option || typeof option !== "object") return [];
      const link = String(option.link ?? option.url ?? "");
      if (!/^https?:\/\//i.test(link)) return [];
      return [{ name: String(option.title ?? option.name ?? option.publisher ?? "Apply"), link }];
    })
    : [];
  return {
    id: String(raw.job_id ?? raw.id ?? raw.share_link ?? raw.link ?? `${raw.title ?? "job"}-${raw.company_name ?? ""}-${raw.location ?? ""}`),
    title: String(raw.title ?? "Untitled role"),
    company: String(raw.company_name ?? raw.company ?? ""),
    location: String(raw.location ?? ""),
    source: String(raw.via ?? raw.source ?? ""),
    postedAt: String(detected.posted_at ?? raw.posted_at ?? "") || null,
    jobType: String(detected.schedule_type ?? raw.job_type ?? raw.employment_type ?? extensions.find((item) => /full.time|contract|part.time/i.test(item)) ?? "") || null,
    remote: Boolean(detected.work_from_home ?? raw.remote) || /remote|work from home/i.test(`${raw.location ?? ""} ${extensions.join(" ")}`),
    salary: String(detected.salary ?? raw.salary ?? "") || null,
    description,
    highlights,
    applyOptions,
    experienceMatch: experienceYears === null
      ? "Experience not stated"
      : experienceYears <= targetYears
        ? `Matches ${targetYears}+ years`
        : `Requires ${experienceYears}+ years`,
    experienceYears,
  };
}

function experienceTarget(query) {
  return query.experienceMode === "years"
    ? query.years
    : ({ Fresher: 0, Mid: 3, Senior: 5, Lead: 8 })[query.level];
}

function rankByExperience(jobs, target) {
  return [...jobs].sort((a, b) => {
    const rank = (job) => job.experienceYears === null ? 1 : job.experienceYears <= target ? 0 : 2;
    return rank(a) - rank(b)
      || (a.experienceYears === null ? 99 : Math.abs(a.experienceYears - target))
        - (b.experienceYears === null ? 99 : Math.abs(b.experienceYears - target));
  });
}

function rateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const window = requestWindows.get(key);
  if (!window || window.resetAt <= now) {
    requestWindows.set(key, { count: 1, resetAt: now + WINDOW_MS });
    next();
    return;
  }
  if (window.count >= MAX_REQUESTS_PER_WINDOW) {
    res.status(429).json({ error: "Search rate limit reached. Wait a minute before trying again." });
    return;
  }
  window.count += 1;
  next();
}

function chips(query) {
  const values = [];
  const posted = { "24h": "today", "3days": "3days", week: "week", month: "month" }[query.postedWithin];
  if (posted) values.push(`date_posted:${posted}`);
  if (query.jobType === "full-time") values.push("employment_type:FULLTIME");
  if (query.jobType === "contract") values.push("employment_type:CONTRACTOR");
  if (query.remote === "true") values.push("work_from_home:1");
  return values.length ? values.join(",") : undefined;
}

function sendPayload(res, payload, source, target, searchesUsed = null) {
  const rawJobs = payload.jobs_results ?? [];
  if (!Array.isArray(rawJobs)) {
    res.status(502).json({ error: "SerpApi returned an unexpected job result format. Please retry." });
    return;
  }
  const jobs = rankByExperience(rawJobs.map((job) => normalizeJob(job, target)), target);
  res.json({
    jobs,
    nextPageToken: payload.serpapi_pagination?.next_page_token ?? payload.next_page_token ?? null,
    searchesUsed: searchesUsed !== null && searchesUsed !== undefined && Number.isFinite(Number(searchesUsed))
      ? Number(searchesUsed)
      : null,
    source,
  });
}

function registerJobRoutes(app) {
app.get("/api/jobs/search", rateLimit, async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Search filters are invalid. Check the location, experience, and filter values." });
    return;
  }
  const query = parsed.data;
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  for (const [key, window] of requestWindows) {
    if (window.resetAt <= now) requestWindows.delete(key);
  }
  const skills = query.skills.split(",").map((skill) => skill.trim()).filter(Boolean);
  const experience = query.experienceMode === "years" ? `${query.years} years` : query.level;
  const q = `${skills.join(" ")} ${experience} jobs`.trim();
  const target = experienceTarget(query);
  const cacheKey = JSON.stringify({ ...query, skills, pageToken: query.pageToken ?? "" });
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    res.set("X-Search-Cache", "HIT");
    sendPayload(res, cached.payload, cached.source, target, cached.searchesUsed);
    return;
  }

  const apiKey = process.env.SERPAPI_KEY;
  const useMock = query.mock === "true"
    || process.env.JOBS_MOCK === "true"
    || (!apiKey && process.env.NODE_ENV !== "production");
  if (useMock) {
    cache.set(cacheKey, { payload: mockPayload, source: "mock", searchesUsed: mockPayload.search_metadata.searches_used, expiresAt: Date.now() + CACHE_TTL_MS });
    res.set("X-Search-Cache", "MISS");
    sendPayload(res, mockPayload, "mock", target, mockPayload.search_metadata.searches_used);
    return;
  }
  if (!apiKey) {
    res.status(503).json({ error: "Job search is not configured. Set SERPAPI_KEY in the backend .env file." });
    return;
  }

  const params = new URLSearchParams({ engine: "google_jobs", q, api_key: apiKey });
  if (query.location) params.set("location", query.location);
  if (query.pageToken) params.set("next_page_token", query.pageToken);
  const searchChips = chips(query);
  if (searchChips) params.set("chips", searchChips);
  let upstream;
  try {
    upstream = await fetch(`https://serpapi.com/search.json?${params}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    res.status(502).json({ error: "Could not reach SerpApi. Check the server connection and retry." });
    return;
  }
  let payload;
  try {
    payload = await upstream.json();
  } catch {
    res.status(502).json({ error: "SerpApi returned an unreadable response. Please retry." });
    return;
  }
  if (!upstream.ok || payload.error) {
    const providerError = String(payload.error ?? "");
    if (upstream.status === 401 || upstream.status === 403 || /invalid.*(api|key)|api key/i.test(providerError)) {
      res.status(502).json({ error: "SerpApi rejected the server API key. Check SERPAPI_KEY in .env." });
    } else if (upstream.status === 429 || /quota|limit.*exceed|out of searches/i.test(providerError)) {
      res.status(429).json({ error: "SerpApi search quota is exhausted. Check your SerpApi plan and try later." });
    } else {
      res.status(502).json({ error: "SerpApi could not complete this job search. Please retry." });
    }
    return;
  }
  const results = Array.isArray(payload.jobs_results) ? payload.jobs_results : [];
  const searchesUsed = payload.search_metadata?.searches_used
    ?? payload.account_info?.searches_used
    ?? payload.searches_used
    ?? null;
  if (results.length === 0) {
    res.status(200).json({
      jobs: [],
      nextPageToken: null,
      searchesUsed: searchesUsed !== null && searchesUsed !== undefined && Number.isFinite(Number(searchesUsed))
        ? Number(searchesUsed)
        : null,
      source: "serpapi",
      message: "No jobs matched this search. Try broadening your skills or location.",
    });
    return;
  }
  cache.set(cacheKey, { payload, source: "serpapi", searchesUsed, expiresAt: Date.now() + CACHE_TTL_MS });
  res.set("X-Search-Cache", "MISS");
  sendPayload(res, payload, "serpapi", target, searchesUsed);
});
}

export { registerJobRoutes, normalizeJob, parseExperience };
