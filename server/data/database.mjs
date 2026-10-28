import initSqlJs from "sql.js";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const directory = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(await readFile(path.join(directory, "seed.json"), "utf8"));
const wasmPath = fileURLToPath(import.meta.resolve("sql.js/dist/sql-wasm.wasm"));
const REFRESH_HISTORY_MS = 30 * 86400 * 1000;

export async function createDatabase({ filename = process.env.APP_DATABASE ?? path.join(directory, "app.sqlite"), seedData = true } = {}) {
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  let database;
  if (filename === ":memory:") database = new SQL.Database();
  else {
    await mkdir(path.dirname(filename), { recursive: true });
    try {
      database = new SQL.Database(new Uint8Array(await readFile(filename)));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      database = new SQL.Database();
    }
  }
  database.run(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS interviews (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_refresh_history (
      token_hash TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS interviews_updated_at ON interviews(updated_at);
    CREATE TABLE IF NOT EXISTS study_items (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      topic TEXT NOT NULL,
      question TEXT NOT NULL,
      bookmarked INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS study_items_topic ON study_items(topic);
    CREATE INDEX IF NOT EXISTS study_items_updated_at ON study_items(updated_at);
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      email_verified INTEGER NOT NULL DEFAULT 0,
      legacy_data_owner INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_login_at TEXT,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      refresh_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      last_used_at TEXT NOT NULL,
      user_agent TEXT NOT NULL,
      ip_address TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id);
    CREATE TABLE IF NOT EXISTS auth_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      purpose TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS auth_tokens_user ON auth_tokens(user_id);
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      created_at TEXT NOT NULL,
      ip_address TEXT NOT NULL
    );
  `);
  const ensureColumn = (table, column, definition) => {
    const columns = database.exec(`PRAGMA table_info(${table})`)[0]?.values ?? [];
    if (!columns.some((entry) => entry[1] === column)) database.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };
  ensureColumn("interviews", "user_id", "TEXT");
  ensureColumn("study_items", "user_id", "TEXT");
  ensureColumn("users", "legacy_data_owner", "INTEGER NOT NULL DEFAULT 0");

  let persistChain = Promise.resolve();
  const persist = () => {
    if (filename === ":memory:") return;
    const snapshot = Buffer.from(database.export());
    const temporaryFile = `${filename}.${randomUUID()}.tmp`;
    persistChain = persistChain.catch(() => {}).then(async () => {
      await writeFile(temporaryFile, snapshot);
      await rename(temporaryFile, filename);
    }).catch(async (error) => {
      await import("node:fs/promises").then(({ unlink }) => unlink(temporaryFile)).catch(() => {});
      throw error;
    });
    return persistChain;
  };
  const all = (table, userId = undefined) => {
    if (!["interviews", "study_items"].includes(table)) throw new Error("Unknown table");
    const statement = database.prepare(`SELECT data FROM ${table} WHERE user_id ${userId === undefined ? "IS NULL" : "= ?"} ORDER BY updated_at DESC`);
    const rows = [];
    try {
      if (userId !== undefined) statement.bind([userId]);
      while (statement.step()) rows.push(JSON.parse(statement.getAsObject().data));
    } finally {
      statement.free();
    }
    return rows;
  };
  const get = (table, id, userId = undefined) => {
    if (!["interviews", "study_items"].includes(table)) throw new Error("Unknown table");
    const statement = database.prepare(`SELECT data FROM ${table} WHERE id = ? AND user_id ${userId === undefined ? "IS NULL" : "= ?"}`);
    try {
      statement.bind(userId === undefined ? [id] : [id, userId]);
      return statement.step() ? JSON.parse(statement.getAsObject().data) : null;
    } finally {
      statement.free();
    }
  };
  const put = async (table, record, userId = record.userId ?? null) => {
    const owner = queryOne(`SELECT user_id FROM ${table} WHERE id = ?`, [record.id]);
    if (owner && owner.user_id !== userId) throw new Error("Record not found.");
    if (table === "interviews") {
      database.run(
        "INSERT INTO interviews (id, user_id, created_at, updated_at, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id, updated_at=excluded.updated_at, data=excluded.data",
        [record.id, userId, record.createdAt, record.updatedAt, JSON.stringify({ ...record, userId })],
      );
    } else if (table === "study_items") {
      database.run(
        "INSERT INTO study_items (id, user_id, created_at, updated_at, topic, question, bookmarked, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id, updated_at=excluded.updated_at, topic=excluded.topic, question=excluded.question, bookmarked=excluded.bookmarked, data=excluded.data",
        [record.id, userId, record.createdAt, record.updatedAt, record.topic, record.question, record.bookmarked ? 1 : 0, JSON.stringify({ ...record, userId })],
      );
    } else throw new Error("Unknown table");
    await persist();
    return record;
  };
  const remove = async (table, id, userId = undefined) => {
    if (!["interviews", "study_items"].includes(table)) throw new Error("Unknown table");
    database.run(`DELETE FROM ${table} WHERE id = ? AND user_id ${userId === undefined ? "IS NULL" : "= ?"}`, userId === undefined ? [id] : [id, userId]);
    await persist();
  };
  const clear = async (userId = undefined) => {
    database.run("BEGIN IMMEDIATE");
    try {
      if (userId === undefined) {
        database.run("DELETE FROM interviews WHERE user_id IS NULL");
        database.run("DELETE FROM study_items WHERE user_id IS NULL");
      } else {
        database.run("DELETE FROM interviews WHERE user_id = ?", [userId]);
        database.run("DELETE FROM study_items WHERE user_id = ?", [userId]);
      }
      database.run("COMMIT");
    } catch (error) {
      database.run("ROLLBACK");
      throw error;
    }
    await persist();
  };
  const userScoped = (userId) => ({
    all: (table) => all(table, userId),
    get: (table, id) => get(table, id, userId),
    put: (table, record) => put(table, record, userId),
    remove: (table, id) => remove(table, id, userId),
    clear: () => clear(userId),
  });
  const createUser = async ({ id, name, email, passwordHash, createdAt, legacyDataOwner = false }) => {
    database.run(
      "INSERT INTO users (id, name, email, password_hash, email_verified, legacy_data_owner, created_at, last_login_at, failed_attempts, locked_until) VALUES (?, ?, ?, ?, 0, ?, ?, NULL, 0, 0)",
      [id, name, email, passwordHash, Number(legacyDataOwner), createdAt],
    );
    await persist();
  };
  const userByEmail = (email) => queryOne("SELECT * FROM users WHERE email = ?", [email]);
  const userById = (id) => queryOne("SELECT * FROM users WHERE id = ?", [id]);
  const updateUser = async (id, fields) => {
    const allowed = { name: "name", passwordHash: "password_hash", emailVerified: "email_verified", lastLoginAt: "last_login_at", failedAttempts: "failed_attempts", lockedUntil: "locked_until" };
    const entries = Object.entries(fields).filter(([key]) => allowed[key]);
    if (!entries.length) return;
    database.run(`UPDATE users SET ${entries.map(([key]) => `${allowed[key]} = ?`).join(", ")} WHERE id = ?`, [...entries.map(([key, value]) => key === "emailVerified" ? Number(value) : value), id]);
    await persist();
  };
  const deleteUser = async (id) => {
    database.run("BEGIN IMMEDIATE");
    try {
      database.run("DELETE FROM interviews WHERE user_id = ?", [id]);
      database.run("DELETE FROM study_items WHERE user_id = ?", [id]);
      database.run("DELETE FROM auth_refresh_history WHERE session_id IN (SELECT id FROM auth_sessions WHERE user_id = ?)", [id]);
      database.run("DELETE FROM auth_sessions WHERE user_id = ?", [id]);
      database.run("DELETE FROM auth_tokens WHERE user_id = ?", [id]);
      database.run("DELETE FROM audit_events WHERE user_id = ?", [id]);
      database.run("DELETE FROM users WHERE id = ?", [id]);
      database.run("COMMIT");
    } catch (error) {
      database.run("ROLLBACK");
      throw error;
    }
    await persist();
  };
  const userCount = () => Number(database.exec("SELECT COUNT(*) FROM users")[0]?.values[0]?.[0] ?? 0);
  const allUsers = () => queryMany("SELECT * FROM users ORDER BY created_at ASC");
  const claimLegacyData = async (userId) => {
    database.run("UPDATE interviews SET user_id = ? WHERE user_id IS NULL", [userId]);
    database.run("UPDATE study_items SET user_id = ? WHERE user_id IS NULL", [userId]);
    for (const table of ["interviews", "study_items"]) {
      const statement = database.prepare(`SELECT id, data FROM ${table} WHERE user_id = ?`);
      try {
        statement.bind([userId]);
        const updates = [];
        while (statement.step()) updates.push(statement.getAsObject());
        for (const item of updates) {
          const value = { ...JSON.parse(item.data), userId };
          database.run(`UPDATE ${table} SET data = ? WHERE id = ?`, [JSON.stringify(value), item.id]);
        }
      } finally { statement.free(); }
    }
    await persist();
  };
  const createAuthSession = async (session) => {
    database.run("INSERT INTO auth_sessions (id, user_id, refresh_hash, created_at, expires_at, last_used_at, user_agent, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [session.id, session.userId, session.refreshHash, session.createdAt, session.expiresAt, session.lastUsedAt, session.userAgent, session.ipAddress]);
    await persist();
  };
  const authSession = (id) => queryOne("SELECT * FROM auth_sessions WHERE id = ?", [id]);
  const sessionByRefreshHash = (tokenHash) => {
    const active = queryOne("SELECT * FROM auth_sessions WHERE refresh_hash = ?", [tokenHash]);
    if (active) return { ...active, refresh_reused: false };
    const previous = queryOne("SELECT auth_sessions.*, 1 AS refresh_reused FROM auth_refresh_history JOIN auth_sessions ON auth_sessions.id = auth_refresh_history.session_id WHERE auth_refresh_history.token_hash = ? AND auth_refresh_history.expires_at > ?", [tokenHash, Date.now()]);
    return previous ?? null;
  };
  const authSessions = (userId) => queryMany("SELECT * FROM auth_sessions WHERE user_id = ? ORDER BY last_used_at DESC", [userId]);
  const rotateAuthSession = async (id, previousHash, refreshHash, expiresAt, lastUsedAt) => {
    database.run("BEGIN IMMEDIATE");
    let committed = false;
    try {
      database.run("INSERT OR REPLACE INTO auth_refresh_history (token_hash, session_id, expires_at) SELECT refresh_hash, id, ? FROM auth_sessions WHERE id = ? AND refresh_hash = ?", [Date.now() + REFRESH_HISTORY_MS, id, previousHash]);
      database.run("UPDATE auth_sessions SET refresh_hash = ?, expires_at = ?, last_used_at = ? WHERE id = ? AND refresh_hash = ?", [refreshHash, expiresAt, lastUsedAt, id, previousHash]);
      if (database.getRowsModified() !== 1) {
        database.run("ROLLBACK");
        return false;
      }
      database.run("COMMIT");
      committed = true;
    } catch (error) {
      if (!committed) database.run("ROLLBACK");
      throw error;
    }
    await persist();
    return true;
  };
  const removeAuthSession = async (id, userId = undefined) => {
    database.run(`DELETE FROM auth_sessions WHERE id = ?${userId === undefined ? "" : " AND user_id = ?"}`, userId === undefined ? [id] : [id, userId]);
    database.run("DELETE FROM auth_refresh_history WHERE session_id = ?", [id]);
    await persist();
  };
  const removeOtherAuthSessions = async (userId, exceptId) => {
    database.run("DELETE FROM auth_sessions WHERE user_id = ? AND id != ?", [userId, exceptId]);
    database.run("DELETE FROM auth_refresh_history WHERE session_id NOT IN (SELECT id FROM auth_sessions)");
    await persist();
  };
  const addAuthToken = async ({ tokenHash, userId, purpose, expiresAt }) => {
    database.run("INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)", [tokenHash, userId, purpose, expiresAt]);
    await persist();
  };
  const consumeAuthToken = async (tokenHash, purpose, now) => {
    const row = queryOne("SELECT * FROM auth_tokens WHERE token_hash = ? AND purpose = ? AND expires_at > ?", [tokenHash, purpose, now]);
    if (!row) {
      database.run("DELETE FROM auth_tokens WHERE token_hash = ?", [tokenHash]);
      await persist();
      return null;
    }
    database.run("DELETE FROM auth_tokens WHERE token_hash = ?", [tokenHash]);
    await persist();
    return row;
  };
  const removeUserTokens = async (userId, purpose = undefined) => {
    database.run(`DELETE FROM auth_tokens WHERE user_id = ?${purpose ? " AND purpose = ?" : ""}`, purpose ? [userId, purpose] : [userId]);
    await persist();
  };
  const addAuditEvent = async ({ userId, action, createdAt, ipAddress }) => {
    database.run("INSERT INTO audit_events (id, user_id, action, created_at, ip_address) VALUES (?, ?, ?, ?, ?)", [randomUUID(), userId, action, createdAt, ipAddress]);
    await persist();
  };
  const queryOne = (sql, params = []) => queryMany(sql, params)[0] ?? null;
  const queryMany = (sql, params = []) => {
    const statement = database.prepare(sql);
    const rows = [];
    try {
      if (params.length) statement.bind(params);
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally { statement.free(); }
  };
  const close = () => database.close();

  if (seedData) {
    const count = database.exec("SELECT (SELECT COUNT(*) FROM interviews) + (SELECT COUNT(*) FROM study_items) AS count")[0]?.values[0]?.[0] ?? 0;
    if (count === 0) {
      const now = new Date().toISOString();
      for (const [index, raw] of seed.interviews.entries()) {
        const record = { ...raw, rounds: raw.rounds.map((round) => ({ ...round, id: randomUUID() })), questions: raw.questions.map((question) => ({ ...question, id: randomUUID() })), hr: raw.hr, offerDetails: raw.offerDetails, id: randomUUID(), createdAt: now, updatedAt: now };
        database.run("INSERT INTO interviews (id, created_at, updated_at, data) VALUES (?, ?, ?, ?)", [record.id, now, now, JSON.stringify(record)]);
      }
      for (const raw of seed.studyItems) {
        const record = { ...raw, diagram: raw.diagram ?? null, id: randomUUID(), createdAt: now, updatedAt: now, lastReviewed: null, nextReviewAt: null, sourceInterviewId: "" };
        database.run(
          "INSERT INTO study_items (id, created_at, updated_at, topic, question, bookmarked, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [record.id, now, now, record.topic, record.question, record.bookmarked ? 1 : 0, JSON.stringify(record)],
        );
      }
      await persist();
    }
  }

  return {
    all, get, put, remove, clear, userScoped, createUser, userByEmail, userById, updateUser, deleteUser,
    userCount, allUsers, claimLegacyData, createAuthSession, authSession, authSessions, rotateAuthSession,
    sessionByRefreshHash, removeAuthSession, removeOtherAuthSessions, addAuthToken, consumeAuthToken, removeUserTokens,
    addAuditEvent, close, filename,
  };
}
