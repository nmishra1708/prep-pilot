import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiFetch, authRequest } from "./api";
import { useAuth } from "./context";
import type { AuthUser } from "./context";
import { deleteUserBrowserData, exportUserData } from "../storage/userData";

const email = z.string().trim().email("Enter a valid email address.").max(254);
const commonPasswords = ["password123", "password1234", "qwerty12345", "letmein1234", "admin123456", "welcome1234", "iloveyou123", "1234567890", "changeme123", "p@ssword123"];
const password = z.string().min(10, "Use at least 10 characters.").max(128, "Use no more than 128 characters.")
  .refine((value) => !commonPasswords.includes(value.toLowerCase()), "Choose a less common password.");
const signupSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(120),
  email,
  password,
  confirmPassword: z.string().min(1, "Confirm your password."),
  acceptTerms: z.boolean().refine((value) => value, "You must accept the terms to create an account."),
}).refine((value) => value.password === value.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match." });
const loginSchema = z.object({ email, password: z.string().min(1, "Enter your password."), rememberMe: z.boolean() });
const forgotSchema = z.object({ email });
const resetSchema = z.object({ password, confirmPassword: z.string().min(1, "Confirm your password.") })
  .refine((value) => value.password === value.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match." });
const profileSchema = z.object({ name: z.string().trim().min(1, "Enter your name.").max(120) });
const changePasswordFormSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password."),
  newPassword: password,
  confirmPassword: z.string().min(1, "Confirm your new password."),
}).refine((value) => value.newPassword === value.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match." });

type LoginValues = z.infer<typeof loginSchema>;
type SignupValues = z.infer<typeof signupSchema>;
type ForgotValues = z.infer<typeof forgotSchema>;
type ResetValues = z.infer<typeof resetSchema>;
type ProfileValues = z.infer<typeof profileSchema>;
type ChangePasswordValues = z.infer<typeof changePasswordFormSchema>;

function strength(value: string) {
  if (!value) return 0;
  return [
    value.length >= 10,
    /[a-z]/.test(value) && /[A-Z]/.test(value),
    /\d/.test(value),
    /[^a-zA-Z0-9]/.test(value),
    !commonPasswords.includes(value.toLowerCase()),
  ].filter(Boolean).length;
}

function AuthShell({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return <main className="auth-page">
    <Link className="brand auth-brand" to="/" aria-label="Say it, see it home"><span className="brand-mark">s.</span><span>say it<span className="brand-dot">.</span> see it<span className="brand-dot">.</span></span></Link>
    <section className="auth-card" aria-labelledby="auth-title">
      <p className="eyebrow"><span className="eyebrow-line" /> YOUR PRIVATE WORKSPACE</p>
      <h1 id="auth-title">{title}</h1>
      {note && <p className="auth-note">{note}</p>}
      {children}
    </section>
    <p className="auth-security-note">Your sign-in tokens are held in secure, httpOnly cookies. They are never stored in browser localStorage.</p>
  </main>;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <span id={id} className="auth-field-error" role="alert" aria-live="polite">{message}</span> : null;
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [visible, setVisible] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [busy, setBusy] = useState(false);
  const returnLocation = (location.state as { from?: { pathname?: string; search?: string; hash?: string } } | null)?.from;
  const from = `${returnLocation?.pathname ?? "/"}${returnLocation?.search ?? ""}${returnLocation?.hash ?? ""}`;
  const signupMessage = (location.state as { message?: string } | null)?.message;
  const { register, handleSubmit, formState: { errors } } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "", rememberMe: false },
  });
  const submit = handleSubmit(async (values) => {
    setBusy(true); setSubmitError("");
    try { await login(values.email, values.password, values.rememberMe); navigate(from, { replace: true }); }
    catch (error) { setSubmitError(error instanceof Error ? error.message : "Sign-in failed. Try again."); }
    finally { setBusy(false); }
  });
  return <AuthShell title="Welcome back." note="Sign in to your private interview and study workspace.">
    <form className="auth-form" onSubmit={(event) => void submit(event)} noValidate>
      <AuthField label="Email" id="login-email" error={errors.email?.message}><input id="login-email" type="email" autoComplete="email" autoFocus aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "login-email-error" : undefined} {...register("email")} /></AuthField>
      <AuthField label="Password" id="login-password" error={errors.password?.message}><div className="auth-password-field"><input id="login-password" type={visible ? "text" : "password"} autoComplete="current-password" aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? "login-password-error" : undefined} {...register("password")} /><button className="auth-show-password" type="button" onClick={() => setVisible((value) => !value)}>{visible ? "Hide" : "Show"} password</button></div></AuthField>
      {signupMessage && <p className="auth-form-message" role="status">{signupMessage}</p>}
      <label className="auth-checkbox"><input type="checkbox" {...register("rememberMe")} /> Remember me on this device</label>
      <p className="auth-inline-link"><Link to="/forgot-password">Forgot password?</Link></p>
      <p className="auth-form-message" role="status" aria-live="polite">{submitError}</p>
      <button className="button button-primary auth-submit" type="submit" disabled={busy}>{busy ? "Signing in…" : "Log in"}</button>
    </form>
    <p className="auth-switch">New here? <Link to="/signup">Create an account</Link></p>
  </AuthShell>;
}

export function SignupPage() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [submitError, setSubmitError] = useState("");
  const [busy, setBusy] = useState(false);
  const { register, handleSubmit, watch, formState: { errors } } = useForm<SignupValues>({
    resolver: zodResolver(signupSchema), defaultValues: { name: "", email: "", password: "", confirmPassword: "", acceptTerms: false },
  });
  const passwordValue = watch("password");
  const score = strength(passwordValue);
  const submit = handleSubmit(async (values) => {
    setBusy(true); setSubmitError("");
    try {
      await signup({ ...values, acceptTerms: true });
      navigate("/login", { replace: true, state: { message: "Account created. Check your email for a verification link, then sign in." } });
    } catch (error) { setSubmitError(error instanceof Error ? error.message : "Signup failed. Try again."); }
    finally { setBusy(false); }
  });
  return <AuthShell title="Create your account." note="Your applications and interview preparation stay private to you.">
    <form className="auth-form" onSubmit={(event) => void submit(event)} noValidate>
      <AuthField label="Name" id="signup-name" error={errors.name?.message}><input id="signup-name" autoComplete="name" autoFocus aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "signup-name-error" : undefined} {...register("name")} /></AuthField>
      <AuthField label="Email" id="signup-email" error={errors.email?.message}><input id="signup-email" type="email" autoComplete="email" aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "signup-email-error" : undefined} {...register("email")} /></AuthField>
      <AuthField label="Password" id="signup-password" error={errors.password?.message}><input id="signup-password" type="password" autoComplete="new-password" aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? "signup-password-error" : "password-strength"} {...register("password")} /><div id="password-strength" className={`password-strength strength-${score}`} aria-live="polite"><span>Password strength</span><span>{["", "Very weak", "Weak", "Fair", "Good", "Strong"][score]}</span><i style={{ width: `${score * 20}%` }} /></div></AuthField>
      <AuthField label="Confirm password" id="signup-confirm" error={errors.confirmPassword?.message}><input id="signup-confirm" type="password" autoComplete="new-password" aria-invalid={Boolean(errors.confirmPassword)} aria-describedby={errors.confirmPassword ? "signup-confirm-error" : undefined} {...register("confirmPassword")} /></AuthField>
      <label className="auth-checkbox"><input type="checkbox" aria-invalid={Boolean(errors.acceptTerms)} aria-describedby={errors.acceptTerms ? "signup-terms-error" : undefined} {...register("acceptTerms")} /> I accept the <a href="/terms" target="_blank" rel="noopener noreferrer">terms of service</a> and privacy notice.</label>
      <FieldError id="signup-terms-error" message={errors.acceptTerms?.message} />
      <p className="auth-form-message" role="status" aria-live="polite">{submitError}</p>
      <button className="button button-primary auth-submit" type="submit" disabled={busy}>{busy ? "Creating account…" : "Create account"}</button>
    </form>
    <p className="auth-switch">Already have an account? <Link to="/login">Log in</Link></p>
  </AuthShell>;
}

export function ForgotPasswordPage() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<ForgotValues>({ resolver: zodResolver(forgotSchema) });
  const submit = handleSubmit(async ({ email: address }) => {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await authRequest<{ message: string }>("/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ email: address }) });
      setMessage(result.message);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Request failed."); }
    finally { setBusy(false); }
  });
  return <AuthShell title="Reset your password." note="We’ll send a single-use reset link if the account exists.">
    <form className="auth-form" onSubmit={(event) => void submit(event)} noValidate>
      <AuthField label="Email" id="forgot-email" error={errors.email?.message}><input id="forgot-email" type="email" autoComplete="email" autoFocus aria-invalid={Boolean(errors.email)} {...register("email")} /></AuthField>
      <p className="auth-form-message" role="status" aria-live="polite">{message || error}</p>
      <button className="button button-primary auth-submit" type="submit" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
    </form>
    <p className="auth-switch"><Link to="/login">Return to login</Link></p>
  </AuthShell>;
}

export function ResetPasswordPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<ResetValues>({ resolver: zodResolver(resetSchema) });
  const submit = handleSubmit(async ({ password: nextPassword, confirmPassword }) => {
    setBusy(true); setError("");
    try {
      const result = await authRequest<{ message: string }>("/api/auth/reset-password", {
        method: "POST", body: JSON.stringify({ token, password: nextPassword, confirmPassword }),
      });
      setMessage(result.message);
      navigate("/login", { replace: true, state: { message: result.message } });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Reset link is invalid or expired."); }
    finally { setBusy(false); }
  });
  return <AuthShell title="Choose a new password." note="Reset links expire after 30 minutes and can only be used once.">
    <form className="auth-form" onSubmit={(event) => void submit(event)} noValidate>
      <AuthField label="New password" id="reset-password" error={errors.password?.message}><input id="reset-password" type="password" autoComplete="new-password" autoFocus aria-invalid={Boolean(errors.password)} {...register("password")} /></AuthField>
      <AuthField label="Confirm new password" id="reset-confirm" error={errors.confirmPassword?.message}><input id="reset-confirm" type="password" autoComplete="new-password" aria-invalid={Boolean(errors.confirmPassword)} {...register("confirmPassword")} /></AuthField>
      <p className="auth-form-message" role="status" aria-live="polite">{error || message}</p>
      <button className="button button-primary auth-submit" type="submit" disabled={busy}>{busy ? "Resetting…" : "Reset password"}</button>
    </form>
  </AuthShell>;
}

export function VerifyEmailPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState("Confirm the email address to activate third-party features.");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const verify = async () => {
    setBusy(true); setError("");
    try {
      const result = await authRequest<{ message: string }>("/api/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) });
      setStatus(result.message);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Verification link is invalid or expired."); }
    finally { setBusy(false); }
  };
  return <AuthShell title="Email verification." note="This confirms the address for your account.">
    <p className={`auth-form-message${error ? " error" : ""}`} role="status" aria-live="polite">{error || status}</p>
    {!error && <button className="button button-primary auth-submit" type="button" onClick={() => void verify()} disabled={busy}>{busy ? "Verifying…" : "Verify email"}</button>}
    <button className="button button-primary auth-submit" type="button" onClick={() => navigate("/login")}>Go to login</button>
  </AuthShell>;
}

export function ProfilePage() {
  const { user, updateUser, logout, logoutAll } = useAuth();
  const navigate = useNavigate();
  const [deletePassword, setDeletePassword] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [sessions, setSessions] = useState<Array<{ id: string; createdAt: string; lastUsedAt: string; userAgent: string; current: boolean }>>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadSessions = async () => {
    const result = await authRequest<{ sessions: typeof sessions }>("/api/auth/sessions");
    setSessions(result.sessions);
  };
  const { register: registerProfile, handleSubmit: handleProfileSubmit, formState: { errors: profileErrors } } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema), defaultValues: { name: user?.name ?? "" },
  });
  const { register: registerPassword, handleSubmit: handlePasswordSubmit, formState: { errors: passwordErrors }, reset: resetPasswordForm } = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordFormSchema),
  });
  useEffect(() => { void loadSessions().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load active sessions.")); }, []);

  const saveProfile = handleProfileSubmit(async ({ name }) => {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await authRequest<{ user: AuthUser }>("/api/auth/profile", { method: "PATCH", body: JSON.stringify({ name }) });
      updateUser(result.user); setMessage("Profile updated.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Profile update failed."); }
    finally { setBusy(false); }
  });
  const changePassword = handlePasswordSubmit(async ({ currentPassword, newPassword, confirmPassword }) => {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await authRequest<{ message: string }>("/api/auth/change-password", {
        method: "POST", body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      resetPasswordForm(); setMessage(result.message); await loadSessions();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Password change failed."); }
    finally { setBusy(false); }
  });
  const revokeSession = async (id: string) => {
    try { await authRequest<void>(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }); await loadSessions(); setMessage("Session signed out."); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not sign out session."); }
  };
  const exportData = async () => {
    if (!user) return;
    setExportBusy(true); setError(""); setMessage("");
    try {
      const data = await exportUserData(user.id);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "say-it-see-it-account-export.json";
      link.click();
      URL.revokeObjectURL(url);
      setMessage("Your account export has been downloaded.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not export account data."); }
    finally { setExportBusy(false); }
  };
  const deleteAllData = async () => {
    if (!user || !window.confirm("Delete all interviews, study items, applications, recordings, drafts, and preferences? Your account will remain. This cannot be undone.")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await apiFetch("/api/data", { method: "DELETE" });
      if (!response.ok) {
        const result = await response.json() as { error?: string };
        throw new Error(result.error ?? "Could not delete account data.");
      }
      await deleteUserBrowserData(user.id);
      setMessage("All account data has been deleted. Your account remains active.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete account data."); }
    finally { setBusy(false); }
  };
  const deleteAccount = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || !window.confirm("Permanently delete your account, interview data, study items, applications, and recordings? This cannot be undone.")) return;
    setBusy(true); setError("");
    try {
      const response = await apiFetch("/api/auth/account", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: deletePassword }) });
      if (!response.ok) {
        const result = await response.json() as { error?: string };
        throw new Error(result.error ?? "Could not delete the account.");
      }
      await deleteUserBrowserData(user.id);
      await logout();
      navigate("/signup", { replace: true });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Account deletion failed."); }
    finally { setBusy(false); }
  };

  return <AuthShell title="Your profile." note={`${user?.email ?? ""} · ${user?.emailVerified ? "Email verified" : "Email not verified"}`}>
    {!user?.emailVerified && <div className="auth-verification-banner" role="status">Verify your email before using job search or third-party evaluation. <button className="text-button" type="button" onClick={async () => {
      try { const result = await authRequest<{ message: string }>("/api/auth/resend-verification", { method: "POST" }); setMessage(result.message); }
      catch (reason) { setError(reason instanceof Error ? reason.message : "Could not send verification email."); }
    }}>Resend link</button></div>}
    <form className="auth-form profile-section" onSubmit={(event) => void saveProfile(event)} noValidate>
      <h2>Profile</h2><AuthField label="Name" id="profile-name" error={profileErrors.name?.message}><input id="profile-name" autoComplete="name" aria-invalid={Boolean(profileErrors.name)} {...registerProfile("name")} /></AuthField>
      <button className="button button-primary" type="submit" disabled={busy}>Save name</button>
    </form>
    <form className="auth-form profile-section" onSubmit={(event) => void changePassword(event)} noValidate>
      <h2>Change password</h2>
      <AuthField label="Current password" id="current-password" error={passwordErrors.currentPassword?.message}><input id="current-password" type="password" autoComplete="current-password" aria-invalid={Boolean(passwordErrors.currentPassword)} {...registerPassword("currentPassword")} /></AuthField>
      <AuthField label="New password" id="new-password" error={passwordErrors.newPassword?.message}><input id="new-password" type="password" autoComplete="new-password" aria-invalid={Boolean(passwordErrors.newPassword)} {...registerPassword("newPassword")} /></AuthField>
      <AuthField label="Confirm new password" id="new-password-confirm" error={passwordErrors.confirmPassword?.message}><input id="new-password-confirm" type="password" autoComplete="new-password" aria-invalid={Boolean(passwordErrors.confirmPassword)} {...registerPassword("confirmPassword")} /></AuthField>
      <button className="button button-primary" type="submit" disabled={busy}>Update password</button>
    </form>
    <section className="profile-section"><h2>Active sessions</h2>{sessions.map((session) => <article className="auth-session-row" key={session.id}><span><strong>{session.current ? "This device" : "Signed-in device"}</strong><small>{session.userAgent || "Browser"} · Last active {new Date(session.lastUsedAt).toLocaleString()}</small></span>{!session.current && <button className="button button-outline" type="button" onClick={() => void revokeSession(session.id)}>Sign out</button>}</article>)}<button className="button button-outline" type="button" onClick={() => void logoutAll()}>Log out of all devices</button></section>
    <section className="profile-section"><h2>Your data</h2><p>Export server records, saved applications, local mock interview clips, and account-scoped preferences as JSON.</p><div className="profile-data-actions"><button className="button button-outline" type="button" onClick={() => void exportData()} disabled={exportBusy}>{exportBusy ? "Preparing export…" : "Export my data"}</button><button className="button button-stop" type="button" onClick={() => void deleteAllData()} disabled={busy}>Delete all my data</button></div></section>
    <section className="profile-section"><h2>Delete account</h2><p>This permanently removes your server records, uploaded diagrams, saved applications, and mock interview recordings on this device.</p><form className="auth-form" onSubmit={(event) => void deleteAccount(event)}><AuthField label="Confirm with your password" id="delete-account-password"><input id="delete-account-password" type="password" autoComplete="current-password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} required /></AuthField><button className="button button-stop" type="submit" disabled={busy}>Delete account</button></form></section>
    <p className="auth-form-message" role="status" aria-live="polite">{error || message}</p>
    <p className="auth-switch"><Link to="/">Return to your workspace</Link> · <button className="text-button" type="button" onClick={() => void logout()}>Log out</button></p>
  </AuthShell>;
}

function AuthField({ label, id, error, children }: { label: string; id: string; error?: string; children: ReactNode }) {
  const errorId = `${id}-error`;
  return <label className="auth-field" htmlFor={id}>{label}{children}<FieldError id={errorId} message={error} /></label>;
}
