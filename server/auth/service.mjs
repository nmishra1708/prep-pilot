import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { rm, mkdir } from "node:fs/promises";
import path from "node:path";
import { deleteAccountSchema, changePasswordSchema, emailOnlySchema, loginSchema, profileSchema, resetPasswordSchema, signupSchema, tokenSchema } from "./schemas.mjs";

const ACCESS_SECONDS = 15 * 60;
const NORMAL_SESSION_DAYS = 7;
const REMEMBERED_SESSION_DAYS = 30;
const LOCK_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const PASSWORD_RESET_MS = 30 * 60 * 1000;
const VERIFICATION_MS = 24 * 60 * 60 * 1000;
const emailWindows = new Map();
const dummyHashPromise = bcrypt.hash("not-a-real-user-password", 12);

function hash(value, secret = process.env.TOKEN_HASH_SECRET ?? "local-development-only-token-pepper") {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function validHash(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function safeUser(user, extra = {}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: Boolean(user.email_verified),
    legacyDataOwner: Boolean(user.legacy_data_owner),
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
    ...extra,
  };
}

function originUrl(baseUrl, route) {
  return new URL(route, baseUrl).toString();
}

function validateEmailRateLimit(email, action) {
  const now = Date.now();
  for (const [key, entry] of emailWindows) if (entry.resetAt <= now) emailWindows.delete(key);
  const key = `${action}:${email}`;
  const entry = emailWindows.get(key);
  if (entry && entry.count >= (action === "login" ? 20 : 6)) return false;
  emailWindows.set(key, entry ? { ...entry, count: entry.count + 1 } : { count: 1, resetAt: now + 15 * 60 * 1000 });
  return true;
}

function setCookieOptions(env, maxAge, pathValue = "/") {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: pathValue,
    maxAge,
  };
}

function setSessionCookies(res, env, accessToken, refreshToken, rememberMe) {
  const refreshDays = rememberMe ? REMEMBERED_SESSION_DAYS : NORMAL_SESSION_DAYS;
  res.cookie("access_token", accessToken, setCookieOptions(env, ACCESS_SECONDS * 1000));
  res.cookie("refresh_token", refreshToken, setCookieOptions(env, refreshDays * 86400 * 1000, "/api/auth"));
  res.cookie("csrf_token", randomBytes(32).toString("base64url"), {
    httpOnly: false,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: refreshDays * 86400 * 1000,
  });
}

function clearSessionCookies(res, env) {
  res.clearCookie("access_token", { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax", path: "/" });
  res.clearCookie("refresh_token", { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth" });
  res.clearCookie("csrf_token", { httpOnly: false, secure: env.NODE_ENV === "production", sameSite: "lax", path: "/" });
}

function cookie(req, name) {
  const value = req.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
  if (!value) return null;
  try { return decodeURIComponent(value); } catch { return null; }
}

function accessSecret(env) {
  if (env.JWT_ACCESS_SECRET && env.JWT_ACCESS_SECRET.length >= 32) return env.JWT_ACCESS_SECRET;
  if (env.NODE_ENV === "production") {
    throw Object.assign(new Error("JWT_ACCESS_SECRET must contain at least 32 characters."), { code: "MISSING_JWT_ACCESS_SECRET" });
  }
  return "local-development-only-access-secret-change-before-deploying";
}

function issueAccessToken(userId, sessionId, env) {
  return jwt.sign({ sub: userId, sid: sessionId }, accessSecret(env), {
    algorithm: "HS256",
    issuer: "say-it-see-it",
    expiresIn: ACCESS_SECONDS,
  });
}

function newRefreshToken() {
  return randomBytes(48).toString("base64url");
}

function parseCookies(req, _res, next) {
  req.authCookies = {
    access: cookie(req, "access_token"),
    refresh: cookie(req, "refresh_token"),
    csrf: cookie(req, "csrf_token"),
  };
  next();
}

export function createAuthService({ db, mailer, env = process.env, uploadsDirectory, baseUrl = env.FRONTEND_ORIGIN ?? "http://localhost:5173" }) {
  const hashSecret = (value) => {
    if (env.NODE_ENV === "production" && (!env.TOKEN_HASH_SECRET || env.TOKEN_HASH_SECRET.length < 32)) {
      throw Object.assign(new Error("TOKEN_HASH_SECRET must contain at least 32 characters."), { code: "MISSING_TOKEN_HASH_SECRET" });
    }
    return hash(value, env.TOKEN_HASH_SECRET ?? "local-development-only-token-pepper");
  };
  const emailServiceUnavailable = (res) => {
    if (mailer.isConfigured?.() !== false) return false;
    res.status(503).json({ error: "Email service is not configured. Contact the site administrator." });
    return true;
  };
  const issueSession = async (res, user, req, rememberMe) => {
    const id = randomUUID();
    const refreshToken = newRefreshToken();
    const now = new Date().toISOString();
    const refreshDays = rememberMe ? REMEMBERED_SESSION_DAYS : NORMAL_SESSION_DAYS;
    await db.createAuthSession({
      id,
      userId: user.id,
      refreshHash: hashSecret(refreshToken),
      createdAt: now,
      expiresAt: Date.now() + refreshDays * 86400 * 1000,
      lastUsedAt: now,
      userAgent: String(req.get("user-agent") ?? "").slice(0, 500),
      ipAddress: String(req.ip ?? req.socket.remoteAddress ?? "").slice(0, 80),
    });
    setSessionCookies(res, env, issueAccessToken(user.id, id, env), refreshToken, rememberMe);
    return id;
  };

  const requireAuth = async (req, res, next) => {
    const token = req.authCookies?.access ?? cookie(req, "access_token");
    if (!token) return res.status(401).json({ error: "Authentication required." });
    let payload;
    try {
      payload = jwt.verify(token, accessSecret(env), { issuer: "say-it-see-it", algorithms: ["HS256"] });
    } catch {
      return res.status(401).json({ error: "Authentication required." });
    }
    if (typeof payload !== "object" || typeof payload.sub !== "string" || typeof payload.sid !== "string") {
      return res.status(401).json({ error: "Authentication required." });
    }
    try {
      const session = await db.authSession(payload.sid);
      if (!session || session.user_id !== payload.sub || session.expires_at <= Date.now()) {
        return res.status(401).json({ error: "Authentication required." });
      }
      const user = await db.userById(payload.sub);
      if (!user) return res.status(401).json({ error: "Authentication required." });
      req.auth = { userId: user.id, sessionId: session.id, user };
      return next();
    } catch (error) {
      return next(error);
    }
  };

  const requireVerified = (req, res, next) => {
    if (!req.auth?.user || !Boolean(req.auth.user.email_verified)) {
      return res.status(403).json({ error: "Verify your email before using features that share data with third-party services." });
    }
    next();
  };

  const csrf = (req, res, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
    const origin = req.get("origin");
    const expectedOrigin = new URL(baseUrl).origin;
    if (origin && origin !== expectedOrigin) return res.status(403).json({ error: "Request origin was not accepted." });
    const token = req.get("x-csrf-token");
    const cookieToken = req.authCookies?.csrf ?? cookie(req, "csrf_token");
    if (!token || !cookieToken || !validHash(hashSecret(token), hashSecret(cookieToken))) {
      return res.status(403).json({ error: "CSRF token is missing or invalid. Reload and try again." });
    }
    next();
  };

  const registerRoutes = (app) => {
    app.use(parseCookies);
    app.get("/api/auth/csrf", (req, res) => {
      const value = req.authCookies.csrf ?? randomBytes(32).toString("base64url");
      if (!req.authCookies.csrf) res.cookie("csrf_token", value, {
        httpOnly: false, secure: env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 30 * 86400 * 1000,
      });
      res.json({ csrfToken: value });
    });


    app.post("/api/auth/signup", csrf, async (req, res, next) => {
      const parsed = signupSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Signup details are invalid." });
      if (!validateEmailRateLimit(parsed.data.email, "signup")) return res.status(429).json({ error: "Too many signup attempts. Try again later." });
      if (emailServiceUnavailable(res)) return;
      try {
        if (await db.userByEmail(parsed.data.email)) return res.status(409).json({ error: "An account with this email already exists." });
        const isFirstUser = await db.userCount() === 0;
    
        const user = {
          id: randomUUID(),
          name: parsed.data.name,
          email: parsed.data.email,
          passwordHash: await bcrypt.hash(parsed.data.password, 12),
          createdAt: new Date().toISOString(),
          legacyDataOwner: isFirstUser,
        };
  
        await db.createUser(user);
        if (isFirstUser) await db.claimLegacyData(user.id);
        const token = randomBytes(32).toString("base64url");
        await db.addAuthToken({ tokenHash: hashSecret(token), userId: user.id, purpose: "verify-email", expiresAt: Date.now() + VERIFICATION_MS });
        await mailer.sendVerification(user.email, originUrl(baseUrl, `/verify-email/${encodeURIComponent(token)}`));
        res.status(201).json({ user: safeUser(await db.userById(user.id)), emailVerificationRequired: true, legacyDataOwner: isFirstUser });
      } catch (error) {
        if (error?.code === "P2002") return res.status(409).json({ error: "An account with this email already exists." });
        next(error);
      }
    });
    
    app.post("/api/auth/login", csrf, async (req, res, next) => {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Enter a valid email and password." });
      const { email, password, rememberMe } = parsed.data;
      if (!validateEmailRateLimit(email, "login")) return res.status(429).json({ error: "Too many attempts. Try again later." });
      try {
        const user = await db.userByEmail(email);
        const dummyHash = await dummyHashPromise;
        const matches = await bcrypt.compare(password, user?.password_hash ?? dummyHash);
        if (!user || !matches || user.locked_until > Date.now()) {
          if (user && user.locked_until <= Date.now() && !matches) {
            const attempts = Number(user.failed_attempts) + 1;
            await db.updateUser(user.id, { failedAttempts: attempts, lockedUntil: attempts >= MAX_FAILURES ? Date.now() + LOCK_MS : 0 });
          }
          await new Promise((resolve) => setTimeout(resolve, 120));
          return res.status(401).json({ error: "Invalid email or password." });
        }
        await db.updateUser(user.id, { failedAttempts: 0, lockedUntil: 0, lastLoginAt: new Date().toISOString() });
        const current = await db.userById(user.id);
        await issueSession(res, current, req, rememberMe);
        await db.addAuditEvent({ userId: user.id, action: "login", createdAt: new Date().toISOString(), ipAddress: String(req.ip ?? "").slice(0, 80) });
        res.json({ user: safeUser(current) });
      } catch (error) { next(error); }
    });


    app.post("/api/auth/logout", csrf, async (req, res, next) => {
      try {
        if (req.authCookies.refresh) {
          const session = await db.sessionByRefreshHash(hashSecret(req.authCookies.refresh));
          if (session) await db.removeAuthSession(session.id, session.user_id);
        }
        clearSessionCookies(res, env);
        res.status(204).end();
      } catch (error) { next(error); }
    });
    app.post("/api/auth/refresh", csrf, async (req, res, next) => {
      try {
      const refreshToken = req.authCookies.refresh;
      if (!refreshToken) {
        clearSessionCookies(res, env);
        return res.status(401).json({ error: "Session expired. Please sign in again." });
      }
      const tokenHash = hashSecret(refreshToken);
      const session = await db.sessionByRefreshHash(tokenHash);
      if (!session) {
        clearSessionCookies(res, env);
        return res.status(401).json({ error: "Session expired. Please sign in again." });
      }
      if (session.refresh_reused) {
        await db.removeAuthSession(session.id, session.user_id);
        clearSessionCookies(res, env);
        return res.status(401).json({ error: "Session expired. Please sign in again." });
      }
      if (session.expires_at <= Date.now()) {
        await db.removeAuthSession(session.id);
        clearSessionCookies(res, env);
        return res.status(401).json({ error: "Session expired. Please sign in again." });
      }
      const user = await db.userById(session.user_id);
      if (!user) {
        await db.removeAuthSession(session.id);
        clearSessionCookies(res, env);
        return res.status(401).json({ error: "Session expired. Please sign in again." });
      }
      const nextRefresh = newRefreshToken();
      const now = new Date().toISOString();
      const rememberMe = session.expires_at - Date.parse(session.created_at) > (NORMAL_SESSION_DAYS + 2) * 86400 * 1000;
      const durationDays = rememberMe ? REMEMBERED_SESSION_DAYS : NORMAL_SESSION_DAYS;
      const rotated = await db.rotateAuthSession(session.id, tokenHash, hashSecret(nextRefresh), Date.now() + durationDays * 86400 * 1000, now);
      if (!rotated) {
        clearSessionCookies(res, env);
        return res.status(401).json({ error: "Session expired. Please sign in again." });
      }
      setSessionCookies(res, env, issueAccessToken(user.id, session.id, env), nextRefresh, rememberMe);
      res.json({ user: safeUser(user) });
      } catch (error) { next(error); }
    });
    app.get("/api/auth/me", requireAuth, (req, res) => res.json({ user: safeUser(req.auth.user) }));
    app.post("/api/auth/verify-email", csrf, async (req, res, next) => {
      try {
      const parsed = tokenSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Verification link is invalid or expired." });
      const token = await db.consumeAuthToken(hashSecret(parsed.data.token), "verify-email", Date.now());
      if (!token) return res.status(400).json({ error: "Verification link is invalid or expired." });
      await db.updateUser(token.user_id, { emailVerified: true });
      res.json({ message: "Email verified. You can now use all features." });
      } catch (error) { next(error); }
    });
    app.post("/api/auth/resend-verification", requireAuth, csrf, async (req, res, next) => {
      if (emailServiceUnavailable(res)) return;
      try {
        const user = await db.userById(req.auth.userId);
        if (!validateEmailRateLimit(user.email, "verification")) return res.status(429).json({ error: "Too many verification emails. Try again later." });
        if (!user.email_verified) {
          await db.removeUserTokens(user.id, "verify-email");
          const token = randomBytes(32).toString("base64url");
          await db.addAuthToken({ tokenHash: hashSecret(token), userId: user.id, purpose: "verify-email", expiresAt: Date.now() + VERIFICATION_MS });
          await mailer.sendVerification(user.email, originUrl(baseUrl, `/verify-email/${encodeURIComponent(token)}`));
        }
        res.json({ message: "If verification is needed, a new link has been sent." });
      } catch (error) { next(error); }
    });
    app.post("/api/auth/forgot-password", csrf, async (req, res, next) => {
      const parsed = emailOnlySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Enter a valid email address." });
      if (!validateEmailRateLimit(parsed.data.email, "reset")) return res.status(429).json({ error: "Too many requests. Try again later." });
      if (emailServiceUnavailable(res)) return;
      try {
        const user = await db.userByEmail(parsed.data.email);
        if (user) {
          await db.removeUserTokens(user.id, "reset-password");
          const token = randomBytes(32).toString("base64url");
          await db.addAuthToken({ tokenHash: hashSecret(token), userId: user.id, purpose: "reset-password", expiresAt: Date.now() + PASSWORD_RESET_MS });
          await mailer.sendPasswordReset(user.email, originUrl(baseUrl, `/reset-password/${encodeURIComponent(token)}`, token));
        }
        res.json({ message: "If the account exists, we sent a password reset link." });
      } catch (error) { next(error); }
    });
    app.post("/api/auth/reset-password", csrf, async (req, res, next) => {
      const parsed = resetPasswordSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Reset details are invalid." });
      try {
        const token = await db.consumeAuthToken(hashSecret(parsed.data.token), "reset-password", Date.now());
        if (!token) return res.status(400).json({ error: "Reset link is invalid, expired, or already used." });
        await db.updateUser(token.user_id, { passwordHash: await bcrypt.hash(parsed.data.password, 12), failedAttempts: 0, lockedUntil: 0 });
        const sessions = await db.authSessions(token.user_id);
        for (const session of sessions) await db.removeAuthSession(session.id, token.user_id);
        await db.removeUserTokens(token.user_id);
        await db.addAuditEvent({ userId: token.user_id, action: "password_reset", createdAt: new Date().toISOString(), ipAddress: String(req.ip ?? "").slice(0, 80) });
        res.json({ message: "Password reset complete. Please log in." });
      } catch (error) { next(error); }
    });
    app.patch("/api/auth/profile", requireAuth, csrf, async (req, res, next) => {
      try {
      const parsed = profileSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Profile details are invalid." });
      await db.updateUser(req.auth.userId, { name: parsed.data.name });
      res.json({ user: safeUser(await db.userById(req.auth.userId)) });
      } catch (error) { next(error); }
    });
    app.post("/api/auth/change-password", requireAuth, csrf, async (req, res, next) => {
      try {
      const parsed = changePasswordSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Password details are invalid." });
      if (!await bcrypt.compare(parsed.data.currentPassword, req.auth.user.password_hash)) return res.status(400).json({ error: "Current password is incorrect." });
      await db.updateUser(req.auth.userId, { passwordHash: await bcrypt.hash(parsed.data.newPassword, 12) });
      await db.removeOtherAuthSessions(req.auth.userId, req.auth.sessionId);
      await db.addAuditEvent({ userId: req.auth.userId, action: "password_change", createdAt: new Date().toISOString(), ipAddress: String(req.ip ?? "").slice(0, 80) });
      res.json({ message: "Password updated. Other devices have been signed out." });
      } catch (error) { next(error); }
    });
    app.get("/api/auth/sessions", requireAuth, async (req, res, next) => {
      try {
      res.json({ sessions: (await db.authSessions(req.auth.userId)).map((session) => ({
        id: session.id, createdAt: session.created_at, lastUsedAt: session.last_used_at,
        userAgent: session.user_agent, current: session.id === req.auth.sessionId,
      })) });
      } catch (error) { next(error); }
    });
    app.delete("/api/auth/sessions/:id", requireAuth, csrf, async (req, res, next) => {
      try {
      if (req.params.id === req.auth.sessionId) return res.status(400).json({ error: "Use Log out to end the current session." });
      await db.removeAuthSession(req.params.id, req.auth.userId);
      res.status(204).end();
      } catch (error) { next(error); }
    });
    app.post("/api/auth/logout-all", requireAuth, csrf, async (req, res, next) => {
      try {
        for (const session of await db.authSessions(req.auth.userId)) await db.removeAuthSession(session.id, req.auth.userId);
        clearSessionCookies(res, env);
        res.status(204).end();
      } catch (error) { next(error); }
    });
    app.delete("/api/auth/account", requireAuth, csrf, async (req, res, next) => {
      const parsed = deleteAccountSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Enter your current password to delete the account." });
      if (!await bcrypt.compare(parsed.data.password, req.auth.user.password_hash)) return res.status(400).json({ error: "Password is incorrect." });
      try {
        const uploadsUserDirectory = path.join(uploadsDirectory, req.auth.userId);
        await mkdir(uploadsDirectory, { recursive: true });
        await rm(uploadsUserDirectory, { recursive: true, force: true });
        await db.deleteUser(req.auth.userId);
        clearSessionCookies(res, env);
        res.status(204).end();
      } catch (error) { next(error); }
    });
    if (env.NODE_ENV !== "production" && typeof mailer.takeDevelopmentMessage === "function") {
      app.get("/api/dev-mailbox/:email", (req, res) => {
        if (req.ip !== "127.0.0.1" && req.ip !== "::ffff:127.0.0.1" && req.ip !== "::1") return res.status(404).end();
        const message = mailer.takeDevelopmentMessage(req.params.email.toLowerCase());
        res.json(message ? { purpose: message.purpose, url: message.url } : { message: "No queued development mail." });
      });
    }
  };

  return { registerRoutes, requireAuth, requireVerified, csrf };
}

export { parseCookies, hash as hashAuthToken, ACCESS_SECONDS };
