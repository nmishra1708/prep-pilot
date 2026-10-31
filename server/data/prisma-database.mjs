import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis;
const prisma = globalForPrisma.__sayItSeeItPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.__sayItSeeItPrisma = prisma;

function date(value) {
  return value instanceof Date ? value : new Date(value);
}

function userShape(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    password_hash: user.passwordHash,
    email_verified: Number(user.emailVerified),
    legacy_data_owner: Number(user.legacyDataOwner),
    created_at: user.createdAt.toISOString(),
    last_login_at: user.lastLoginAt?.toISOString() ?? null,
    failed_attempts: user.failedAttempts,
    locked_until: Number(user.lockedUntil),
  };
}

function sessionShape(session, refreshReused = false) {
  if (!session) return null;
  return {
    id: session.id,
    user_id: session.userId,
    refresh_hash: session.refreshHash,
    created_at: session.createdAt.toISOString(),
    expires_at: Number(session.expiresAt),
    last_used_at: session.lastUsedAt.toISOString(),
    user_agent: session.userAgent,
    ip_address: session.ipAddress,
    ...(refreshReused ? { refresh_reused: true } : {}),
  };
}

function tableModel(table) {
  if (table === "interviews") return prisma.interview;
  if (table === "study_items") return prisma.studyItem;
  throw new Error("Unknown table");
}

function storedRecord(row) {
  return row ? { ...row.data, userId: row.userId ?? undefined } : null;
}

export async function createPrismaDatabase() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required in production. Configure a hosted PostgreSQL database.");
  }

  await prisma.$connect();

  const all = async (table, userId) => {
    const records = await tableModel(table).findMany({
      where: userId === undefined ? { userId: null } : { userId },
      orderBy: { updatedAt: "desc" },
    });
    return records.map(storedRecord);
  };
  const get = async (table, id, userId) => {
    const row = await tableModel(table).findFirst({
      where: { id, ...(userId === undefined ? { userId: null } : { userId }) },
    });
    return storedRecord(row);
  };
  const put = async (table, record, userId = record.userId ?? null) => {
    const model = tableModel(table);
    const existing = await model.findUnique({ where: { id: record.id }, select: { userId: true } });
    if (existing && existing.userId !== userId) throw new Error("Record not found.");
    const storedData = { ...record };
    if (userId === null) delete storedData.userId;
    else storedData.userId = userId;
    const data = {
      userId,
      createdAt: date(record.createdAt),
      updatedAt: date(record.updatedAt),
      data: storedData,
    };
    if (table === "study_items") {
      data.topic = record.topic;
      data.question = record.question;
      data.bookmarked = Boolean(record.bookmarked);
    }
    return model.upsert({ where: { id: record.id }, create: { id: record.id, ...data }, update: data })
      .then(() => record);
  };
  const remove = async (table, id, userId) => {
    await tableModel(table).deleteMany({ where: { id, ...(userId === undefined ? { userId: null } : { userId }) } });
  };
  const clear = async (userId) => {
    await prisma.$transaction([
      prisma.interview.deleteMany({ where: userId === undefined ? { userId: null } : { userId } }),
      prisma.studyItem.deleteMany({ where: userId === undefined ? { userId: null } : { userId } }),
    ]);
  };
  const userScoped = (userId) => ({
    all: (table) => all(table, userId),
    get: (table, id) => get(table, id, userId),
    put: (table, record) => put(table, record, userId),
    remove: (table, id) => remove(table, id, userId),
    clear: () => clear(userId),
  });
  const database = {
    all,
    get,
    put,
    remove,
    clear,
    userScoped,
    createUser: async ({ id, name, email, passwordHash, createdAt, legacyDataOwner = false }) => prisma.user.create({
      data: { id, name, email, passwordHash, createdAt: date(createdAt), legacyDataOwner },
    }),
    userByEmail: async (email) => userShape(await prisma.user.findUnique({ where: { email } })),
    userById: async (id) => userShape(await prisma.user.findUnique({ where: { id } })),
    updateUser: async (id, fields) => {
      const update = {};
      if (fields.name !== undefined) update.name = fields.name;
      if (fields.passwordHash !== undefined) update.passwordHash = fields.passwordHash;
      if (fields.emailVerified !== undefined) update.emailVerified = Boolean(fields.emailVerified);
      if (fields.lastLoginAt !== undefined) update.lastLoginAt = fields.lastLoginAt ? date(fields.lastLoginAt) : null;
      if (fields.failedAttempts !== undefined) update.failedAttempts = fields.failedAttempts;
      if (fields.lockedUntil !== undefined) update.lockedUntil = BigInt(fields.lockedUntil);
      if (Object.keys(update).length) await prisma.user.update({ where: { id }, data: update });
    },
    deleteUser: async (id) => prisma.user.delete({ where: { id } }),
    userCount: async () => prisma.user.count(),
    allUsers: async () => (await prisma.user.findMany({ orderBy: { createdAt: "asc" } })).map(userShape),
    claimLegacyData: async (userId) => {
      const [interviews, studyItems] = await prisma.$transaction([
        prisma.interview.findMany({ where: { userId: null } }),
        prisma.studyItem.findMany({ where: { userId: null } }),
      ]);
      const updates = [
        ...interviews.map((row) => prisma.interview.update({
          where: { id: row.id },
          data: { userId, data: { ...row.data, userId } },
        })),
        ...studyItems.map((row) => prisma.studyItem.update({
          where: { id: row.id },
          data: { userId, data: { ...row.data, userId } },
        })),
      ];
      if (updates.length) await prisma.$transaction(updates);
    },
    createAuthSession: async (session) => prisma.authSession.create({
      data: {
        id: session.id,
        userId: session.userId,
        refreshHash: session.refreshHash,
        createdAt: date(session.createdAt),
        expiresAt: BigInt(session.expiresAt),
        lastUsedAt: date(session.lastUsedAt),
        userAgent: session.userAgent,
        ipAddress: session.ipAddress,
      },
    }),
    authSession: async (id) => sessionShape(await prisma.authSession.findUnique({ where: { id } })),
    sessionByRefreshHash: async (tokenHash) => {
      const active = await prisma.authSession.findUnique({ where: { refreshHash: tokenHash } });
      if (active) return sessionShape(active);
      const previous = await prisma.authRefreshHistory.findFirst({
        where: { tokenHash, expiresAt: { gt: BigInt(Date.now()) } },
        include: { session: true },
      });
      return previous ? sessionShape(previous.session, true) : null;
    },
    authSessions: async (userId) => (await prisma.authSession.findMany({
      where: { userId },
      orderBy: { lastUsedAt: "desc" },
    })).map(sessionShape),
    rotateAuthSession: async (id, previousHash, refreshHash, expiresAt, lastUsedAt) => prisma.$transaction(async (tx) => {
      const changed = await tx.authSession.updateMany({
        where: { id, refreshHash: previousHash },
        data: { refreshHash, expiresAt: BigInt(expiresAt), lastUsedAt: date(lastUsedAt) },
      });
      if (changed.count !== 1) return false;
      await tx.authRefreshHistory.create({
        data: { tokenHash: previousHash, sessionId: id, expiresAt: BigInt(Date.now() + 30 * 86400 * 1000) },
      });
      return true;
    }),
    removeAuthSession: async (id, userId) => {
      await prisma.authSession.deleteMany({ where: { id, ...(userId ? { userId } : {}) } });
    },
    removeOtherAuthSessions: async (userId, exceptId) => {
      await prisma.authSession.deleteMany({ where: { userId, id: { not: exceptId } } });
    },
    addAuthToken: async ({ tokenHash, userId, purpose, expiresAt }) => prisma.authToken.create({
      data: { tokenHash, userId, purpose, expiresAt: BigInt(expiresAt) },
    }),
    consumeAuthToken: async (tokenHash, purpose, now) => prisma.$transaction(async (tx) => {
      const token = await tx.authToken.findFirst({
        where: { tokenHash, purpose, expiresAt: { gt: BigInt(now) } },
      });
      await tx.authToken.deleteMany({ where: { tokenHash } });
      return token ? {
        token_hash: token.tokenHash,
        user_id: token.userId,
        purpose: token.purpose,
        expires_at: Number(token.expiresAt),
      } : null;
    }),
    removeUserTokens: async (userId, purpose) => prisma.authToken.deleteMany({
      where: { userId, ...(purpose ? { purpose } : {}) },
    }),
    addAuditEvent: async ({ userId, action, createdAt, ipAddress }) => prisma.auditEvent.create({
      data: { id: randomUUID(), userId, action, createdAt: date(createdAt), ipAddress },
    }),
    health: async () => {
      await prisma.$queryRaw`SELECT 1`;
      return true;
    },
    close: () => prisma.$disconnect(),
    client: prisma,
  };

  return database;
}
