// @vitest-environment node
import { createHmac, randomUUID } from "node:crypto";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAuthService } from "./service.mjs";
import { createDatabase } from "../data/database.mjs";

const env = {
  NODE_ENV: "test",
  JWT_ACCESS_SECRET: "test-access-secret-that-is-at-least-thirty-two-characters",
  TOKEN_HASH_SECRET: "test-token-secret-that-is-at-least-thirty-two-characters",
};
const frontendOrigin = "http://localhost:5173";
let db;
let server;
let baseUrl;
let uploadsDirectory;
const messages = new Map();

function hashToken(token) {
  return createHmac("sha256", env.TOKEN_HASH_SECRET).update(token).digest("hex");
}

function createClient() {
  const cookies = new Map();
  const updateCookies = (response) => {
    const records = response.headers.getSetCookie?.() ?? [];
    for (const record of records) {
      const [pair] = record.split(";");
      const separator = pair.indexOf("=");
      if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  };
  const call = async (path, { method = "GET", body, csrf = true } = {}) => {
    const headers = { origin: frontendOrigin };
    if (cookies.size) headers.cookie = [...cookies].map(([key, value]) => `${key}=${value}`).join("; ");
    if (body !== undefined) headers["content-type"] = "application/json";
    if (csrf && !["GET", "HEAD"].includes(method)) headers["x-csrf-token"] = cookies.get("csrf_token") ?? "";
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    updateCookies(response);
    return response;
  };
  return {
    call,
    cookies,
    async init() { await call("/api/auth/csrf"); },
  };
}

function newSignup(email = `person-${randomUUID()}@example.test`) {
  return {
    name: "Test Person",
    email,
    password: "A-strong-test-password-42",
    confirmPassword: "A-strong-test-password-42",
    acceptTerms: true,
  };
}

function tokenFromMessage(email) {
  const message = messages.get(email);
  if (!message) throw new Error("Expected development test mail was not queued.");
  return decodeURIComponent(new URL(message.url).pathname.split("/").pop());
}

beforeAll(async () => {
  uploadsDirectory = await mkdtemp(path.join(os.tmpdir(), "say-it-auth-uploads-"));
  db = await createDatabase({ filename: ":memory:", seedData: false });
  const mailer = {
    async sendVerification(email, url) { messages.set(email, { purpose: "verification", url }); },
    async sendPasswordReset(email, url) { messages.set(email, { purpose: "reset", url }); },
  };
  const auth = createAuthService({ db, mailer, env, baseUrl: frontendOrigin, uploadsDirectory });
  const app = express();
  app.use(express.json());
  auth.registerRoutes(app);
  app.use("/api/private", auth.requireAuth);
  app.get("/api/private/users/:id/interviews/:recordId", (req, res) => {
    const item = db.userScoped(req.auth.userId).get("interviews", req.params.recordId);
    if (!item) return res.status(404).json({ error: "Not found." });
    res.json(item);
  });
  server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  db?.close();
  if (uploadsDirectory) await rm(uploadsDirectory, { recursive: true, force: true });
});

describe("authentication HTTP flows", () => {
  it("validates signup, verifies email, logs in, updates the profile, and logs out", async () => {
    const client = createClient();
    await client.init();
    const signup = newSignup("  ALICE@example.test ");
    const invalid = await client.call("/api/auth/signup", { method: "POST", body: { ...signup, password: "password123" } });
    expect(invalid.status).toBe(400);

    const createdResponse = await client.call("/api/auth/signup", { method: "POST", body: signup });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json();
    expect(created.user.email).toBe("alice@example.test");
    expect(created.user.emailVerified).toBe(false);
    expect(JSON.stringify(created)).not.toMatch(/passwordHash|password_hash|A-strong-test-password/);
    const login = await client.call("/api/auth/login", {
      method: "POST",
      body: { email: "ALICE@example.test", password: signup.password, rememberMe: true },
    });
    expect(login.status).toBe(200);
    const originalToken = tokenFromMessage("alice@example.test");
    expect((await client.call("/api/auth/resend-verification", { method: "POST" })).status).toBe(200);
    expect((await client.call("/api/auth/verify-email", { method: "POST", body: { token: originalToken } })).status).toBe(400);
    const token = tokenFromMessage("alice@example.test");
    expect((await client.call("/api/auth/verify-email", { method: "POST", body: { token } })).status).toBe(200);
    expect((await client.call("/api/auth/verify-email", { method: "POST", body: { token } })).status).toBe(400);

    expect(client.cookies.has("access_token")).toBe(true);
    expect(client.cookies.has("refresh_token")).toBe(true);
    const me = await client.call("/api/auth/me");
    expect((await me.json()).user.emailVerified).toBe(true);

    const noCsrf = await client.call("/api/auth/profile", { method: "PATCH", body: { name: "Blocked" }, csrf: false });
    expect(noCsrf.status).toBe(403);
    const profile = await client.call("/api/auth/profile", { method: "PATCH", body: { name: "Updated Alice" } });
    expect((await profile.json()).user.name).toBe("Updated Alice");
    expect((await client.call("/api/auth/sessions")).status).toBe(200);
    const changedPassword = "Changed-strong-password-2026";
    expect((await client.call("/api/auth/change-password", {
      method: "POST",
      body: { currentPassword: signup.password, newPassword: changedPassword, confirmPassword: changedPassword },
    })).status).toBe(200);
    expect((await client.call("/api/auth/login", { method: "POST", body: { email: "alice@example.test", password: signup.password } })).status).toBe(401);
    expect((await client.call("/api/auth/logout", { method: "POST" })).status).toBe(204);
    expect((await client.call("/api/auth/me")).status).toBe(401);
  }, 30_000);

  it("rotates refresh tokens and revokes a session when a rotated token is reused", async () => {
    const email = `rotation-${randomUUID()}@example.test`;
    const client = createClient();
    await client.init();
    const signup = newSignup(email);
    await client.call("/api/auth/signup", { method: "POST", body: signup });
    await client.call("/api/auth/verify-email", { method: "POST", body: { token: tokenFromMessage(email) } });
    expect((await client.call("/api/auth/login", { method: "POST", body: { email, password: signup.password } })).status).toBe(200);
    const oldRefreshToken = client.cookies.get("refresh_token");
    expect((await client.call("/api/auth/refresh", { method: "POST" })).status).toBe(200);
    expect(client.cookies.get("refresh_token")).not.toBe(oldRefreshToken);
    client.cookies.set("refresh_token", oldRefreshToken);
    expect((await client.call("/api/auth/refresh", { method: "POST" })).status).toBe(401);
    expect(db.authSessions(db.userByEmail(email).id)).toHaveLength(0);
  }, 30_000);

  it("returns generic login errors and locks an account after ten bad passwords", async () => {
    const email = `lock-${randomUUID()}@example.test`;
    const signup = newSignup(email);
    const client = createClient();
    await client.init();
    await client.call("/api/auth/signup", { method: "POST", body: signup });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await client.call("/api/auth/login", { method: "POST", body: { email, password: "wrong-password-123" } });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Invalid email or password." });
    }
    expect(db.userByEmail(email).failed_attempts).toBe(10);
    expect(db.userByEmail(email).locked_until).toBeGreaterThan(Date.now());
    const locked = await client.call("/api/auth/login", { method: "POST", body: { email, password: signup.password } });
    expect(locked.status).toBe(401);
    expect(await locked.json()).toEqual({ error: "Invalid email or password." });
  }, 30_000);

  it("keeps forgot-password responses generic and enforces single-use and expiry", async () => {
    const email = `reset-${randomUUID()}@example.test`;
    const signup = newSignup(email);
    const client = createClient();
    await client.init();
    await client.call("/api/auth/signup", { method: "POST", body: signup });
    const forgotKnown = await client.call("/api/auth/forgot-password", { method: "POST", body: { email } });
    const forgotUnknown = await client.call("/api/auth/forgot-password", { method: "POST", body: { email: `absent-${randomUUID()}@example.test` } });
    expect(await forgotKnown.json()).toEqual(await forgotUnknown.json());
    const token = tokenFromMessage(email);
    const changedPassword = "Another-strong-password-2026";
    const reset = { token, password: changedPassword, confirmPassword: changedPassword };
    expect((await client.call("/api/auth/reset-password", { method: "POST", body: reset })).status).toBe(200);
    expect((await client.call("/api/auth/reset-password", { method: "POST", body: reset })).status).toBe(400);
    expect((await client.call("/api/auth/login", { method: "POST", body: { email, password: changedPassword } })).status).toBe(200);

    const user = db.userByEmail(email);
    const expiredToken = randomUUID() + randomUUID();
    await db.addAuthToken({ tokenHash: hashToken(expiredToken), userId: user.id, purpose: "reset-password", expiresAt: Date.now() - 1 });
    expect((await client.call("/api/auth/reset-password", { method: "POST", body: { ...reset, token: expiredToken } })).status).toBe(400);
  }, 30_000);

  it("isolates records and deletes the user's database data with password confirmation", async () => {
    const aliceEmail = `isolation-a-${randomUUID()}@example.test`;
    const bobEmail = `isolation-b-${randomUUID()}@example.test`;
    const alice = createClient();
    const bob = createClient();
    await Promise.all([alice.init(), bob.init()]);
    const aliceSignup = newSignup(aliceEmail);
    const bobSignup = newSignup(bobEmail);
    await alice.call("/api/auth/signup", { method: "POST", body: aliceSignup });
    await bob.call("/api/auth/signup", { method: "POST", body: bobSignup });
    await alice.call("/api/auth/login", { method: "POST", body: { email: aliceEmail, password: aliceSignup.password } });
    await bob.call("/api/auth/login", { method: "POST", body: { email: bobEmail, password: bobSignup.password } });
    const aliceUser = db.userByEmail(aliceEmail);
    const record = { id: randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), companyName: "Private Co" };
    await db.userScoped(aliceUser.id).put("interviews", record);
    const aliceUploads = path.join(uploadsDirectory, aliceUser.id);
    await mkdir(aliceUploads, { recursive: true });
    const privateFile = path.join(aliceUploads, "private.svg");
    await writeFile(privateFile, "<svg />");
    const privatePath = `/api/private/users/${aliceUser.id}/interviews/${record.id}`;
    expect((await alice.call(privatePath)).status).toBe(200);
    expect((await bob.call(privatePath)).status).toBe(404);

    const wrongPassword = await alice.call("/api/auth/account", { method: "DELETE", body: { password: "not-the-password" } });
    expect(wrongPassword.status).toBe(400);
    const deleted = await alice.call("/api/auth/account", { method: "DELETE", body: { password: aliceSignup.password } });
    expect(deleted.status).toBe(204);
    expect(db.userByEmail(aliceEmail)).toBeNull();
    expect(db.userScoped(aliceUser.id).all("interviews")).toEqual([]);
    await expect(access(privateFile)).rejects.toThrow();
    expect((await bob.call(privatePath)).status).toBe(404);
  });

  it("lists and revokes active sessions and logs out all devices", async () => {
    const email = `sessions-${randomUUID()}@example.test`;
    const signup = newSignup(email);
    const first = createClient();
    const second = createClient();
    await Promise.all([first.init(), second.init()]);
    await first.call("/api/auth/signup", { method: "POST", body: signup });
    await first.call("/api/auth/login", { method: "POST", body: { email, password: signup.password } });
    await second.call("/api/auth/login", { method: "POST", body: { email, password: signup.password } });
    const sessions = await first.call("/api/auth/sessions").then((response) => response.json());
    expect(sessions.sessions).toHaveLength(2);
    const other = sessions.sessions.find((session) => !session.current);
    expect((await first.call(`/api/auth/sessions/${other.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await first.call("/api/auth/logout-all", { method: "POST" })).status).toBe(204);
    expect((await first.call("/api/auth/me")).status).toBe(401);
    expect((await second.call("/api/auth/me")).status).toBe(401);
  }, 30_000);
});
