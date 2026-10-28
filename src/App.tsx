import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useSpeechRecognition } from "./hooks/useSpeechRecognition";
import { useStopwatch } from "./hooks/useStopwatch";
import type { ReactNode } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/context";
import { ForgotPasswordPage, LoginPage, ProfilePage, ResetPasswordPage, SignupPage, VerifyEmailPage } from "./auth/AuthScreens";

const InterviewMode = lazy(() => import("./InterviewMode"));
const JobSearchMode = lazy(() => import("./JobSearchMode"));
const InterviewStudyMode = lazy(() => import("./InterviewStudyMode"));

const languages = [
  { value: "en-IN", label: "English (India)" },
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "hi-IN", label: "हिन्दी (India)" },
];

function formatTime(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function WorkspaceApp() {
  const { user, logout } = useAuth();
  const [mode, setMode] = useState<"dictation" | "interview" | "jobs" | "interview-study">("dictation");
  const speech = useSpeechRecognition();
  const stopwatch = useStopwatch();
  const [language, setLanguage] = useState("en-IN");
  const [copyMessage, setCopyMessage] = useState("");
  const words = useMemo(() => countWords(speech.transcript), [speech.transcript]);
  const wordsPerMinute = stopwatch.elapsedMs > 0
    ? Math.round((words / stopwatch.elapsedMs) * 60_000)
    : 0;

  useEffect(() => {
    if (speech.isListening) stopwatch.start();
    else stopwatch.stop();
  }, [speech.isListening, stopwatch.start, stopwatch.stop]);

  const startDictation = () => {
    stopwatch.reset();
    speech.start(language);
  };

  const clearTranscript = () => {
    speech.reset();
    stopwatch.reset();
    if (speech.isListening) stopwatch.start();
    setCopyMessage("");
  };

  const copyTranscript = async () => {
    try {
      await navigator.clipboard.writeText(speech.transcript);
      setCopyMessage("Copied");
    } catch {
      setCopyMessage("Clipboard unavailable");
    }
    window.setTimeout(() => setCopyMessage(""), 2000);
  };

  const downloadTranscript = () => {
    const file = new Blob([speech.transcript], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "dictation.txt";
    link.click();
    URL.revokeObjectURL(url);
  };

  const status = speech.error
    ? { label: "Error", className: "error" }
    : speech.isListening
      ? { label: "Listening", className: "listening" }
      : { label: "Idle", className: "idle" };
  const controlsDisabled = !speech.isSupported;

  if (mode === "interview") return <Suspense fallback={<p role="status">Loading interview mode…</p>}><InterviewMode onBack={() => setMode("dictation")} /></Suspense>;
  if (mode === "jobs") return <Suspense fallback={<p role="status">Loading job tracker…</p>}><JobSearchMode onBack={() => setMode("dictation")} /></Suspense>;
  if (mode === "interview-study") return <Suspense fallback={<p role="status">Loading interview and study tools…</p>}><InterviewStudyMode onBack={() => setMode("dictation")} /></Suspense>;

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Say it, see it home">
          <span className="brand-mark" aria-hidden="true">s.</span>
          <span>say it<span className="brand-dot">.</span> see it<span className="brand-dot">.</span></span>
        </a>
        <span className="topbar-note">A quieter way to get it all down</span>
        <button className="button button-outline" type="button" onClick={() => setMode("interview")}>Mock interview</button>
        <button className="button button-outline" type="button" onClick={() => setMode("jobs")}>Job tracker</button>
        <button className="button button-outline" type="button" onClick={() => setMode("interview-study")}>Interview & study</button>
        <div className="user-menu"><span className="user-menu-name">{user?.name}</span><Link className="button button-outline" to="/profile">Profile</Link><button className="button button-quiet" type="button" onClick={() => void logout()}>Log out</button></div>
      </header>
      {!user?.emailVerified && <div className="global-verification-banner" role="status">Verify your email to use job search and third-party evaluation. <Link to="/profile">Manage verification</Link></div>}

      <section className="workspace" aria-labelledby="page-title">
        <div className="intro">
          <p className="eyebrow"><span className="eyebrow-line" /> YOUR WORDS, IN REAL TIME</p>
          <h1 id="page-title">Let your thoughts<br />find their <em>voice.</em></h1>
          <p className="intro-copy">A little space to speak freely. Your words will find their way here.</p>
        </div>

        <section className="dictation-card" aria-label="Dictation workspace">
          <div className="card-toolbar">
            <div className="status-area">
              <span className={`status-pill ${status.className}`} aria-hidden="true">
                <span className="status-dot" />{status.label}
              </span>
              <span className="status-sr" role="status" aria-live="polite">
                {speech.error ?? (speech.isListening ? "Dictation is listening" : "Dictation is idle")}
              </span>
            </div>
            <label className="language-picker">
              <span className="sr-only">Recognition language</span>
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                disabled={controlsDisabled || speech.isListening}
              >
                {languages.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <span className="select-chevron" aria-hidden="true">⌄</span>
            </label>
          </div>

          {speech.error && <p className="error-message" role="alert">{speech.error}</p>}
          {!speech.isSupported && (
            <div className="unsupported-message" role="alert">
              Speech recognition is not available in this browser. Open this page on localhost or
              HTTPS in Chrome or Edge and allow microphone access.
            </div>
          )}

          <div className="editor-wrap">
            <textarea
              aria-label="Your dictation"
              className="transcript-editor"
              placeholder="Your words will appear here. Take a breath, then begin..."
              value={speech.transcript}
              onChange={(event) => speech.updateTranscript(event.target.value)}
              disabled={controlsDisabled}
              spellCheck
            />
            {speech.interimTranscript && (
              <div className="interim-line" aria-live="off">
                <span className="interim-label">LIVE</span>
                <span>{speech.interimTranscript}</span>
              </div>
            )}
          </div>

          <div className="card-footer">
            <span className="word-count">{words} {words === 1 ? "word" : "words"}</span>
            <span className="footer-hint">Your transcript stays in this tab</span>
          </div>
        </section>

        <section className="session-row" aria-label="Dictation session statistics">
          <div className="timer-block">
            <span className="stat-label">SESSION TIME</span>
            <span className={`timer-value${speech.isListening ? " timer-active" : ""}`} aria-live="off">
              {formatTime(stopwatch.elapsedMs)}
            </span>
          </div>
          <div className="session-divider" />
          <div className="stat-block">
            <span className="stat-label">WORDS</span>
            <span className="stat-value">{words}</span>
          </div>
          <div className="session-divider" />
          <div className="stat-block">
            <span className="stat-label">WORDS / MIN</span>
            <span className="stat-value">{wordsPerMinute}</span>
          </div>
          <span className="session-caption">
            {speech.isListening ? "Your thoughts are flowing" : "A little progress, beautifully kept"}
          </span>
        </section>

        <div className="action-row">
          <div className="primary-actions">
            {!speech.isListening ? (
              <button
                className="button button-primary"
                type="button"
                onClick={startDictation}
                disabled={controlsDisabled}
              >
                <span className="button-icon mic-icon" aria-hidden="true">●</span>
                Start dictation
              </button>
            ) : (
              <button className="button button-stop" type="button" onClick={speech.stop}>
                <span className="button-icon stop-icon" aria-hidden="true" />
                Stop dictation
              </button>
            )}
            <button className="button button-quiet" type="button" onClick={clearTranscript} disabled={controlsDisabled}>
              Clear
            </button>
          </div>
          <div className="secondary-actions">
            <button className="button button-outline" type="button" onClick={copyTranscript} disabled={controlsDisabled || !speech.transcript}>
              <span aria-hidden="true">⧉</span> Copy{copyMessage ? ` · ${copyMessage}` : ""}
            </button>
            <button className="button button-outline" type="button" onClick={downloadTranscript} disabled={controlsDisabled || !speech.transcript}>
              <span aria-hidden="true">↧</span> Download .txt
            </button>
          </div>
        </div>

        <aside className="privacy-note">
          <span className="privacy-icon" aria-hidden="true">✳</span>
          <p><strong>A small privacy note.</strong> Chrome’s speech recognition may send audio to a cloud service to process it. Your transcript is not saved by this page.</p>
        </aside>
      </section>

      <footer className="page-footer">
        <span>Made for the thoughts that arrive mid-sentence.</span>
        <span>Works best in Chrome or Edge · HTTPS or localhost required</span>
      </footer>
    </main>
  );
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <main className="auth-page"><p role="status">Checking your secure session…</p></main>;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <>{children}</>;
}

function GuestRoute({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <main className="auth-page"><p role="status">Checking your secure session…</p></main>;
  return user ? <Navigate to="/" replace /> : <>{children}</>;
}

function TermsPage() {
  return <main className="auth-page"><section className="auth-card"><h1>Terms & privacy</h1><p>Use this workspace for your personal interview preparation and job search. Keep your account credentials private. Your records are stored in your private account. Speech recognition may process audio through your browser’s speech service; job search and interview evaluation may share the relevant search or answer text with configured third-party services.</p><p>You can export or delete your data from the profile and feature screens. Do not upload information you do not have permission to store.</p><Link className="button button-primary" to="/signup">Back to signup</Link></section></main>;
}

function AppRoutes() {
  return <AuthProvider><Routes>
    <Route path="/login" element={<GuestRoute><LoginPage /></GuestRoute>} />
    <Route path="/signup" element={<GuestRoute><SignupPage /></GuestRoute>} />
    <Route path="/forgot-password" element={<GuestRoute><ForgotPasswordPage /></GuestRoute>} />
    <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
    <Route path="/verify-email/:token" element={<VerifyEmailPage />} />
    <Route path="/terms" element={<TermsPage />} />
    <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
    <Route path="*" element={<ProtectedRoute><WorkspaceApp /></ProtectedRoute>} />
  </Routes></AuthProvider>;
}

function App() {
  return <BrowserRouter><AppRoutes /></BrowserRouter>;
}

export default App;
