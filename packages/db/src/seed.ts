import { randomBytes } from "node:crypto";

import argon2 from "argon2";

import { createDb } from "./client";
import { bundles, users } from "./schema";
import { SYSTEM_INDEXER_DISPLAY_NAME, SYSTEM_INDEXER_EMAIL } from "./system";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@kherad.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "changeme123";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  const db = createDb(connectionString);

  const passwordHash = await argon2.hash(ADMIN_PASSWORD);

  const [admin] = await db
    .insert(users)
    .values({
      email: ADMIN_EMAIL,
      passwordHash,
      displayName: "Admin",
      isAdmin: true,
    })
    .onConflictDoNothing({ target: users.email })
    .returning();

  // Machine account that authors OKF compile MRs. Random throwaway password;
  // login is additionally blocked for isSystem users in core auth.
  const [indexer] = await db
    .insert(users)
    .values({
      email: SYSTEM_INDEXER_EMAIL,
      passwordHash: await argon2.hash(randomBytes(32).toString("hex")),
      displayName: SYSTEM_INDEXER_DISPLAY_NAME,
      isAdmin: false,
      isSystem: true,
    })
    .onConflictDoNothing({ target: users.email })
    .returning();

  const [bundle] = await db
    .insert(bundles)
    .values({
      slug: "welcome",
      title: "Welcome",
      isPublic: true,
      defaultBranch: "main",
    })
    .onConflictDoNothing({ target: bundles.slug })
    .returning();

  console.log("Seeded admin user:", admin?.email ?? `${ADMIN_EMAIL} (already existed)`);
  console.log(
    "Seeded system user:",
    indexer?.email ?? `${SYSTEM_INDEXER_EMAIL} (already existed)`,
  );
  console.log("Seeded bundle:", bundle?.slug ?? "welcome (already existed)");
  console.log(`Admin login: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
