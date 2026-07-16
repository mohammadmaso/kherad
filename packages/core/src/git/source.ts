import { getFileAtRef, getLastCommitTimestamp } from "./content";
import { legacyPageGitPath, pageGitPath } from "./paths";

/**
 * Reads a source page, preferring `raw/<slug>/…` and falling back to the
 * legacy `wiki/<slug>/…` layout so existing repos keep resolving until
 * pages are re-saved.
 */
export async function getSourcePageAtRef(
  gitdir: string,
  ref: string,
  bundleSlug: string,
  pagePath: string,
): Promise<Uint8Array | null> {
  const modern = await getFileAtRef(gitdir, ref, pageGitPath(bundleSlug, pagePath));
  if (modern !== null) return modern;
  return getFileAtRef(gitdir, ref, legacyPageGitPath(bundleSlug, pagePath));
}

/**
 * Resolves a source page from the newest branch that actually has content.
 * Authors save to their `user/<id>` branch; until that merges to main the
 * indexer and mirrors must still see those drafts when compiling.
 */
export async function getLatestSourcePageAtRef(
  gitdir: string,
  defaultBranch: string,
  bundleSlug: string,
  pagePath: string,
  branches: string[],
): Promise<Uint8Array | null> {
  const refs = [
    defaultBranch,
    ...branches.filter((name) => name.startsWith("user/") && name !== defaultBranch),
  ];

  let best: { bytes: Uint8Array; ts: number } | null = null;
  for (const ref of refs) {
    const bytes = await getSourcePageAtRef(gitdir, ref, bundleSlug, pagePath);
    if (bytes === null) continue;
    const committedAt = await getLastCommitTimestamp(gitdir, ref);
    const ts = committedAt?.getTime() ?? 0;
    if (!best || ts > best.ts) best = { bytes, ts };
  }

  return best?.bytes ?? null;
}
