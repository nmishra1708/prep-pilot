import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAudioAnalysis } from "./hooks/useAudioAnalysis";
import { useInterviewSession } from "./hooks/useInterviewSession";
import { useMediaRecorder } from "./hooks/useMediaRecorder";
import { useSpeechRecognition } from "./hooks/useSpeechRecognition";
import { createAnswerRecord } from "./interview/scoring";
import { deleteAllInterviews, listInterviews, saveInterview } from "./interview/storage";
import { evaluateReport } from "./interview/evaluator";
import questionBank from "./interview/question-bank.json";
import type {
  AnswerRecord,
  CategoryReport,
  InterviewQuestion,
  InterviewReport,
  InterviewType,
  RoleId,
  SessionConfig,
} from "./interview/types";
import { apiFetch } from "./auth/api";

type Screen = "setup" | "active" | "report" | "history";
const additionalQuestionRegistry = new Map<string, InterviewQuestion>();
const roles: Array<{ value: RoleId; label: string }> = [
  { value: "fullstack", label: "Senior Full-Stack" },
  { value: "node-lead", label: "Node.js Lead" },
  { value: "ai-llm", label: "AI/LLM Engineer" },
];

function formatClock(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function getRubric(questionId: string): string[] {
  return getQuestion(questionId)?.rubric ?? [];
}

function getQuestion(questionId: string) {
  const role = Object.values(questionBank).find((entry) =>
    entry.questions.some((question) => question.id === questionId),
  );
  return role?.questions.find((question) => question.id === questionId) ?? additionalQuestionRegistry.get(questionId);
}

function CategoryCard({ item }: { item: CategoryReport }) {
  return (
    <article className="interview-category">
      <div className="category-heading">
        <h4>{item.category}</h4>
        <span className={`category-level level-${item.level.toLowerCase()}`}>{item.level}</span>
      </div>
      <div className="category-score">
        <strong>{item.score}</strong><span>/100</span>
        <span className="score-track"><i style={{ width: `${item.score}%` }} /></span>
      </div>
      <ul className="evidence-list">
        {item.evidence.map((entry, index) => (
          <li key={`${entry.seconds}-${index}`}>
            <span className="evidence-time">{formatClock(entry.seconds)}</span>
            <span><strong>{entry.label}</strong> — {entry.detail}</span>
          </li>
        ))}
      </ul>
      <p className="category-fix"><strong>Try:</strong> {item.fix}</p>
      {item.notes.length > 0 && (
        <details className="category-notes">
          <summary>Show rubric notes</summary>
          <ul>{item.notes.map((note) => <li key={note}>{note}</li>)}</ul>
        </details>
      )}
    </article>
  );
}

function AnswerVideo({ blob, label }: { blob: Blob; label: string }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <video className="answer-video" controls preload="metadata" src={url} aria-label={label} />;
}

function pacePoints(answer: AnswerRecord) {
  if (answer.paceSamples.length > 1) {
    const maximum = Math.max(180, ...answer.paceSamples.map((sample) => sample.wordsPerMinute));
    const duration = Math.max(answer.durationMs / 1000, 1);
    return answer.paceSamples.map((sample) =>
      `${Math.min(100, sample.seconds * 100 / duration)},${78 - sample.wordsPerMinute * 58 / maximum}`,
    ).join(" ");
  }
  const wordCount = answer.transcript.trim() ? answer.transcript.trim().split(/\s+/).length : 0;
  const duration = Math.max(answer.durationMs / 1000, 1);
  const values = Array.from({ length: Math.max(2, Math.ceil(duration / 10)) }, (_, index) => {
    const start = index * 10 / duration;
    const end = Math.min((index + 1) * 10 / duration, 1);
    const count = wordCount * (end - start);
    const intervalSeconds = Math.max(1, (end - start) * duration);
    return Math.round(count / intervalSeconds * 60);
  });
  const max = Math.max(180, ...values);
  return values.map((value, index) => `${index * 100 / Math.max(values.length - 1, 1)},${78 - value * 58 / max}`).join(" ");
}

function ReportView({
  report,
  history,
  onHistory,
  onDelete,
  deleting,
  evaluationMessage,
  isEvaluating,
  storageError,
}: {
  report: InterviewReport;
  history: InterviewReport[];
  onHistory: () => void;
  onDelete: () => void;
  deleting: boolean;
  evaluationMessage: string;
  isEvaluating: boolean;
  storageError: string | null;
}) {
  const previous = history.find((item) => item.id !== report.id && item.role === report.role);
  const currentAverage = Math.round(report.categories.reduce((sum, item) => sum + item.score, 0) / report.categories.length);
  const previousAverage = previous
    ? Math.round(previous.categories.reduce((sum, item) => sum + item.score, 0) / previous.categories.length)
    : null;
  const transcript = report.answers.map((answer, index) =>
    `Question ${index + 1}: ${answer.question}\n${answer.transcript}\n`,
  ).join("\n");

  const downloadTranscript = () => {
    const url = URL.createObjectURL(new Blob([transcript], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "interview-transcript.txt";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="interview-page">
      <header className="interview-heading">
        <p className="interview-eyebrow">YOUR SESSION REPORT</p>
        <h1>A thoughtful look back.</h1>
        <p>{report.roleLabel} · {report.type} · {formatDate(report.createdAt)}</p>
      </header>
      <div className="report-actions no-print">
        <button className="button button-outline" onClick={() => window.print()} type="button">Print / Save PDF</button>
        <button className="button button-outline" onClick={downloadTranscript} type="button">Download transcript .txt</button>
        <button className="button button-outline" onClick={onHistory} type="button">Interview history</button>
      </div>

      <section className="overall-score-panel">
        <div><span className="interview-label">OVERALL PRACTICE SCORE</span><strong>{currentAverage}<small>/100</small></strong></div>
        <p>{previousAverage === null
          ? "Complete another session in this role to see your trend."
          : `Compared with your previous session: ${currentAverage - previousAverage >= 0 ? "+" : ""}${currentAverage - previousAverage} points (${previousAverage} → ${currentAverage}).`}</p>
      </section>
      {(evaluationMessage || isEvaluating) && (
        <p className="interview-alert" role="status">{isEvaluating ? "Evaluating answers on the configured backend…" : evaluationMessage}</p>
      )}
      {storageError && <p className="interview-alert" role="alert">{storageError}</p>}

      <div className="report-grid">
        {report.categories.map((item) => <CategoryCard key={item.category} item={item} />)}
      </div>

      <section className="report-summary">
        <div>
          <h3>Three strengths to keep</h3>
          <ol>{report.strengths.map((item) => <li key={item}>{item}</li>)}</ol>
        </div>
        <div>
          <h3>Three things to practise</h3>
          <ol>{report.fixes.map((item) => <li key={item}>{item}</li>)}</ol>
        </div>
        <div>
          <h3>Your 7-day practice</h3>
          <p>{report.practicePlan}</p>
        </div>
      </section>

      <section className="answer-reviews">
        <h2>Answer-by-answer review</h2>
        {report.answers.map((answer, index) => {
          const markers = answer.report.flatMap((item) => item.evidence.map((entry) => ({
            seconds: entry.seconds,
            label: entry.label,
            category: item.category,
          })));
          return (
            <details className="answer-review" key={answer.questionId + index}>
              <summary><span>Question {index + 1}</span> {answer.question}</summary>
              <div className="answer-review-body">
                <p className="report-question-rubric"><strong>Reference rubric:</strong> {getRubric(answer.questionId).join(" · ")}</p>
                <p className="report-question-rubric"><strong>One possible answer direction:</strong> {getQuestion(answer.questionId)?.referenceAnswer ?? "Use the rubric to review your approach."}</p>
                <div className="answer-video-wrap">
                  {answer.video
                    ? <AnswerVideo blob={answer.video} label={`Recording for question ${index + 1}`} />
                    : <p className="no-video">No video clip was available for this answer; transcript and analysis are saved.</p>}
                </div>
                {answer.video && (
                  <div className="timeline-review">
                    <span className="interview-label">ANSWER TIMELINE · CLICK A MARKER TO SEEK</span>
                    <div className="pace-chart">
                      <svg viewBox="0 0 100 82" role="img" aria-label="Estimated speaking pace over answer duration">
                        <path d="M0 78H100M0 40H100M0 2H100" className="chart-grid" />
                        <polyline points={pacePoints(answer)} className="pace-line" />
                      </svg>
                    </div>
                    <p className="chart-caption">Estimated words per minute over time, derived from transcript timing; not a measured phonetic pace.</p>
                    <div className="timeline-markers">
                      {markers.slice(0, 12).map((marker, markerIndex) => (
                        <button
                          key={`${marker.category}-${markerIndex}`}
                          type="button"
                          className="timeline-marker"
                          onClick={(event) => {
                            const video = event.currentTarget.closest(".answer-review-body")?.querySelector("video");
                            if (video) video.currentTime = marker.seconds;
                          }}
                        >
                          <span>{formatClock(marker.seconds)}</span> {marker.category}: {marker.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <label className="transcript-label" htmlFor={`answer-transcript-${index}`}>Your answer caption / transcript</label>
                <textarea id={`answer-transcript-${index}`} className="interview-transcript" readOnly value={answer.transcript || "No transcript was captured."} />
                <div className="report-grid answer-category-grid">
                  {answer.report.map((item) => <CategoryCard key={item.category} item={item} />)}
                </div>
              </div>
            </details>
          );
        })}
      </section>

      <aside className="estimation-note">
        Scores are estimates, not certain conclusions. Voice and nervousness signals use audio heuristics; no face analysis is performed. Speech recognition varies with accent, microphone, and noise. Answer accuracy depends on the displayed rubric, and keyword or optional model evaluation can be wrong — review it and disagree where needed.
      </aside>
      <div className="delete-data-row no-print">
        <button type="button" className="button button-quiet" onClick={onDelete} disabled={deleting}>
          {deleting ? "Deleting…" : "Delete all my data"}
        </button>
      </div>
    </div>
  );
}

export default function InterviewMode({ onBack }: { onBack: () => void }) {
  const session = useInterviewSession();
  const speech = useSpeechRecognition();
  const recorder = useMediaRecorder();
  const audio = useAudioAnalysis();
  const [screen, setScreen] = useState<Screen>("setup");
  const [role, setRole] = useState<RoleId>("fullstack");
  const [type, setType] = useState<InterviewType>("mixed");
  const [questionCount, setQuestionCount] = useState(5);
  const [timeLimit, setTimeLimit] = useState(120);
  const [useEvaluator, setUseEvaluator] = useState(false);
  const [includeStudyQuestions, setIncludeStudyQuestions] = useState(false);
  const [studyQuestions, setStudyQuestions] = useState<InterviewQuestion[]>([]);
  const [consent, setConsent] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState("");
  const [history, setHistory] = useState<InterviewReport[]>([]);
  const [report, setReport] = useState<InterviewReport | null>(null);
  const [evaluationMessage, setEvaluationMessage] = useState("");
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [captureActive, setCaptureActive] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(120);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const transcriptRef = useRef("");
  const firstWordAtRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const paceSamplesRef = useRef<Array<{ seconds: number; wordsPerMinute: number }>>([]);
  const lastPaceSampleRef = useRef({ seconds: 0, words: 0 });
  const finishRef = useRef<(() => Promise<AnswerRecord | null>) | null>(null);
  const timeoutRef = useRef<(() => Promise<void>) | null>(null);
  const autoStartRef = useRef(false);
  const captureGuardRef = useRef(false);
  useEffect(() => {
    let active = true;
    void apiFetch("/api/study-items?limit=100")
      .then(async (response) => {
        if (!response.ok) return;
        const page = await response.json() as { items?: Array<{ id: string; topic: string; question: string; answer: string }> };
        const questions = (page.items ?? []).map((item) => {
          const rubric = item.answer.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 10);
          const question: InterviewQuestion = {
            id: `study-${item.id}`,
            type: /\b(hr|behavio?ral|conflict|teamwork|leadership)\b/i.test(item.topic) ? "behavioural" : "technical",
            prompt: item.question,
            rubric: rubric.length ? rubric : ["Provide a clear, accurate response to this question."],
            referenceAnswer: item.answer,
          };
          additionalQuestionRegistry.set(question.id, question);
          return question;
        });
        if (active) setStudyQuestions(questions);
      })
      .catch(() => { if (active) setStudyQuestions([]); });
    return () => { active = false; };
  }, []);
  const sessionQuestion = session.currentQuestion;

  useEffect(() => {
    transcriptRef.current = speech.transcript;
    if (speech.transcript.trim() && firstWordAtRef.current === null && startedAtRef.current) {
      firstWordAtRef.current = (Date.now() - startedAtRef.current) / 1000;
    }
  }, [speech.transcript]);

  useEffect(() => {
    if (previewRef.current && stream) previewRef.current.srcObject = stream;
  }, [stream, screen]);

  useEffect(() => {
    if (screen !== "active" || !autoStartRef.current || !sessionQuestion || captureActive || !stream) return;
    autoStartRef.current = false;
    speech.reset();
    transcriptRef.current = "";
    firstWordAtRef.current = null;
    const now = Date.now();
    startedAtRef.current = now;
    paceSamplesRef.current = [];
    lastPaceSampleRef.current = { seconds: 0, words: 0 };
    setStartedAt(now);
    setRemainingSeconds(session.config?.timeLimitSeconds ?? 120);
    captureGuardRef.current = true;
    setCaptureActive(true);
    speech.start("en-US");
    if (!recorder.start(stream)) setMediaError("Recording is unavailable; the transcript can still be saved.");
    audio.start(stream);
  }, [audio.start, captureActive, recorder.start, screen, session.config?.timeLimitSeconds, sessionQuestion, speech.reset, speech.start, stream]);

  useEffect(() => {
    if (!captureActive || startedAt === null) return undefined;
    const limit = session.config?.timeLimitSeconds ?? 120;
    if (limit === 0) return undefined;
    const timer = window.setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      if (limit > 0) {
        const remaining = Math.max(0, limit - elapsedSeconds);
        setRemainingSeconds(remaining);
        if (remaining === 0) {
          void timeoutRef.current?.();
          return;
        }
      }
      if (elapsedSeconds - lastPaceSampleRef.current.seconds >= 5) {
        const words = transcriptRef.current.trim() ? transcriptRef.current.trim().split(/\s+/).length : 0;
        const elapsed = elapsedSeconds - lastPaceSampleRef.current.seconds;
        paceSamplesRef.current.push({
          seconds: elapsedSeconds,
          wordsPerMinute: Math.round(Math.max(0, words - lastPaceSampleRef.current.words) * 60 / elapsed),
        });
        lastPaceSampleRef.current = { seconds: elapsedSeconds, words };
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [captureActive, session.config?.timeLimitSeconds, startedAt]);

  const finishAnswer = useCallback(async () => {
    if (!captureGuardRef.current || !sessionQuestion) return null;
    captureGuardRef.current = false;
    setCaptureActive(false);
    setStartedAt(null);
    speech.stop();
    const endedAt = Date.now();
    const [video, audioMetrics] = await Promise.all([recorder.stop(), audio.stop()]);
    const durationMs = Math.max(1, endedAt - startedAtRef.current);
    const elapsedSeconds = Math.round(durationMs / 1000);
    const words = transcriptRef.current.trim() ? transcriptRef.current.trim().split(/\s+/).length : 0;
    if (elapsedSeconds > lastPaceSampleRef.current.seconds) {
      paceSamplesRef.current.push({
        seconds: elapsedSeconds,
        wordsPerMinute: Math.round(Math.max(0, words - lastPaceSampleRef.current.words) * 60
          / (elapsedSeconds - lastPaceSampleRef.current.seconds)),
      });
    }
    const answer = createAnswerRecord({
      question: sessionQuestion,
      questionId: sessionQuestion.id,
      transcript: transcriptRef.current,
      startedAt: startedAtRef.current,
      endedAt,
      durationMs,
      timeLimitSeconds: session.config?.timeLimitSeconds ?? 120,
      firstWordSeconds: firstWordAtRef.current,
      audio: { ...audioMetrics, paceSamples: paceSamplesRef.current },
      video,
    });
    return answer;
  }, [audio.stop, captureActive, recorder.stop, session.config?.timeLimitSeconds, sessionQuestion, speech.stop]);
  finishRef.current = finishAnswer;

  useEffect(() => {
    if (!stream) return;
    return () => {
      stream.getTracks().forEach((track) => track.stop());
    };
  }, [stream]);

  useEffect(() => {
    void listInterviews().then(setHistory).catch((error: unknown) =>
      setMediaError(error instanceof Error ? error.message : "Could not load interview history."),
    );
  }, []);

  useEffect(() => {
    if (screen === "history") {
      void listInterviews().then(setHistory).catch((error: unknown) =>
        setMediaError(error instanceof Error ? error.message : "Could not load interview history."),
      );
    }
  }, [screen]);

  const requestMedia = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMediaError("Camera and microphone access is not supported. Use a current browser over HTTPS or localhost.");
      return;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      stream?.getTracks().forEach((track) => track.stop());
      setStream(media);
      setMediaError("");
    } catch (error) {
      setMediaError(error instanceof Error && error.name === "NotAllowedError"
        ? "Camera or microphone permission was denied. Allow both in browser settings and try again."
        : "Could not access a camera and microphone. Check that they are connected and not in use.");
    }
  };

  const beginInterview = () => {
    if (!consent || !stream) return;
    const config: SessionConfig = { role, type, questionCount, timeLimitSeconds: timeLimit };
    session.begin(config, includeStudyQuestions ? studyQuestions : []);
    autoStartRef.current = true;
    setReport(null);
    setScreen("active");
  };

  const advance = async () => {
    const answer = await finishRef.current?.();
    if (!answer) return;
    autoStartRef.current = true;
    const result = await session.next(answer);
    if (result) {
      await showReport(result);
    }
  };
  timeoutRef.current = advance;

  const retryAnswer = async () => {
    await finishRef.current?.();
    session.retry();
    autoStartRef.current = false;
    setCaptureActive(false);
    setStartedAt(null);
    window.setTimeout(() => {
      if (sessionQuestion) {
        speech.reset();
        transcriptRef.current = "";
        firstWordAtRef.current = null;
        const now = Date.now();
        startedAtRef.current = now;
        paceSamplesRef.current = [];
        lastPaceSampleRef.current = { seconds: 0, words: 0 };
        captureGuardRef.current = true;
        setStartedAt(now);
        setRemainingSeconds(session.config?.timeLimitSeconds ?? 120);
        setCaptureActive(true);
        speech.start("en-US");
        if (stream) recorder.start(stream);
        if (stream) audio.start(stream);
      }
    }, 50);
  };

  const showReport = async (result: InterviewReport) => {
    setReport(result);
    setScreen("report");
    setHistory((previous) => [result, ...previous.filter((item) => item.id !== result.id)]);
    if (useEvaluator) {
      setIsEvaluating(true);
      setEvaluationMessage("Sending answer transcripts to the configured backend evaluator for rubric-based review…");
      try {
        const evaluated = await evaluateReport(result);
        setReport(evaluated);
        setHistory((previous) => [evaluated, ...previous.filter((item) => item.id !== evaluated.id)]);
        try {
          await saveInterview(evaluated);
          setEvaluationMessage("Review the rubric result and sample answer; model evaluations can be mistaken.");
        } catch {
          setEvaluationMessage("Evaluation finished, but the updated report could not be saved locally.");
        }
      } catch {
        setEvaluationMessage("Backend evaluation failed. Local heuristic scoring remains available.");
      } finally {
        setIsEvaluating(false);
      }
    }
  };

  const endInterview = async () => {
    const answer = await finishRef.current?.();
    const result = answer ? await session.complete(answer) : null;
    if (result) await showReport(result);
    else setScreen("setup");
  };

  const deleteData = async () => {
    if (!window.confirm("Delete all saved interview reports and video recordings from this browser? This cannot be undone.")) return;
    setIsDeleting(true);
    try {
      await deleteAllInterviews();
      setHistory([]);
      setReport(null);
      session.clear();
      speech.stop();
      speech.reset();
      stream?.getTracks().forEach((track) => track.stop());
      setStream(null);
      setScreen("setup");
      setMediaError("All locally saved interview data has been deleted.");
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : "Could not delete local interview data.");
    } finally {
      setIsDeleting(false);
    }
  };

  const wordCount = useMemo(() => speech.transcript.trim() ? speech.transcript.trim().split(/\s+/).length : 0, [speech.transcript]);
  const progress = session.questions.length ? Math.min(session.index + 1, session.questions.length) : 1;
  const statusText = speech.error ?? (captureActive ? "Listening and recording this answer" : "Recording paused");

  if (screen === "report" && report) {
    return (
      <ReportView
        report={report}
        history={history}
        onHistory={() => setScreen("history")}
        onDelete={() => void deleteData()}
        deleting={isDeleting}
        evaluationMessage={evaluationMessage}
        isEvaluating={isEvaluating}
        storageError={session.storageError}
      />
    );
  }

  if (screen === "history") {
    return (
      <div className="interview-page">
        <header className="interview-heading">
          <p className="interview-eyebrow">STORED ON THIS DEVICE</p>
          <h1>Interview history</h1>
          <p>Saved reports and recordings stay in this browser profile.</p>
        </header>
        <div className="interview-toolbar">
          <button type="button" className="button button-outline" onClick={() => setScreen(report ? "report" : "setup")}>Back</button>
          <button type="button" className="button button-stop" onClick={() => void deleteData()} disabled={isDeleting}>Delete all my data</button>
        </div>
        {mediaError && <p className="interview-alert" role="status">{mediaError}</p>}
        {history.length ? history.map((item) => (
          <button className="history-item" key={item.id} type="button" onClick={() => { setReport(item); setScreen("report"); }}>
            <strong>{item.roleLabel}</strong><span>{item.type} · {item.answers.length} answers · {formatDate(item.createdAt)}</span>
            <span>{Math.round(item.categories.reduce((sum, category) => sum + category.score, 0) / item.categories.length)}/100</span>
          </button>
        )) : <p className="interview-empty">No saved sessions yet.</p>}
      </div>
    );
  }

  if (screen === "active") {
    const question = sessionQuestion;
    return (
      <div className="interview-page">
        <div className="interview-toolbar">
          <button type="button" className="button button-outline" onClick={() => void endInterview()}>End interview</button>
          <span className="interview-progress">QUESTION {progress} / {session.questions.length}</span>
          <span className="interview-countdown" aria-live="off">
            {session.config?.timeLimitSeconds === 0 ? "∞" : formatClock(remainingSeconds)}
          </span>
        </div>
        {mediaError && <p className="interview-alert" role="alert">{mediaError}</p>}
        {recorder.error && <p className="interview-alert" role="alert">{recorder.error}</p>}
        <div className="active-interview-grid">
          <section className="question-panel">
            <p className="interview-eyebrow">{session.roleLabel} · {question?.type}</p>
            <h1>{question?.prompt}</h1>
            <p className="question-hint">Take a moment to think. Your answer is being captured as captions.</p>
            <details className="rubric-disclosure">
              <summary>What a strong answer can cover</summary>
              <ul>{question?.rubric.map((point) => <li key={point}>{point}</li>)}</ul>
            </details>
            <div className="question-controls">
              <button type="button" className="button button-outline" onClick={() => void retryAnswer()}>Retry answer</button>
              <button type="button" className="button button-primary" onClick={() => void advance()} disabled={!captureActive}>Next question</button>
            </div>
          </section>
          <section className="camera-panel" aria-label="Camera and answer captions">
            {stream
              ? <video className="live-camera" ref={previewRef} autoPlay muted playsInline aria-label="Live camera preview" />
              : <div className="camera-unavailable">Camera preview unavailable</div>}
            <span className={`recording-badge${recorder.isRecording ? " is-recording" : ""}`}>
              <i /> {recorder.isRecording ? "RECORDING" : "NOT RECORDING"}
            </span>
            <p className="status-sr" role="status" aria-live="polite">{statusText}</p>
            <label className="transcript-label" htmlFor="live-answer-transcript">Live answer captions · {wordCount} words</label>
            <textarea
              id="live-answer-transcript"
              className="interview-transcript live-transcript"
              value={speech.transcript + (speech.interimTranscript ? ` ${speech.interimTranscript}` : "")}
              onChange={(event) => speech.updateTranscript(event.target.value)}
              placeholder="Your spoken answer appears here…"
            />
            {speech.error && <p className="interview-alert" role="alert">{speech.error}</p>}
          </section>
        </div>
        <p className="estimation-note">Delivery and nervousness indicators are audio estimates, not diagnoses or certain conclusions. No face-based analysis is enabled. Recognition accuracy varies with accent, microphone, and background noise.</p>
      </div>
    );
  }

  return (
    <div className="interview-page">
      <header className="interview-heading">
        <p className="interview-eyebrow">A PRIVATE PRACTICE SPACE</p>
        <h1>Mock video interview</h1>
        <p>Practise out loud, then get a transparent, rubric-based review.</p>
      </header>
      <div className="interview-toolbar">
        <button type="button" className="button button-outline" onClick={onBack}>Back to dictation</button>
        <button type="button" className="button button-outline" onClick={() => setScreen("history")}>Past sessions</button>
      </div>

      <section className="consent-panel">
        <h2>Before you begin: recording and privacy</h2>
        <p>Each answer is recorded as a separate audio/video clip and stored in this browser’s IndexedDB on this device. The page does not upload recordings. Browser speech recognition may send audio to its own speech service (Chrome may use a cloud service) to create captions.</p>
        <p>Optional server evaluation sends answer transcripts and the visible question rubric to the backend you configure; if that backend uses a model provider, those transcripts may be sent to that provider. API keys stay on the backend, never in the browser. Do not include sensitive personal information.</p>
        <p>Nervousness and voice observations are rough audio heuristics, not diagnosis. No face analysis is performed. Speech recognition can be inaccurate; wrong-answer results depend on the displayed rubric, and you can disagree with them.</p>
      </section>

      <section className="setup-card" aria-label="Interview setup">
        <div className="setup-fields">
          <label>Target role
            <select value={role} onChange={(event) => setRole(event.target.value as RoleId)}>
              {roles.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label>Interview type
            <select value={type} onChange={(event) => setType(event.target.value as InterviewType)}>
              <option value="mixed">Mixed</option><option value="technical">Technical</option><option value="behavioural">Behavioural</option>
            </select>
          </label>
          <label>Number of questions
            <input type="number" min={3} max={10} value={questionCount} onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value)) setQuestionCount(Math.min(10, Math.max(3, value)));
            }} />
          </label>
          <label>Time per answer
            <select value={timeLimit} onChange={(event) => setTimeLimit(Number(event.target.value))}>
              <option value={60}>1 minute</option><option value={120}>2 minutes (default)</option><option value={180}>3 minutes</option><option value={300}>5 minutes</option><option value={0}>No limit</option>
            </select>
          </label>
        </div>
        <div className="preview-row">
          <div className="preview-video-box">
            {stream
              ? <video className="preview-video" ref={previewRef} autoPlay muted playsInline aria-label="Camera preview" />
              : <span>Camera preview</span>}
          </div>
          <div>
            <h3>Camera &amp; microphone check</h3>
            <p>{stream ? "Camera and microphone access granted. Your preview stays in this tab." : "Allow camera and microphone access to check your setup before recording."}</p>
            <button type="button" className="button button-outline" onClick={() => void requestMedia()}>{stream ? "Refresh device preview" : "Check camera & microphone"}</button>
          </div>
        </div>
        {!speech.isSupported && <p className="interview-alert" role="alert">Live captions are not supported in this browser. Use current Chrome or Edge; captions are needed to score answers.</p>}
        {!window.isSecureContext && <p className="interview-alert" role="alert">Camera and microphone require HTTPS or localhost.</p>}
        {mediaError && <p className="interview-alert" role="alert">{mediaError}</p>}
        {session.storageError && <p className="interview-alert" role="alert">{session.storageError}</p>}
        <label className="consent-check">
          <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
          I consent to recording my answers on this device and understand the speech-service privacy note above.
        </label>
        <label className="consent-check optional-check">
          <input type="checkbox" checked={useEvaluator} onChange={(event) => setUseEvaluator(event.target.checked)} />
          Optionally evaluate transcripts through my configured backend (transcripts and rubrics are sent; no API key is sent to the browser).
        </label>
        <label className="consent-check optional-check">
          <input type="checkbox" checked={includeStudyQuestions} onChange={(event) => setIncludeStudyQuestions(event.target.checked)} disabled={studyQuestions.length === 0} />
          Include my Study Library questions in this interview{studyQuestions.length ? ` (${studyQuestions.length} available)` : " (no study items available)"}. Their saved answers are used as the visible reference rubric.
        </label>
        <button
          type="button"
          className="button button-primary setup-start"
          disabled={!consent || !stream || !speech.isSupported}
          onClick={beginInterview}
        >Start interview</button>
      </section>

      <section className="interview-history-preview">
        <h2>Recent sessions</h2>
        {history.slice(0, 3).map((item) => (
          <button className="history-item" key={item.id} type="button" onClick={() => { setReport(item); setScreen("report"); }}>
            <strong>{item.roleLabel}</strong><span>{formatDate(item.createdAt)} · {item.answers.length} answers</span>
          </button>
        ))}
      </section>
      <aside className="estimation-note">Results are practice prompts, not hiring decisions. Voice and nervousness signals are estimates; face-based cues are not enabled. Recognition accuracy varies by accent, microphone, and noise. Review the rubric alongside every answer accuracy result.</aside>
      <div className="delete-data-row"><button type="button" className="button button-quiet" onClick={() => void deleteData()} disabled={isDeleting}>Delete all my data</button></div>
      {evaluationMessage && <p className="interview-alert" role="status">{isEvaluating ? "Evaluating…" : evaluationMessage}</p>}
      <span className="status-sr" aria-live="polite">{statusText}</span>
    </div>
  );
}
