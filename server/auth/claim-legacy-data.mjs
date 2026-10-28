import "dotenv/config";
import { createDatabase } from "../data/database.mjs";

const requestedEmail = process.argv[2] ?? process.env.LEGACY_DATA_OWNER_EMAIL;
const db = await createDatabase();

try {
  const users = db.allUsers?.();
  const user = requestedEmail
    ? db.userByEmail(requestedEmail.trim().toLowerCase())
    : users?.[0] ?? null;
  if (!user) {
    throw new Error(requestedEmail
      ? "No account matches LEGACY_DATA_OWNER_EMAIL. Create that account before running this migration."
      : "No account exists yet. Create the first account or pass an existing account email.");
  }
  await db.claimLegacyData(user.id);
  console.info(`Unowned legacy interview and study records were assigned to ${user.email}.`);
} finally {
  db.close();
}
