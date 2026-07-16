import { schema, type Database } from "@kherad/db";
import { and, eq } from "drizzle-orm";

/**
 * Finds a free page path for a new raw page, suffixing `-2`, `-3`, … while the
 * candidate is taken. Only *live* rows block a path: a soft-deleted row
 * (tombstone from delete/rename) can be revived by inserting with
 * `upsertRawPage`, so its path stays reusable instead of being burned forever.
 */
export async function allocatePagePath(
  db: Database,
  bundleId: string,
  basePath: string,
): Promise<string> {
  let candidate = basePath;
  let suffix = 2;
  while (true) {
    const taken = await db.query.pages.findFirst({
      where: and(
        eq(schema.pages.bundleId, bundleId),
        eq(schema.pages.source, "raw"),
        eq(schema.pages.path, candidate),
        eq(schema.pages.isDeleted, false),
      ),
      columns: { id: true },
    });
    if (!taken) return candidate;
    candidate = `${basePath}-${suffix}`;
    suffix += 1;
  }
}

/**
 * Inserts the Postgres row for a newly created raw page. Upserts on
 * `(bundleId, source, path)` so creating a page at a tombstoned path revives
 * the old row (clearing its redirect) rather than hitting the unique index.
 */
export async function upsertRawPage(
  db: Database,
  bundleId: string,
  path: string,
  title: string,
) {
  const [page] = await db
    .insert(schema.pages)
    .values({ bundleId, path, title, isDeleted: false })
    .onConflictDoUpdate({
      target: [schema.pages.bundleId, schema.pages.source, schema.pages.path],
      set: { title, isDeleted: false, redirectTo: null },
    })
    .returning();
  return page;
}
