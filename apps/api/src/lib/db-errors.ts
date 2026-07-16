/**
 * Whether an error thrown by a Drizzle query is a Postgres unique-constraint
 * violation (SQLSTATE 23505), so routes can answer 409 instead of 500 when a
 * duplicate email/slug/path slips past the pre-insert checks. Drizzle may
 * surface the driver error directly or wrapped as `cause`.
 */
export function isUniqueViolation(err: unknown): boolean {
  for (let cur = err; typeof cur === "object" && cur !== null; cur = (cur as Error).cause) {
    if ((cur as { code?: string }).code === "23505") return true;
    if (cur === (cur as Error).cause) break;
  }
  return false;
}
