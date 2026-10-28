import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useInterviews, useStudyItems } from "./hooks/useDataCollection";
import { ConfirmDialog, DiagramViewer, MarkdownEditor, MarkdownPreview, StatusBadge, TagInput } from "./features/interviewStudy/components";
import { interviewStatuses, newQuestion, newRound } from "./features/interviewStudy/types";
import { getCurrentUserId } from "./storage/userScope";
import { apiFetch } from "./auth/api";
import type { Interview, InterviewQuestion, InterviewRound, InterviewStatus, StudyItem } from "./features/interviewStudy/types";

type View = "interviews" | "study";
type InterviewDraft = Omit<Interview, "id" | "createdAt" | "updatedAt"> & { id?: string; createdAt?: string; updatedAt?: string };
type StudyDraft = Omit<StudyItem, "id" | "createdAt" | "updatedAt"> & { id?: string; createdAt?: string; updatedAt?: string };
const interviewDraftKey = () => `say-it-interview-draft-${getCurrentUserId() ?? "legacy"}`;
const studyDraftKey = () => `say-it-study-draft-${getCurrentUserId() ?? "legacy"}`;

const blankInterview = (): InterviewDraft => ({
  companyName: "", profile: "", rounds: [newRound()], status: "Scheduled",
  hr: { name: "", email: "", phone: "", linkedInUrl: "" }, jobLink: "", linkedApplicationId: "",
  questions: [], overallNotes: "", feedbackReceived: "", offerDetails: { ctc: "", joiningDate: "" },
});
const blankStudy = (): StudyDraft => ({
  topic: "", question: "", answer: "", diagram: null, tags: [], difficulty: "Medium",
  source: "own", sourceInterviewId: "", confidence: 3, lastReviewed: null,
  nextReviewAt: null, bookmarked: false, sourceCompanies: [],
});

function localDate(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
function isoDate(value: string) { return value ? new Date(value).toISOString() : ""; }
function niceDate(value: string) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not scheduled" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
function nextRound(interview: Interview) {
  const now = Date.now();
  return interview.rounds.map((round) => round.dateTime).filter((date) => Date.parse(date) >= now).sort()[0] ?? "";
}

export default function InterviewStudyMode({ onBack }: { onBack: () => void }) {
  const [view, setView] = useState<View>("interviews");
  const interviews = useInterviews();
  const studies = useStudyItems();
  const [interviewSearch, setInterviewSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [studySearch, setStudySearch] = useState("");
  const [topicFilter, setTopicFilter] = useState("");
  const [difficultyFilter, setDifficultyFilter] = useState("");
  const [confidenceFilter, setConfidenceFilter] = useState("");
  const [bookmarkedOnly, setBookmarkedOnly] = useState(false);
  const [selectedInterview, setSelectedInterview] = useState<Interview | null>(null);
  const [interviewDraft, setInterviewDraft] = useState<InterviewDraft | null>(null);
  const [studyDraft, setStudyDraft] = useState<StudyDraft | null>(null);
  const [selectedStudy, setSelectedStudy] = useState<StudyItem | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<{ type: View; id: string } | null>(null);
  const [undo, setUndo] = useState<{ type: View; record: Interview | StudyItem; linkedInterviews: Interview[]; until: number } | null>(null);
  const [flashcard, setFlashcard] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [practiceSeconds, setPracticeSeconds] = useState(0);
  const [practiceRunning, setPracticeRunning] = useState(false);
  const topics = useMemo(() => [...new Set(studies.items.map((item) => item.topic))].sort(), [studies.items]);

  useEffect(() => {
    if (!undo) return;
    const remaining = Math.max(0, undo.until - Date.now());
    const timeout = window.setTimeout(() => setUndo(null), remaining);
    return () => window.clearTimeout(timeout);
  }, [undo]);
  useEffect(() => {
    if (!practiceRunning) return;
    const interval = window.setInterval(() => setPracticeSeconds((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(interval);
  }, [practiceRunning]);
  useEffect(() => {
    if (!studyDraft || studyDraft.id) return;
    try { localStorage.setItem(studyDraftKey(), JSON.stringify(studyDraft)); } catch { /* local draft is optional */ }
  }, [studyDraft]);

  const filteredInterviews = useMemo(() => interviews.items
    .filter((item) => !statusFilter || item.status === statusFilter)
    .filter((item) => !companyFilter || item.companyName.toLowerCase().includes(companyFilter.toLowerCase()))
    .filter((item) => `${item.companyName} ${item.profile} ${item.overallNotes}`.toLowerCase().includes(interviewSearch.toLowerCase()))
    .filter((item) => (!dateFrom && !dateTo) || item.rounds.some((round) => {
      const date = round.dateTime.slice(0, 10);
      return (!dateFrom || date >= dateFrom) && (!dateTo || date <= dateTo);
    }))
    .sort((a, b) => Date.parse(nextRound(a) || "2999-01-01") - Date.parse(nextRound(b) || "2999-01-01")), [interviews.items, interviewSearch, statusFilter, companyFilter, dateFrom, dateTo]);
  const filteredStudy = useMemo(() => studies.items
    .filter((item) => !topicFilter || item.topic === topicFilter)
    .filter((item) => !difficultyFilter || item.difficulty === difficultyFilter)
    .filter((item) => !confidenceFilter || item.confidence === Number(confidenceFilter))
    .filter((item) => !bookmarkedOnly || item.bookmarked)
    .filter((item) => `${item.topic} ${item.question} ${item.answer} ${item.tags.join(" ")}`.toLowerCase().includes(studySearch.toLowerCase()))
    .sort((a, b) => a.topic.localeCompare(b.topic)), [studies.items, topicFilter, difficultyFilter, confidenceFilter, bookmarkedOnly, studySearch]);
  const groupedStudy = useMemo(() => filteredStudy.reduce((groups, item) => {
    groups.set(item.topic, [...(groups.get(item.topic) ?? []), item]);
    return groups;
  }, new Map<string, StudyItem[]>()), [filteredStudy]);
  const upcoming = interviews.items.flatMap((item) => item.rounds.map((round) => ({ interview: item, round })))
    .filter(({ round }) => Date.parse(round.dateTime) >= Date.now() && Date.parse(round.dateTime) <= Date.now() + 24 * 60 * 60 * 1000);
  const frequentTopics = useMemo(() => {
    const counts = new Map<string, number>();
    interviews.items.forEach((interview) => interview.questions.forEach((question) => counts.set(question.topic, (counts.get(question.topic) ?? 0) + 1)));
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3);
  }, [interviews.items]);
  const companySuccess = useMemo(() => {
    const companies = new Map<string, { total: number; selected: number }>();
    interviews.items.forEach((item) => {
      const current = companies.get(item.companyName) ?? { total: 0, selected: 0 };
      companies.set(item.companyName, { total: current.total + 1, selected: current.selected + Number(item.status === "Selected") });
    });
    return [...companies].map(([company, stats]) => `${company}: ${Math.round(stats.selected / stats.total * 100)}% (${stats.selected}/${stats.total})`).join(" · ");
  }, [interviews.items]);

  const openNewInterview = () => {
    try {
      const saved = localStorage.getItem(interviewDraftKey());
      setInterviewDraft(saved ? JSON.parse(saved) as InterviewDraft : blankInterview());
    } catch { setInterviewDraft(blankInterview()); }
    setSelectedInterview(null);
    setError("");
  };
  const editInterview = (item: Interview) => {
    setSelectedInterview(item);
    setInterviewDraft({ ...item });
    setError("");
  };
  const saveInterview = async (event: FormEvent) => {
    event.preventDefault();
    if (!interviewDraft) return;
    try {
      const saved = await interviews.save(interviewDraft);
      localStorage.removeItem(interviewDraftKey());
      setInterviewDraft(null);
      setSelectedInterview(saved);
      setMessage("Interview saved.");
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save interview."); }
  };
  const updateInterviewDraft = (update: Partial<InterviewDraft>) => {
    setInterviewDraft((current) => {
      if (!current) return current;
      const next = { ...current, ...update };
      try { localStorage.setItem(interviewDraftKey(), JSON.stringify(next)); } catch { /* local draft is optional */ }
      return next;
    });
  };

  const createStudyFromQuestion = async (interview: Interview, question: InterviewQuestion) => {
    try {
      const item = await studies.save({
        topic: question.topic, question: question.questionText, answer: question.myAnswer,
        diagram: null, tags: [], difficulty: "Medium", source: "company interview",
        sourceInterviewId: interview.id, confidence: 3, lastReviewed: null, nextReviewAt: null,
        bookmarked: false, sourceCompanies: [interview.companyName],
      });
      await interviews.save({
        ...interview,
        questions: interview.questions.map((entry) => entry.id === question.id ? { ...entry, studyItemId: item.id } : entry),
      });
      setSelectedInterview({ ...interview, questions: interview.questions.map((entry) => entry.id === question.id ? { ...entry, studyItemId: item.id } : entry) });
      setMessage("Question added to the Study Library.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add study item."); }
  };

  const deleteRecord = async () => {
    if (!confirmDelete) return;
    const { type, id } = confirmDelete;
    try {
      const record = type === "interviews" ? interviews.items.find((item) => item.id === id) : studies.items.find((item) => item.id === id);
      if (!record) return;
      if (type === "interviews") await interviews.remove(id);
      else await studies.remove(id);
      const linkedInterviews = type === "study"
        ? interviews.items.filter((interview) => interview.questions.some((question) => question.studyItemId === id))
        : [];
      setUndo({ type, record, linkedInterviews, until: Date.now() + 5000 });
      setSelectedInterview(null);
      setSelectedStudy(null);
      setConfirmDelete(null);
      setMessage("Deleted. Undo is available for five seconds.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete record."); }
  };
  const restoreDeleted = async () => {
    if (!undo || Date.now() > undo.until) return;
    try {
      if (undo.type === "interviews") await interviews.restore(undo.record as Interview);
      else {
        await studies.restore(undo.record as StudyItem);
        for (const interview of undo.linkedInterviews) await interviews.save(interview);
      }
      setMessage("Delete undone.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Undo failed."); }
    setUndo(null);
  };
  const saveStudy = async (event: FormEvent) => {
    event.preventDefault();
    if (!studyDraft) return;
    try {
      const saved = await studies.save(studyDraft);
      localStorage.removeItem(studyDraftKey());
      setStudyDraft(null);
      setSelectedStudy(saved);
      setError("");
      setMessage("Study item saved.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save study item."); }
  };
  const review = async (item: StudyItem, gotIt: boolean) => {
    const confidence = Math.max(1, Math.min(5, item.confidence + (gotIt ? 1 : -1)));
    const days = gotIt ? Math.min(30, 2 ** (confidence - 1)) : 1;
    try {
      await studies.save({ ...item, confidence, lastReviewed: new Date().toISOString(), nextReviewAt: new Date(Date.now() + days * 86_400_000).toISOString() });
      setRevealed(false);
      setFlashcard((index) => (index + 1) % Math.max(1, filteredStudy.length));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save review."); }
  };
  const uploadDiagram = async (file?: File) => {
    if (!file || !studyDraft) return;
    const body = new FormData();
    body.append("diagram", file);
    try {
      const response = await apiFetch("/api/study-items/diagrams", { method: "POST", body });
      const result = await response.json() as { type?: "image"; content?: string; error?: string };
      if (!response.ok || !result.content) throw new Error(result.error ?? "Diagram upload failed.");
      setStudyDraft({ ...studyDraft, diagram: { type: "image", content: result.content } });
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Diagram upload failed."); }
  };
  const exportData = async () => {
    try {
      const response = await apiFetch("/api/data/export");
      if (!response.ok) throw new Error("Export failed.");
      const data = await response.json() as { exportedAt: string; interviews: Interview[]; studyItems: StudyItem[] };
      const blob = new Blob([JSON.stringify({
        ...data,
        drafts: {
          interview: localStorage.getItem(interviewDraftKey()),
          studyItem: localStorage.getItem(studyDraftKey()),
        },
      }, null, 2)], { type: "application/json" });
      download(blob, "interview-study-data.json");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Export failed."); }
  };
  const importData = async (file?: File) => {
    if (!file) return;
    try {
      if (file.name.toLowerCase().endsWith(".md")) {
        const markdown = await file.text();
        const sections = markdown.split(/(?=^# )/m).filter((section) => section.startsWith("# "));
        for (const section of sections) {
          const [heading, ...rest] = section.split("\n");
          const topic = /^\*\*Topic:\*\*\s*([^·\n]+)/.exec(rest.join("\n"))?.[1]?.trim() ?? "Imported";
          const contentStart = rest.findIndex((line) => line.trim() === "");
          const answer = rest.slice(Math.max(contentStart + 1, 1)).join("\n").replace(/\n---\s*$/, "").trim();
          await studies.save({ ...blankStudy(), topic, question: heading.slice(2).trim(), answer });
        }
      } else {
        const parsed = JSON.parse(await file.text()) as { interviews?: Interview[]; studyItems?: StudyItem[] };
        if (!Array.isArray(parsed.interviews ?? []) || !Array.isArray(parsed.studyItems ?? [])) throw new Error("JSON must contain interview and studyItems arrays.");
        const interviewIdMap = new Map<string, string>();
        const studyItemIdMap = new Map<string, string>();
        const createdInterviews: Array<{ original: Interview; saved: Interview }> = [];
        for (const original of parsed.interviews ?? []) {
          const saved = await interviews.save({ ...original, id: undefined, createdAt: undefined, updatedAt: undefined });
          interviewIdMap.set(original.id, saved.id);
          createdInterviews.push({ original, saved });
        }
        for (const original of parsed.studyItems ?? []) {
          const saved = await studies.save({
            ...original,
            id: undefined,
            createdAt: undefined,
            updatedAt: undefined,
            sourceInterviewId: interviewIdMap.get(original.sourceInterviewId) ?? "",
          });
          studyItemIdMap.set(original.id, saved.id);
        }
        for (const { original, saved } of createdInterviews) {
          await interviews.save({
            ...saved,
            questions: saved.questions.map((question, index) => ({
              ...question,
              studyItemId: studyItemIdMap.get(original.questions[index]?.studyItemId ?? "") ?? "",
            })),
          });
        }
      }
      setMessage("Imported records.");
    } catch (reason) { setError(reason instanceof Error ? `Import failed: ${reason.message}` : "Import file was invalid."); }
  };
  const exportMarkdown = () => {
    const markdown = filteredStudy.map((item) => `# ${item.question}\n\n**Topic:** ${item.topic} · **Difficulty:** ${item.difficulty}\n\n${item.answer}\n\n${item.diagram?.type === "mermaid" ? `\`\`\`mermaid\n${item.diagram.content}\n\`\`\`\n` : item.diagram?.type === "image" ? `![Diagram](${item.diagram.content})\n` : ""}`).join("\n---\n\n");
    download(new Blob([markdown], { type: "text/markdown;charset=utf-8" }), "study-library.md");
  };
  const deleteAll = async () => {
    try {
      const response = await apiFetch("/api/data", { method: "DELETE" });
      if (!response.ok) throw new Error("Could not delete server records.");
      localStorage.removeItem(interviewDraftKey());
      localStorage.removeItem(studyDraftKey());
      await Promise.all([interviews.refresh(), studies.refresh()]);
      setMessage("All interview and study records were deleted.");
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Delete all failed."); }
  };

  const trouble = error || interviews.error || studies.error;
  return <main className="page-shell">
    <header className="topbar feature-topbar">
      <button className="button button-quiet" type="button" onClick={onBack}>← Back</button>
      <div><strong>Interview & Study</strong><span className="topbar-note">Your preparation workspace</span></div>
      <div className="feature-actions">
        <button className="button button-outline" type="button" onClick={() => void exportData()}>Export all data</button>
        <button className="button button-outline" type="button" onClick={() => window.confirm("Permanently delete all interview and study records?") && void deleteAll()}>Delete all my data</button>
      </div>
    </header>
    <section className="feature-workspace">
      <div className="feature-heading"><p className="eyebrow"><span className="eyebrow-line" /> PREPARE WITH PURPOSE</p><h1>Interview <em>tracker.</em></h1><p className="intro-copy">Keep every conversation, question and lesson in one private workspace.</p></div>
      <div className="feature-tabs" role="tablist" aria-label="Interview and study tools">
        <button className={view === "interviews" ? "active" : ""} type="button" role="tab" aria-selected={view === "interviews"} onClick={() => { setView("interviews"); setError(""); }}>Company interviews</button>
        <button className={view === "study" ? "active" : ""} type="button" role="tab" aria-selected={view === "study"} onClick={() => { setView("study"); setError(""); }}>Study library</button>
      </div>
      <div className="feature-message" role="status" aria-live="polite">{message || (trouble ? `Error: ${trouble}` : "")}</div>
      {undo && <div className="feature-banner" role="status">Record deleted. <button type="button" onClick={() => void restoreDeleted()}>Undo</button></div>}

      {view === "interviews" && <section>
        {upcoming.length > 0 && <aside className="feature-banner"><strong>Upcoming within 24 hours:</strong> {upcoming.map(({ interview, round }) => `${interview.companyName} — ${round.roundName}, ${niceDate(round.dateTime)}`).join(" · ")} <button type="button" onClick={() => downloadCalendar(upcoming.map(({ interview, round }) => ({ company: interview.companyName, title: round.roundName, date: round.dateTime, duration: round.duration })))}>Add to calendar (.ics)</button> <button type="button" onClick={() => void requestNotifications(upcoming.map(({ interview, round }) => ({ message: `${interview.companyName}: ${round.roundName}`, date: round.dateTime })))}>Schedule notifications</button></aside>}
        <div className="feature-stats"><span><strong>{interviews.items.length}</strong> interviews</span><span>{companySuccess || "Success rate by company appears as interviews are recorded."}</span><span>{frequentTopics.length ? `Top topics: ${frequentTopics.map(([topic, count]) => `${topic} (${count})`).join(", ")}` : "No interview topics yet."}</span></div>
        {interviewDraft ? <InterviewForm draft={interviewDraft} interviews={interviews.items} onChange={updateInterviewDraft} onSubmit={saveInterview} onCancel={() => { if (!interviewDraft.id) localStorage.removeItem(interviewDraftKey()); setInterviewDraft(null); }} /> :
          selectedInterview ? <InterviewDetail interview={selectedInterview} onBack={() => setSelectedInterview(null)} onEdit={() => editInterview(selectedInterview)} onDelete={() => setConfirmDelete({ type: "interviews", id: selectedInterview.id })} onAddStudy={(question) => void createStudyFromQuestion(selectedInterview, question)} /> :
          <div className="feature-section">
            <div className="feature-toolbar"><h2>Company interviews</h2><button className="button button-primary" type="button" onClick={openNewInterview}>+ Add interview</button></div>
            <div className="feature-filters"><input aria-label="Search interviews" placeholder="Search company, role or notes" value={interviewSearch} onChange={(event) => setInterviewSearch(event.target.value)} /><input aria-label="Filter by company" placeholder="Company" value={companyFilter} onChange={(event) => setCompanyFilter(event.target.value)} /><select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option>{interviewStatuses.map((status) => <option key={status}>{status}</option>)}</select><label className="feature-field feature-date-filter">From<input aria-label="Date range from" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label className="feature-field feature-date-filter">To<input aria-label="Date range to" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label></div>
            {interviews.loading ? <p>Loading interviews…</p> : filteredInterviews.length === 0 ? <p className="feature-empty">No interviews found. Add your first interview to start tracking.</p> :
              <div className="feature-list">{filteredInterviews.map((item) => <article className="feature-record" key={item.id}>
                <button className="feature-record-main" type="button" onClick={() => setSelectedInterview(item)}><span><strong>{item.companyName}</strong><small>{item.profile}</small></span><span>{niceDate(nextRound(item))}</span><StatusBadge status={item.status} /></button>
                <button className="button button-outline" type="button" onClick={() => editInterview(item)}>Edit</button>
              </article>)}</div>}
          </div>}
      </section>}
      {view === "study" && <section>
        {studyDraft ? <StudyForm draft={studyDraft} interviews={interviews.items} onChange={setStudyDraft} onSubmit={saveStudy} onCancel={() => { if (!studyDraft.id) localStorage.removeItem(studyDraftKey()); setStudyDraft(null); }} onUpload={uploadDiagram} /> :
          selectedStudy ? <StudyDetail item={selectedStudy} onBack={() => setSelectedStudy(null)} onEdit={() => setStudyDraft({ ...selectedStudy })} onDelete={() => setConfirmDelete({ type: "study", id: selectedStudy.id })} /> :
          <div className="feature-section">
            <div className="feature-toolbar"><h2>Study material</h2><div className="feature-actions"><button className="button button-outline" type="button" onClick={exportMarkdown}>Export Markdown</button><label className="button button-outline import-file-control" role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.querySelector("input")?.click(); } }}>Import JSON / Markdown<input className="sr-only" type="file" tabIndex={-1} accept="application/json,.json,text/markdown,.md" aria-label="Choose a JSON or Markdown import file" onChange={(event) => void importData(event.target.files?.[0])} /></label><button className="button button-primary" type="button" onClick={() => { try { setStudyDraft(JSON.parse(localStorage.getItem(studyDraftKey()) ?? "null") as StudyDraft ?? blankStudy()); } catch { setStudyDraft(blankStudy()); } }}>+ Add study item</button></div></div>
            <div className="feature-filters"><input aria-label="Search study material" placeholder="Search question, answer or tags" value={studySearch} onChange={(event) => setStudySearch(event.target.value)} /><select aria-label="Filter by topic" value={topicFilter} onChange={(event) => setTopicFilter(event.target.value)}><option value="">All topics</option>{topics.map((topic) => <option key={topic}>{topic}</option>)}</select><select aria-label="Filter by difficulty" value={difficultyFilter} onChange={(event) => setDifficultyFilter(event.target.value)}><option value="">All difficulties</option>{["Easy", "Medium", "Hard"].map((item) => <option key={item}>{item}</option>)}</select><select aria-label="Filter by confidence" value={confidenceFilter} onChange={(event) => setConfidenceFilter(event.target.value)}><option value="">All confidence</option>{[1, 2, 3, 4, 5].map((item) => <option key={item} value={item}>{item} / 5</option>)}</select><label className="feature-check"><input type="checkbox" checked={bookmarkedOnly} onChange={(event) => setBookmarkedOnly(event.target.checked)} /> Bookmarked</label></div>
            {filteredStudy.length > 0 && <div className="flashcard-panel"><div><span className="feature-label">STUDY MODE · {flashcard + 1} / {filteredStudy.length}</span><button className="button button-outline" type="button" onClick={() => { setPracticeRunning(false); setPracticeSeconds(0); setRevealed(false); }}>Reset timer</button></div><h3>{filteredStudy[flashcard % filteredStudy.length].question}</h3>{revealed && <><MarkdownPreview value={filteredStudy[flashcard % filteredStudy.length].answer} /><DiagramViewer diagram={filteredStudy[flashcard % filteredStudy.length].diagram} /></>}<div className="feature-actions"><button className="button button-outline" type="button" onClick={() => setRevealed(!revealed)}>{revealed ? "Hide answer" : "Reveal answer"}</button><button className="button button-outline" type="button" onClick={() => setPracticeRunning(!practiceRunning)}>{practiceRunning ? "Pause practice" : "Start practice timer"}</button><span>{String(Math.floor(practiceSeconds / 60)).padStart(2, "0")}:{String(practiceSeconds % 60).padStart(2, "0")}</span>{revealed && <><button className="button button-primary" type="button" onClick={() => void review(filteredStudy[flashcard % filteredStudy.length], true)}>Got it</button><button className="button button-outline" type="button" onClick={() => void review(filteredStudy[flashcard % filteredStudy.length], false)}>Need review</button></>}</div></div>}
            {filteredStudy.length === 0 ? <p className="feature-empty">No study items match these filters.</p> : <div className="feature-list">{[...groupedStudy].map(([topic, items]) => <section className="study-topic-group" key={topic}><h3>{topic}</h3>{items.map((item) => <article className="study-card" key={item.id}><button className="feature-record-main" type="button" onClick={() => setSelectedStudy(item)}><span><strong>{item.question}</strong><small>{item.difficulty} · confidence {item.confidence}/5 · {item.tags.join(", ")}</small></span><span aria-label={item.bookmarked ? "Bookmarked" : "Not bookmarked"}>{item.bookmarked ? "★" : "☆"}</span></button><button className="button button-outline" type="button" onClick={() => setStudyDraft({ ...item })}>Edit</button></article>)}</section>)}</div>}
          </div>}
      </section>}
    </section>
    {confirmDelete && <ConfirmDialog title={`Delete ${confirmDelete.type === "interviews" ? "interview" : "study item"}?`} onCancel={() => setConfirmDelete(null)} onConfirm={() => void deleteRecord()}>This record will be removed. You can undo the deletion for five seconds.</ConfirmDialog>}
    <footer className="page-footer"><span>Interview and study records are stored by the local backend.</span><span>Review user-entered Markdown and Mermaid as untrusted content.</span></footer>
  </main>;
}

function InterviewForm({ draft, interviews, onChange, onSubmit, onCancel }: { draft: InterviewDraft; interviews: Interview[]; onChange: (update: Partial<InterviewDraft>) => void; onSubmit: (event: FormEvent) => void; onCancel: () => void }) {
  const companies = [...new Set(interviews.map((item) => item.companyName))];
  const updateRound = (index: number, patch: Partial<InterviewRound>) => onChange({ rounds: draft.rounds.map((item, current) => current === index ? { ...item, ...patch } : item) });
  const updateQuestion = (index: number, patch: Partial<InterviewQuestion>) => onChange({ questions: draft.questions.map((item, current) => current === index ? { ...item, ...patch } : item) });
  return <form className="feature-form" onSubmit={onSubmit}>
    <div className="feature-toolbar"><h2>{draft.id ? "Edit interview" : "New interview"}</h2><button className="button button-quiet" type="button" onClick={onCancel}>Close</button></div>
    <datalist id="saved-companies">{companies.map((company) => <option key={company} value={company} />)}</datalist>
    <div className="feature-form-grid"><Field label="Company" required><input list="saved-companies" required maxLength={160} value={draft.companyName} onChange={(event) => onChange({ companyName: event.target.value })} /></Field><Field label="Profile / role" required><input required maxLength={200} value={draft.profile} onChange={(event) => onChange({ profile: event.target.value })} /></Field><Field label="Status"><select value={draft.status} onChange={(event) => onChange({ status: event.target.value as InterviewStatus })}>{interviewStatuses.map((status) => <option key={status}>{status}</option>)}</select></Field><Field label="Job link"><input type="url" value={draft.jobLink} onChange={(event) => onChange({ jobLink: event.target.value })} placeholder="https://" /></Field><Field label="Application ID"><input value={draft.linkedApplicationId} onChange={(event) => onChange({ linkedApplicationId: event.target.value })} /></Field></div>
    <h3>Interview rounds</h3>{draft.rounds.map((round, index) => <div className="feature-nested" key={round.id ?? index}><div className="feature-form-grid"><Field label="Round name" required><input required value={round.roundName} onChange={(event) => updateRound(index, { roundName: event.target.value })} placeholder="Technical 1" /></Field><Field label="Mode"><select value={round.mode} onChange={(event) => updateRound(index, { mode: event.target.value as InterviewRound["mode"] })}><option value="phone">Phone</option><option value="video">Video</option><option value="onsite">Onsite</option></select></Field><Field label="Date & time (your local timezone)" required><input type="datetime-local" required value={localDate(round.dateTime)} onChange={(event) => updateRound(index, { dateTime: isoDate(event.target.value) })} /></Field><Field label="Duration (minutes)"><input type="number" min={5} max={600} value={round.duration} onChange={(event) => updateRound(index, { duration: Number(event.target.value) })} /></Field><Field label="Round status"><select value={round.status} onChange={(event) => updateRound(index, { status: event.target.value as InterviewStatus })}>{interviewStatuses.map((status) => <option key={status}>{status}</option>)}</select></Field><Field label="Notes"><input value={round.notes} onChange={(event) => updateRound(index, { notes: event.target.value })} /></Field></div><button className="button button-quiet" type="button" onClick={() => onChange({ rounds: draft.rounds.filter((_, current) => current !== index) })}>Remove round</button></div>)}<button className="button button-outline" type="button" onClick={() => onChange({ rounds: [...draft.rounds, newRound()] })}>+ Add round</button>
    <h3>Questions asked</h3>{draft.questions.map((question, index) => <div className="feature-nested" key={question.id ?? index}><div className="feature-form-grid"><Field label="Question" required><textarea required value={question.questionText} onChange={(event) => updateQuestion(index, { questionText: event.target.value })} /></Field><Field label="Topic" required><input required value={question.topic} onChange={(event) => updateQuestion(index, { topic: event.target.value })} /></Field><Field label="Round"><input value={question.round} onChange={(event) => updateQuestion(index, { round: event.target.value })} /></Field><Field label="How it went"><select value={question.howItWent} onChange={(event) => updateQuestion(index, { howItWent: event.target.value as InterviewQuestion["howItWent"] })}><option>Good</option><option>Average</option><option>Poor</option></select></Field><Field label="My answer"><textarea value={question.myAnswer} onChange={(event) => updateQuestion(index, { myAnswer: event.target.value })} /></Field><Field label="Correct answer"><textarea value={question.correctAnswer} onChange={(event) => updateQuestion(index, { correctAnswer: event.target.value })} /></Field></div><button className="button button-quiet" type="button" onClick={() => onChange({ questions: draft.questions.filter((_, current) => current !== index) })}>Remove question</button></div>)}<button className="button button-outline" type="button" onClick={() => onChange({ questions: [...draft.questions, newQuestion()] })}>+ Add question</button>
    <h3>HR contact and notes</h3><div className="feature-form-grid"><Field label="HR name"><input value={draft.hr.name} onChange={(event) => onChange({ hr: { ...draft.hr, name: event.target.value } })} /></Field><Field label="HR email"><input type="email" value={draft.hr.email} onChange={(event) => onChange({ hr: { ...draft.hr, email: event.target.value } })} /></Field><Field label="HR phone"><input type="tel" value={draft.hr.phone} onChange={(event) => onChange({ hr: { ...draft.hr, phone: event.target.value } })} /></Field><Field label="HR LinkedIn"><input type="url" value={draft.hr.linkedInUrl} onChange={(event) => onChange({ hr: { ...draft.hr, linkedInUrl: event.target.value } })} /></Field><Field label="Overall notes"><textarea value={draft.overallNotes} onChange={(event) => onChange({ overallNotes: event.target.value })} /></Field><Field label="Feedback received"><textarea value={draft.feedbackReceived} onChange={(event) => onChange({ feedbackReceived: event.target.value })} /></Field><Field label="Offer CTC"><input value={draft.offerDetails.ctc} onChange={(event) => onChange({ offerDetails: { ...draft.offerDetails, ctc: event.target.value } })} /></Field><Field label="Joining date"><input type="date" value={draft.offerDetails.joiningDate} onChange={(event) => onChange({ offerDetails: { ...draft.offerDetails, joiningDate: event.target.value } })} /></Field></div>
    <div className="feature-actions"><button className="button button-primary" type="submit">Save interview</button><button className="button button-outline" type="button" onClick={onCancel}>Cancel</button></div>
  </form>;
}

function InterviewDetail({ interview, onBack, onEdit, onDelete, onAddStudy }: { interview: Interview; onBack: () => void; onEdit: () => void; onDelete: () => void; onAddStudy: (question: InterviewQuestion) => void }) {
  const rounds = [...interview.rounds].sort((a, b) => Date.parse(a.dateTime) - Date.parse(b.dateTime));
  return <section className="feature-section"><div className="feature-toolbar"><div><button className="button button-quiet" type="button" onClick={onBack}>← Interviews</button><h2>{interview.companyName} <StatusBadge status={interview.status} /></h2><p>{interview.profile}</p></div><div className="feature-actions"><button className="button button-outline" type="button" onClick={onEdit}>Edit</button><button className="button button-stop" type="button" onClick={onDelete}>Delete</button></div></div>
    <div className="feature-detail-grid"><div><h3>Round timeline</h3>{rounds.length ? rounds.map((round) => <article className="timeline-item" key={round.id}><strong>{round.roundName}</strong><span>{niceDate(round.dateTime)} · {round.duration} min · {round.mode}</span><p>{round.notes}</p></article>) : <p>No rounds scheduled.</p>}<h3>Questions</h3>{interview.questions.map((question) => <article className="feature-nested" key={question.id}><strong>{question.questionText}</strong><p>{question.topic} · {question.round} · {question.howItWent}</p>{question.myAnswer && <p><b>My answer:</b> {question.myAnswer}</p>}{question.correctAnswer && <p><b>Correct answer:</b> {question.correctAnswer}</p>}{question.studyItemId ? <span className="feature-status">In study library</span> : <button className="button button-outline" type="button" onClick={() => onAddStudy(question)}>Add to study material</button>}</article>)}</div><aside className="feature-contact"><h3>HR contact</h3><p>{interview.hr.name || "No contact name"}</p>{interview.hr.email && <a href={`mailto:${interview.hr.email}`}>{interview.hr.email}</a>}{interview.hr.phone && <a href={`tel:${interview.hr.phone}`}>{interview.hr.phone}</a>}{interview.hr.linkedInUrl && <a href={interview.hr.linkedInUrl} target="_blank" rel="noopener noreferrer">LinkedIn</a>}{interview.jobLink && <a href={interview.jobLink} target="_blank" rel="noopener noreferrer">Job listing</a>}{interview.linkedApplicationId && <p>Application: {interview.linkedApplicationId}</p>}<h3>Notes</h3><p>{interview.overallNotes || "No notes."}</p><p>{interview.feedbackReceived}</p>{interview.offerDetails.ctc && <p>Offer: {interview.offerDetails.ctc}</p>}</aside></div>
  </section>;
}

function StudyForm({ draft, interviews, onChange, onSubmit, onCancel, onUpload }: { draft: StudyDraft; interviews: Interview[]; onChange: (draft: StudyDraft) => void; onSubmit: (event: FormEvent) => void; onCancel: () => void; onUpload: (file?: File) => void }) {
  const topics = [...new Set(interviews.flatMap((interview) => interview.questions.map((question) => question.topic)))];
  return <form className="feature-form" onSubmit={onSubmit}><div className="feature-toolbar"><h2>{draft.id ? "Edit study item" : "New study item"}</h2><button className="button button-quiet" type="button" onClick={onCancel}>Close</button></div><div className="feature-form-grid"><Field label="Topic" required><input list="study-topics" required value={draft.topic} onChange={(event) => onChange({ ...draft, topic: event.target.value })} /><datalist id="study-topics">{topics.map((topic) => <option key={topic}>{topic}</option>)}</datalist></Field><Field label="Question" required><textarea required value={draft.question} onChange={(event) => onChange({ ...draft, question: event.target.value })} /></Field><Field label="Difficulty"><select value={draft.difficulty} onChange={(event) => onChange({ ...draft, difficulty: event.target.value as StudyItem["difficulty"] })}><option>Easy</option><option>Medium</option><option>Hard</option></select></Field><Field label="Source"><select value={draft.source} onChange={(event) => onChange({ ...draft, source: event.target.value as StudyItem["source"] })}><option value="own">Own</option><option value="book">Book</option><option value="company interview">Company interview</option></select></Field><Field label="Confidence (1–5)"><input type="number" min="1" max="5" value={draft.confidence} onChange={(event) => onChange({ ...draft, confidence: Number(event.target.value) })} /></Field><label className="feature-check"><input type="checkbox" checked={draft.bookmarked} onChange={(event) => onChange({ ...draft, bookmarked: event.target.checked })} /> Bookmark</label></div><MarkdownEditor value={draft.answer} onChange={(answer) => onChange({ ...draft, answer })} /><TagInput label="Tags" value={draft.tags} onChange={(tags) => onChange({ ...draft, tags })} /><section className="feature-nested"><h3>Diagram (optional)</h3><label className="feature-field">Mermaid diagram<textarea rows={5} value={draft.diagram?.type === "mermaid" ? draft.diagram.content : ""} onChange={(event) => onChange({ ...draft, diagram: event.target.value ? { type: "mermaid", content: event.target.value } : null })} placeholder="flowchart LR&#10;  A --> B" /></label><label className="feature-field">Upload PNG, JPG or SVG (max 2 MB)<input type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={(event) => onUpload(event.target.files?.[0])} /></label><DiagramViewer diagram={draft.diagram} /></section><div className="feature-actions"><button className="button button-primary" type="submit">Save study item</button><button className="button button-outline" type="button" onClick={onCancel}>Cancel</button></div></form>;
}

function StudyDetail({ item, onBack, onEdit, onDelete }: { item: StudyItem; onBack: () => void; onEdit: () => void; onDelete: () => void }) {
  return <section className="feature-section"><div className="feature-toolbar"><div><button className="button button-quiet" type="button" onClick={onBack}>← Study library</button><h2>{item.question}</h2><p>{item.topic} · {item.difficulty} · confidence {item.confidence}/5 · {item.tags.join(", ")}</p></div><div className="feature-actions"><button className="button button-outline" type="button" onClick={onEdit}>Edit</button><button className="button button-stop" type="button" onClick={onDelete}>Delete</button></div></div><MarkdownPreview value={item.answer} /><DiagramViewer diagram={item.diagram} /><p>Asked at: {item.sourceCompanies?.join(", ") || "No linked companies"}</p></section>;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return <label className="feature-field">{label}{required && <span aria-hidden="true"> *</span>}{children}</label>;
}
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadCalendar(events: Array<{ company: string; title: string; date: string; duration: number }>) {
  const escape = (value: string) => value.replace(/[\\,;]/g, "\\$&").replace(/\r?\n/g, "\\n");
  const body = events.map((event) => `BEGIN:VEVENT\nUID:${crypto.randomUUID()}@say-it\nDTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}\nDTSTART:${new Date(event.date).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}\nDURATION:PT${event.duration}M\nSUMMARY:${escape(`${event.company} - ${event.title}`)}\nEND:VEVENT`).join("\n");
  download(new Blob([`BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Say It//Interview Tracker//EN\n${body}\nEND:VCALENDAR`], { type: "text/calendar" }), "interviews.ics");
}
async function requestNotifications(events: Array<{ message: string; date: string }>) {
  if (!("Notification" in window)) return;
  const permission = await Notification.requestPermission();
  if (permission === "granted") events.forEach(({ message, date }) => {
    const delay = Math.max(0, Date.parse(date) - Date.now());
    window.setTimeout(() => new Notification("Upcoming interview", { body: message }), Math.min(delay, 2_147_000_000));
  });
}
