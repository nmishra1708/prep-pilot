import { useMemo, useState } from "react";
import { useApplications } from "./hooks/useApplications";
import { useJobSearch } from "./hooks/useJobSearch";
import { getMatchedSkills, skillMatchScore } from "./jobs/search";
import { useAuth } from "./auth/context";
import type {
  ApplicationRecord,
  ExperienceLevel,
  Job,
  JobSearchFilters,
  JobStatus,
} from "./jobs/types";

type Page = "search" | "applications";
const SEARCH_KEY = "say-it-last-job-search";
const PROFILE_SKILLS_KEY = "say-it-profile-skills";
const DEFAULT_SKILLS = ["Node.js", "React", "MongoDB", "LangChain"];
const statuses: JobStatus[] = ["saved", "applied", "interviewing", "offer", "rejected"];
const defaultFilters: JobSearchFilters = {
  skills: ["Node.js", "React"],
  experienceMode: "years",
  years: 5,
  level: "Senior",
  location: "Indore, India",
  remote: false,
  postedWithin: "any",
  jobType: "any",
  sort: "relevance",
};

function readJSON<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return fallback;
    const parsed: unknown = JSON.parse(stored);
    if (Array.isArray(fallback)) return (Array.isArray(parsed) ? parsed : fallback) as T;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ...fallback, ...parsed } as T;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function asDateInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function displayDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function dateToIso(date: string): string | null {
  if (!date) return null;
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function HighlightedText({ text, skills }: { text: string; skills: string[] }) {
  const terms = skills.map((skill) => skill.trim()).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!terms.length) return <>{text}</>;
  const expression = new RegExp(`(${terms.map((skill) => skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return <>{text.split(expression).map((part, index) =>
    terms.some((term) => term.toLowerCase() === part.toLowerCase())
      ? <mark key={`${part}-${index}`}>{part}</mark>
      : part,
  )}</>;
}

function JobCard({
  job,
  skills,
  application,
  selected,
  onSelect,
  onSave,
  onApplyOpened,
}: {
  job: Job;
  skills: string[];
  application: ApplicationRecord | undefined;
  selected: boolean;
  onSelect: () => void;
  onSave: () => void;
  onApplyOpened: () => void;
}) {
  const matched = getMatchedSkills(job, skills);
  const [expanded, setExpanded] = useState(false);
  return (
    <article className={`job-card${selected ? " job-card-selected" : ""}`}>
      <button className="job-card-main" type="button" onClick={onSelect} aria-label={`View ${job.title} at ${job.company}`}>
        <span className="job-card-title">{job.title}</span>
        <span className="job-card-company">{job.company}</span>
        <span className="job-card-meta">{job.location}{job.postedAt ? ` · ${job.postedAt}` : ""}{job.source ? ` · ${job.source}` : ""}</span>
      </button>
      <div className="job-badges">
        {job.remote && <span className="job-badge remote-badge">Remote</span>}
        {job.jobType && <span className="job-badge">{job.jobType}</span>}
        {job.experienceMatch === "Experience not stated"
          ? <span className="job-badge muted-badge">{job.experienceMatch}</span>
          : <span className="job-badge experience-badge">{job.experienceMatch}</span>}
        {application?.status === "applied" && <span className="job-badge applied-badge">Applied {displayDate(application.appliedAt)}</span>}
        {application && application.status !== "applied" && <span className="job-badge">{application.status}</span>}
        <span className="job-badge match-badge">{skillMatchScore(job, skills)}% skill match</span>
      </div>
      {matched.length > 0 && <div className="matched-skills" aria-label="Matched skills">{matched.map((skill) => <span key={skill}>{skill}</span>)}</div>}
      <p className="job-description">
        <HighlightedText text={expanded ? job.description : `${job.description.slice(0, 210)}${job.description.length > 210 ? "…" : ""}`} skills={skills} />
        {job.description.length > 210 && <button className="text-button" type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? " Show less" : " Show more"}</button>}
      </p>
      {job.salary && <p className="job-salary">{job.salary}</p>}
      <div className="job-card-actions">
        {job.applyOptions[0] && (
          <a className="button button-primary job-apply-link" href={job.applyOptions[0].link} target="_blank" rel="noopener noreferrer" onClick={onApplyOpened}>
            Apply <span className="sr-only">at {job.applyOptions[0].name} (opens in a new tab)</span>
          </a>
        )}
        <button className="button button-outline" type="button" onClick={onSave}>{application ? "View tracker" : "Save for later"}</button>
      </div>
    </article>
  );
}

function JobDetails({
  job,
  application,
  skills,
  onStatus,
  onAppliedDate,
  onNotes,
  onApplyOpened,
  applyOpened,
}: {
  job: Job;
  application: ApplicationRecord | undefined;
  skills: string[];
  onStatus: (status: JobStatus) => void;
  onAppliedDate: (date: string) => void;
  onNotes: (notes: string) => void;
  onApplyOpened: () => void;
  applyOpened: boolean;
}) {
  const [editingDate, setEditingDate] = useState(false);
  const [appliedDate, setAppliedDate] = useState(asDateInput(application?.appliedAt ?? null) || asDateInput(new Date().toISOString()));
  const primary = job.applyOptions[0];
  return (
    <aside className="job-detail-panel" aria-label={`Details for ${job.title}`}>
      <div className="detail-heading">
        <p className="interview-eyebrow">JOB DETAILS</p>
        <h2>{job.title}</h2>
        <p>{job.company} · {job.location}</p>
      </div>
      <div className="detail-badges">
        {job.remote && <span className="job-badge remote-badge">Remote</span>}
        {job.experienceMatch && <span className="job-badge experience-badge">{job.experienceMatch}</span>}
        <span className="job-badge match-badge">{skillMatchScore(job, skills)}% skill match</span>
      </div>
      {job.salary && <p><strong>Salary:</strong> {job.salary}</p>}
      <h3>About the role</h3>
      <p className="detail-description"><HighlightedText text={job.description} skills={skills} /></p>
      {(Object.entries(job.highlights) as Array<[keyof Job["highlights"], string[]]>).map(([key, items]) => items.length > 0 && (
        <section key={key} className="detail-highlights">
          <h3>{key[0].toUpperCase() + key.slice(1)}</h3>
          <ul>{items.map((item) => <li key={item}><HighlightedText text={item} skills={skills} /></li>)}</ul>
        </section>
      ))}
      <h3>Apply options</h3>
      <div className="apply-options">
        {job.applyOptions.map((option) => (
          <a key={`${option.name}-${option.link}`} className="button button-outline" href={option.link} target="_blank" rel="noopener noreferrer" onClick={onApplyOpened}>
            Open {option.name}<span className="sr-only"> in a new tab</span>
          </a>
        ))}
        {!job.applyOptions.length && <span className="muted-copy">No application link was provided.</span>}
      </div>
      {primary && applyOpened && !application?.appliedAt && (
        <div className="mark-applied-area">
          <p>After returning from the employer site, mark this job as applied.</p>
          <button type="button" className="button button-primary" onClick={() => {
            onAppliedDate(appliedDate);
          }}>Mark as applied</button>
        </div>
      )}
      {application?.appliedAt && (
        <div className="applied-date-control">
          <span className="applied-badge-large">Applied on {displayDate(application.appliedAt)}</span>
          <button className="text-button" type="button" onClick={() => setEditingDate((value) => !value)}>Edit date</button>
          <button className="text-button undo-applied" type="button" onClick={() => onStatus("saved")}>Undo</button>
          {editingDate && (
            <label className="date-edit-label">Application date
              <input aria-label="Application date" type="date" value={appliedDate} onChange={(event) => {
                setAppliedDate(event.target.value);
                onAppliedDate(event.target.value);
              }} />
            </label>
          )}
        </div>
      )}
      <label className="application-status-label">Application status
        <select value={application?.status ?? "saved"} onChange={(event) => onStatus(event.target.value as JobStatus)} aria-label="Application status">
          {statuses.map((status) => <option value={status} key={status}>{status[0].toUpperCase() + status.slice(1)}</option>)}
        </select>
      </label>
      <label className="application-notes-label">Notes
        <textarea defaultValue={application?.notes ?? ""} key={`${job.id}-${application?.updatedAt}`} placeholder="Add a reminder or follow-up note…" onBlur={(event) => onNotes(event.target.value)} />
      </label>
    </aside>
  );
}

export default function JobSearchMode({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const searchKey = `${SEARCH_KEY}-${user?.id ?? "legacy"}`;
  const profileSkillsKey = `${PROFILE_SKILLS_KEY}-${user?.id ?? "legacy"}`;
  const searchApi = useJobSearch();
  const applicationApi = useApplications();
  const [page, setPage] = useState<Page>("search");
  const [filters, setFilters] = useState<JobSearchFilters>(() => readJSON(searchKey, defaultFilters));
  const [skills, setSkills] = useState<string[]>(() => readJSON(profileSkillsKey, DEFAULT_SKILLS));
  const [skillDraft, setSkillDraft] = useState("");
  const [profileDraft, setProfileDraft] = useState("");
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [clientSort, setClientSort] = useState<"relevance" | "newest" | "skill">("relevance");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [applyOpenedId, setApplyOpenedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<JobStatus | "all">("all");
  const [applicationSort, setApplicationSort] = useState<"newest" | "oldest">("newest");
  const [applicationSearch, setApplicationSearch] = useState("");
  const [saveAsDefault, setSaveAsDefault] = useState(true);

  const applicationsById = useMemo(
    () => new Map(applicationApi.applications.map((item) => [item.job.id, item])),
    [applicationApi.applications],
  );
  const selectedJob = searchApi.jobs.find((job) => job.id === selectedId) ?? null;
  const visibleJobs = useMemo(() => {
    let result = searchApi.jobs.filter((job) => !remoteOnly || job.remote);
    if (clientSort === "newest") result = [...result].sort((a, b) => postedRank(a.postedAt) - postedRank(b.postedAt));
    if (clientSort === "skill") result = [...result].sort((a, b) => skillMatchScore(b, filters.skills) - skillMatchScore(a, filters.skills));
    return result;
  }, [clientSort, filters.skills, remoteOnly, searchApi.jobs]);
  const visibleApplications = useMemo(() => {
    let records = applicationApi.applications.filter((item) => statusFilter === "all" || item.status === statusFilter);
    const query = applicationSearch.trim().toLowerCase();
    if (query) records = records.filter((item) => `${item.job.company} ${item.job.title} ${item.notes}`.toLowerCase().includes(query));
    return [...records].sort((a, b) => {
      const left = Date.parse(a.appliedAt ?? a.savedAt);
      const right = Date.parse(b.appliedAt ?? b.savedAt);
      return applicationSort === "newest" ? right - left : left - right;
    });
  }, [applicationApi.applications, applicationSearch, applicationSort, statusFilter]);

  function postedRank(value: string | null): number {
    if (!value) return Number.MAX_SAFE_INTEGER;
    const text = value.toLowerCase();
    const number = Number(text.match(/\d+/)?.[0] ?? 0);
    if (/hour/.test(text)) return number * 3600;
    if (/day/.test(text)) return number * 86400;
    if (/week/.test(text)) return number * 604800;
    if (/month/.test(text)) return number * 2592000;
    return Number.MAX_SAFE_INTEGER - 1;
  }

  const updateFilter = <K extends keyof JobSearchFilters>(key: K, value: JobSearchFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const addTags = (draft: string) => {
    const incoming = draft.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
    updateFilter("skills", [...new Set([...filters.skills, ...incoming])]);
    setSkillDraft("");
  };

  const searchJobs = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (saveAsDefault) {
      localStorage.setItem(searchKey, JSON.stringify(filters));
      localStorage.setItem(profileSkillsKey, JSON.stringify(skills));
    }
    setClientSort(filters.sort);
    await searchApi.search(filters);
    setSelectedId(null);
  };

  const updateJobStatus = async (job: Job, status: JobStatus) => {
    const current = applicationsById.get(job.id);
    let appliedAt = current?.appliedAt ?? null;
    if (status === "applied" && !appliedAt) appliedAt = new Date().toISOString();
    if (status === "saved") appliedAt = null;
    await applicationApi.upsert(job, status, { appliedAt });
  };

  const updateJobNotes = async (job: Job, notes: string) => {
    const current = applicationsById.get(job.id);
    await applicationApi.upsert(job, current?.status ?? "saved", { notes, appliedAt: current?.appliedAt ?? null });
  };

  const exportCsv = () => {
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const rows = [
      ["Company", "Title", "Date applied", "Status", "Location", "Link", "Notes"],
      ...visibleApplications.map((item) => [
        item.job.company, item.job.title, item.appliedAt ?? "", item.status,
        item.job.location, item.job.applyOptions[0]?.link ?? "", item.notes,
      ]),
    ];
    const csv = rows.map((row) => row.map(escape).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "my-applications.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Say it, see it home" onClick={(event) => { event.preventDefault(); onBack(); }}>
          <span className="brand-mark" aria-hidden="true">s.</span>
          <span>say it<span className="brand-dot">.</span> see it<span className="brand-dot">.</span></span>
        </a>
        <span className="topbar-note">Your next opportunity, thoughtfully tracked</span>
        <button type="button" className="button button-outline" onClick={onBack}>Back to dictation</button>
      </header>
      <section className="job-workspace" aria-labelledby="job-page-title">
        <header className="job-page-heading">
          <p className="eyebrow"><span className="eyebrow-line" /> A CALMER JOB SEARCH</p>
          <h1 id="job-page-title">{page === "search" ? <>Find your next<br /><em>good fit.</em></> : <>Keep your<br /><em>momentum.</em></>}</h1>
          <p className="intro-copy">Search, save, and keep each application in one quiet place.</p>
        </header>
        <nav className="job-tabs" aria-label="Job tracker pages">
          <button type="button" className={page === "search" ? "active" : ""} onClick={() => setPage("search")}>Find jobs</button>
          <button type="button" className={page === "applications" ? "active" : ""} onClick={() => setPage("applications")}>My Applications <span>{applicationApi.applications.length}</span></button>
        </nav>
        {applicationApi.error && <p className="job-error" role="alert">{applicationApi.error}</p>}

        {page === "search" ? (
          <>
            <form className="job-search-form" onSubmit={(event) => void searchJobs(event)}>
              <div className="job-form-grid">
                <fieldset className="skill-field">
                  <legend>Skills</legend>
                  <div className="skill-tags">
                    {filters.skills.map((skill) => (
                      <span className="skill-tag" key={skill}>{skill}
                        <button type="button" aria-label={`Remove ${skill}`} onClick={() => updateFilter("skills", filters.skills.filter((item) => item !== skill))}>×</button>
                      </span>
                    ))}
                    <input
                      aria-label="Add a skill"
                      list="profile-skill-suggestions"
                      value={skillDraft}
                      placeholder="Type a skill and press Enter"
                      onChange={(event) => setSkillDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === ",") {
                          event.preventDefault();
                          addTags(skillDraft);
                        }
                      }}
                      onBlur={() => { if (skillDraft.trim()) addTags(skillDraft); }}
                    />
                    <datalist id="profile-skill-suggestions">{skills.map((skill) => <option value={skill} key={skill} />)}</datalist>
                  </div>
                  <div className="profile-skills">
                    <label htmlFor="profile-skill-input">Profile skill suggestions</label>
                    <input id="profile-skill-input" value={profileDraft} placeholder="Add profile skill" onChange={(event) => setProfileDraft(event.target.value)} onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        const values = profileDraft.split(",").map((item) => item.trim()).filter(Boolean);
                        setSkills((current) => [...new Set([...current, ...values])]);
                        setProfileDraft("");
                      }
                    }} />
                    {skills.map((skill) => <button key={skill} type="button" className="profile-skill-chip" onClick={() => updateFilter("skills", [...new Set([...filters.skills, skill])])}>+ {skill}</button>)}
                  </div>
                </fieldset>
                <div className="experience-inputs">
                  <label>Experience type
                    <select value={filters.experienceMode} onChange={(event) => updateFilter("experienceMode", event.target.value as JobSearchFilters["experienceMode"])}>
                      <option value="years">Years</option><option value="level">Career level</option>
                    </select>
                  </label>
                  {filters.experienceMode === "years"
                    ? <label>Years of experience <input aria-label="Years of experience" type="number" min={0} max={30} value={filters.years} onChange={(event) => updateFilter("years", Math.min(30, Math.max(0, Number(event.target.value) || 0)))} /></label>
                    : <label>Career level <select value={filters.level} onChange={(event) => updateFilter("level", event.target.value as ExperienceLevel)}>{(["Fresher", "Mid", "Senior", "Lead"] as const).map((level) => <option key={level}>{level}</option>)}</select></label>}
                </div>
                <label>Location
                  <input value={filters.location} placeholder="e.g. Indore, India" onChange={(event) => updateFilter("location", event.target.value)} />
                </label>
                <label className="remote-checkbox"><input type="checkbox" checked={filters.remote} onChange={(event) => updateFilter("remote", event.target.checked)} /> Remote roles only</label>
                <label>Posted within
                  <select value={filters.postedWithin} onChange={(event) => updateFilter("postedWithin", event.target.value as JobSearchFilters["postedWithin"])}>
                    <option value="any">Any time</option><option value="24h">24 hours</option><option value="3days">3 days</option><option value="week">1 week</option><option value="month">1 month</option>
                  </select>
                </label>
                <label>Job type
                  <select value={filters.jobType} onChange={(event) => updateFilter("jobType", event.target.value as JobSearchFilters["jobType"])}>
                    <option value="any">Any type</option><option value="full-time">Full-time</option><option value="contract">Contract</option>
                  </select>
                </label>
                <label>Sort results
                  <select value={filters.sort} onChange={(event) => updateFilter("sort", event.target.value as JobSearchFilters["sort"])}>
                    <option value="relevance">Relevance</option><option value="newest">Newest</option>
                  </select>
                </label>
              </div>
              <div className="search-form-footer">
                <label className="save-default-check"><input type="checkbox" checked={saveAsDefault} onChange={(event) => setSaveAsDefault(event.target.checked)} /> Save this search as my default</label>
                <button type="submit" className="button button-primary" disabled={searchApi.loading || !filters.skills.length}>{searchApi.loading ? "Searching…" : "Search jobs"}</button>
              </div>
            </form>

            {searchApi.error && (
              <div className="job-error" role="alert"><p>{searchApi.error}</p><button className="button button-outline" type="button" onClick={() => void searchJobs()}>Retry search</button></div>
            )}
            {searchApi.source === "mock" && <p className="job-source-note">Showing bundled sample jobs for offline development.</p>}
            {searchApi.source === "serpapi" && <p className="job-source-note">Results from Google Jobs through SerpApi. Listings may be incomplete or expired.{searchApi.searchesUsed !== null ? ` Searches used: ${searchApi.searchesUsed}.` : ""}</p>}

            {searchApi.loading ? (
              <div className="job-results-layout" aria-label="Loading jobs">
                <div className="job-results-list">{Array.from({ length: 3 }, (_, index) => <div className="job-skeleton" key={index} />)}</div>
                <div className="job-detail-skeleton" />
              </div>
            ) : searchApi.jobs.length > 0 ? (
              <div className="job-results-layout">
                <section className="job-results-list" aria-label="Job search results">
                  <div className="results-toolbar">
                    <h2>{visibleJobs.length} role{visibleJobs.length === 1 ? "" : "s"}</h2>
                    <label className="remote-only-filter"><input type="checkbox" checked={remoteOnly} onChange={(event) => setRemoteOnly(event.target.checked)} /> Remote only</label>
                    <label className="client-sort-label">Sort
                      <select value={clientSort} onChange={(event) => setClientSort(event.target.value as typeof clientSort)}>
                        <option value="relevance">Relevance</option><option value="newest">Newest</option><option value="skill">Best skill match</option>
                      </select>
                    </label>
                  </div>
                  <p className="sr-only" aria-live="polite">{searchApi.statusMessage}</p>
                  {visibleJobs.map((job) => (
                    <JobCard
                      key={job.id}
                      job={job}
                      skills={filters.skills}
                      application={applicationsById.get(job.id)}
                      selected={selectedId === job.id}
                      onSelect={() => setSelectedId(job.id)}
                      onApplyOpened={() => {
                        setSelectedId(job.id);
                        setApplyOpenedId(job.id);
                      }}
                      onSave={() => {
                        setSelectedId(job.id);
                        if (!applicationsById.has(job.id)) void applicationApi.upsert(job, "saved");
                      }}
                    />
                  ))}
                  {searchApi.nextPageToken && (
                    <button className="button button-outline load-more-button" type="button" onClick={() => void searchApi.loadMore(filters)} disabled={searchApi.loadingMore}>
                      {searchApi.loadingMore ? "Loading…" : "Load more"}
                    </button>
                  )}
                  {!visibleJobs.length && <p className="empty-jobs">No roles match this filter. Turn off Remote only to see more results.</p>}
                </section>
                {selectedJob
                  ? <JobDetails
                    key={selectedJob.id}
                    job={selectedJob}
                    skills={filters.skills}
                    application={applicationsById.get(selectedJob.id)}
                    applyOpened={applyOpenedId === selectedJob.id}
                    onStatus={(status) => void updateJobStatus(selectedJob, status)}
                    onAppliedDate={(date) => {
                      const iso = dateToIso(date);
                      if (iso) void applicationApi.upsert(selectedJob, "applied", { appliedAt: iso });
                    }}
                    onNotes={(notes) => void updateJobNotes(selectedJob, notes)}
                    onApplyOpened={() => setApplyOpenedId(selectedJob.id)}
                  />
                  : <aside className="job-detail-placeholder">Choose a role to see details, rubrics, and application links.</aside>}
              </div>
            ) : !searchApi.error ? (
              <div className="job-empty-state"><span aria-hidden="true">✳</span><h2>A good next step starts with a search.</h2><p>Choose your skills and location, then search Google Jobs through SerpApi.</p></div>
            ) : null}
          </>
        ) : (
          <section className="applications-page">
            <div className="applications-toolbar">
              <label>Search applications<input value={applicationSearch} onChange={(event) => setApplicationSearch(event.target.value)} placeholder="Company, role, or note" /></label>
              <label>Status
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as JobStatus | "all")}>
                  <option value="all">All statuses</option>{statuses.map((status) => <option key={status} value={status}>{status[0].toUpperCase() + status.slice(1)}</option>)}
                </select>
              </label>
              <label>Sort by date
                <select value={applicationSort} onChange={(event) => setApplicationSort(event.target.value as typeof applicationSort)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select>
              </label>
              <button type="button" className="button button-outline" onClick={exportCsv} disabled={!visibleApplications.length}>Export CSV</button>
            </div>
            {applicationApi.loading ? <p>Loading saved applications…</p> : visibleApplications.length ? (
              <div className="applications-table-wrap">
                <table className="applications-table">
                  <caption className="sr-only">Saved and applied jobs</caption>
                  <thead><tr><th scope="col">Company</th><th scope="col">Title</th><th scope="col">Date applied</th><th scope="col">Status</th><th scope="col">Link</th><th scope="col">Actions</th></tr></thead>
                  <tbody>
                    {visibleApplications.map((item) => (
                      <ApplicationRow
                        key={item.job.id}
                        item={item}
                        onStatus={(status) => void updateJobStatus(item.job, status)}
                        onRemove={() => void applicationApi.remove(item.job.id)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="job-empty-state"><h2>No applications in this view.</h2><p>Save a role from search results, or adjust the status filter.</p></div>}
          </section>
        )}
        <aside className="job-disclaimer">Search results come from Google Jobs through SerpApi and may be incomplete or expired. Please verify the role and application details on the employer’s site. Search requests are cached by the backend for 45 minutes to reduce SerpApi quota usage.</aside>
      </section>
      <footer className="page-footer"><span>Your search and application notes stay in this browser.</span><span>Verify listings before applying</span></footer>
    </main>
  );
}

function ApplicationRow({
  item,
  onStatus,
  onRemove,
}: {
  item: ApplicationRecord;
  onStatus: (status: JobStatus) => void;
  onRemove: () => void;
}) {
  return (
    <tr>
      <td>{item.job.company}</td>
      <td>{item.job.title}<span className="application-location">{item.job.location}</span></td>
      <td>{displayDate(item.appliedAt ?? item.savedAt)}</td>
      <td>
        <select aria-label={`Status for ${item.job.title}`} value={item.status} onChange={(event) => onStatus(event.target.value as JobStatus)}>
          {statuses.map((status) => <option key={status} value={status}>{status[0].toUpperCase() + status.slice(1)}</option>)}
        </select>
      </td>
      <td>{item.job.applyOptions[0] && <a href={item.job.applyOptions[0].link} target="_blank" rel="noopener noreferrer">{item.job.applyOptions[0].name}</a>}</td>
      <td><button className="text-button" type="button" onClick={onRemove}>Remove</button></td>
    </tr>
  );
}
