import { schema, type Database } from "@kherad/db";
import { eq } from "drizzle-orm";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether `value` can be bound to a Postgres `uuid` column. Route params come
 * in as arbitrary strings; binding a non-UUID makes Postgres throw
 * (`invalid input syntax for type uuid`) and the request 500 — checking first
 * turns those into ordinary 404s.
 */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export async function getBundleOrNull(db: Database, bundleId: string) {
  if (!isUuid(bundleId)) return undefined;
  return db.query.bundles.findFirst({ where: eq(schema.bundles.id, bundleId) });
}
