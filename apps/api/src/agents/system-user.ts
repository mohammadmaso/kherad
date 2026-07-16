import { randomBytes } from "node:crypto";

import { SYSTEM_INDEXER_DISPLAY_NAME, SYSTEM_INDEXER_EMAIL, schema, type Database } from "@kherad/db";
import argon2 from "argon2";
import { eq } from "drizzle-orm";

/**
 * Resolves the machine account that authors OKF compile MRs, creating it if
 * this deployment predates the seed entry. The password is a random throwaway
 * — `login()` rejects `isSystem` users regardless.
 */
export async function getOrCreateSystemUser(db: Database) {
  const existing = await db.query.users.findFirst({
    where: eq(schema.users.email, SYSTEM_INDEXER_EMAIL),
  });
  if (existing) return existing;

  const [created] = await db
    .insert(schema.users)
    .values({
      email: SYSTEM_INDEXER_EMAIL,
      passwordHash: await argon2.hash(randomBytes(32).toString("hex")),
      displayName: SYSTEM_INDEXER_DISPLAY_NAME,
      isAdmin: false,
      isSystem: true,
    })
    .onConflictDoNothing({ target: schema.users.email })
    .returning();
  if (created) return created;

  // Lost a concurrent-insert race — the row exists now.
  const user = await db.query.users.findFirst({
    where: eq(schema.users.email, SYSTEM_INDEXER_EMAIL),
  });
  if (!user) throw new Error("Failed to create system indexer user");
  return user;
}
