export type JobStatus = "saved" | "applied" | "interviewing" | "offer" | "rejected";
export type ExperienceLevel = "Fresher" | "Mid" | "Senior" | "Lead";

export interface JobApplyOption {
  name: string;
  link: string;
}

export interface JobHighlight {
  qualifications: string[];
  responsibilities: string[];
  benefits: string[];
}

export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  source: string;
  postedAt: string | null;
  jobType: string | null;
  remote: boolean;
  salary: string | null;
  description: string;
  highlights: JobHighlight;
  applyOptions: JobApplyOption[];
  experienceMatch: string;
  experienceYears: number | null;
}

export interface JobSearchFilters {
  skills: string[];
  experienceMode: "years" | "level";
  years: number;
  level: ExperienceLevel;
  location: string;
  remote: boolean;
  postedWithin: "any" | "24h" | "3days" | "week" | "month";
  jobType: "any" | "full-time" | "contract";
  sort: "relevance" | "newest";
}

export interface JobSearchResponse {
  jobs: Job[];
  nextPageToken: string | null;
  searchesUsed: number | null;
  source: "serpapi" | "mock";
}

export interface ApplicationRecord {
  userId?: string;
  job: Job;
  status: JobStatus;
  savedAt: string;
  appliedAt: string | null;
  notes: string;
  updatedAt: string;
}
