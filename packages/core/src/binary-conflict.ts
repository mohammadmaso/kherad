/**
 * Pure binary-conflict token helpers safe for browser bundles. Kept separate
 * from `@kherad/core/git` so client components never pull in `node:fs`.
 *
 * Stand-ins written into `mr_conflicts.marker_text` for binary/image paths.
 * Real image bytes contain NUL (`0x00`), which Postgres rejects in `text`
 * columns — so we never store the blob itself, only these tokens. The
 * conflict UI lets a manager pick a side; `resolveSquashMergeConflict` then
 * materializes the chosen side's bytes from the commit objects.
 */

export const BINARY_CONFLICT_OURS = "__KHERAD_BINARY__:ours";
export const BINARY_CONFLICT_THEIRS = "__KHERAD_BINARY__:theirs";

export function isBinaryConflictToken(text: string): boolean {
  const trimmed = text.trim();
  return trimmed === BINARY_CONFLICT_OURS || trimmed === BINARY_CONFLICT_THEIRS;
}
