import type { Job, JobHighlight, JobSearchFilters } from "./types";

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstString(...values: unknown[]): string {
  return values.map(text).find(Boolean) ?? "";
}

function extractHighlights(value: unknown): JobHighlight {
  const result: JobHighlight = { qualifications: [], responsibilities: [], benefits: [] };
  if (!Array.isArray(value)) return result;
  for (const section of value) {
    if (!section || typeof section !== "object") continue;
    const item = section as Record<string, unknown>;
    const category = text(item.title ?? item.name).toLowerCase();
    const bullets = strings(item.items ?? item.bullets);
    if (category.includes("qualif") || category.includes("require")) result.qualifications.push(...bullets);
    else if (category.includes("respons")) result.responsibilities.push(...bullets);
    else if (category.includes("benefit")) result.benefits.push(...bullets);
  }
  return result;
}

export function parseExperience(description: string): number | null {
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

export function skillMatchScore(job: Job, skills: string[]): number {
  const content = [
    job.title,
    job.company,
    job.description,
    ...job.highlights.qualifications,
    ...job.highlights.responsibilities,
    ...job.highlights.benefits,
  ].join(" ").toLowerCase();
  const uniqueSkills = [...new Set(skills.map((skill) => skill.trim().toLowerCase()).filter(Boolean))];
  if (!uniqueSkills.length) return 0;
  const matches = uniqueSkills.filter((skill) => content.includes(skill)).length;
  return Math.round(matches * 100 / uniqueSkills.length);
}

export function normaliseJob(raw: unknown): Job {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const detected = source.detected_extensions && typeof source.detected_extensions === "object"
    ? source.detected_extensions as Record<string, unknown>
    : {};
  const extensions = strings(source.extensions);
  const rawApplyOptions = source.apply_options ?? source.applyOptions;
  const applyOptions = Array.isArray(rawApplyOptions)
    ? rawApplyOptions.flatMap((option): Job["applyOptions"] => {
      if (!option || typeof option !== "object") return [];
      const item = option as Record<string, unknown>;
      const link = firstString(item.link, item.url);
      if (!link || !/^https?:\/\//i.test(link)) return [];
      return [{ name: firstString(item.title, item.name, item.publisher) || "Apply", link }];
    })
    : [];
  const description = firstString(source.description, source.snippet);
  const experienceYears = source.experienceYears === null || typeof source.experienceYears === "number"
    ? source.experienceYears
    : parseExperience(description);
  const sourceRemote = source.remote === true || source.remote === "true";
  const rawHighlights = source.job_highlights ?? source.highlights;
  const highlights = rawHighlights && !Array.isArray(rawHighlights) && typeof rawHighlights === "object"
    ? rawHighlights as JobHighlight
    : extractHighlights(rawHighlights);
  const posted = firstString(detected.posted_at, source.posted_at, source.postedAt);
  const jobType = firstString(detected.schedule_type, source.job_type, source.jobType, source.employment_type)
    || extensions.find((value) => /full.time|contract|part.time/i.test(value))
    || null;
  const remote = Boolean(detected.work_from_home ?? source.remote)
    || /remote|work from home/i.test(`${firstString(source.location)} ${extensions.join(" ")}`);

  return {
    id: firstString(source.job_id, source.id, source.share_link, source.link)
      || `${firstString(source.title)}-${firstString(source.company_name, source.company)}-${firstString(source.location)}`,
    title: firstString(source.title) || "Untitled role",
    company: firstString(source.company_name, source.company),
    location: firstString(source.location),
    source: firstString(source.via, source.source),
    postedAt: posted || null,
    jobType,
    remote: remote || sourceRemote,
    salary: firstString(detected.salary, source.salary) || null,
    description,
    highlights,
    applyOptions,
    experienceMatch: firstString(source.experienceMatch)
      || (experienceYears === null ? "Experience not stated" : `Matches ${experienceYears}+ years`),
    experienceYears,
  };
}

export function buildJobQuery(filters: JobSearchFilters): string {
  const skills = filters.skills.map((skill) => skill.trim()).filter(Boolean).join(" ");
  const experience = filters.experienceMode === "years" ? `${filters.years} years` : filters.level;
  return `${skills} ${experience} jobs`.trim();
}

export function getMatchedSkills(job: Job, skills: string[]): string[] {
  const content = `${job.title} ${job.description} ${job.highlights.qualifications.join(" ")} ${job.highlights.responsibilities.join(" ")}`.toLowerCase();
  return [...new Set(skills)].filter((skill) => skill.trim() && content.includes(skill.trim().toLowerCase()));
}

export function toSearchParams(filters: JobSearchFilters, pageToken?: string | null): URLSearchParams {
  const params = new URLSearchParams({
    skills: filters.skills.join(","),
    experienceMode: filters.experienceMode,
    years: String(filters.years),
    level: filters.level,
    location: filters.location,
    remote: String(filters.remote),
    postedWithin: filters.postedWithin,
    jobType: filters.jobType,
    sort: filters.sort,
  });
  if (pageToken) params.set("pageToken", pageToken);
  return params;
}
