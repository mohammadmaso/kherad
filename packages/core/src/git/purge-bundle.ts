import { listFilesAtRef, writeAndCommit } from "./content";
import {
  bundleGitPathPrefix,
  legacyBundleGitPathPrefix,
  okfGitPathPrefix,
} from "./paths";
import { listBranches } from "./refs";
import type { CommitAuthor, FileWrite } from "./types";
import { deleteBundleWikiVersion, listBundleWikiVersions } from "./versions";

/**
 * Removes a bundle's git trees from `branch` (`raw/`, legacy `wiki/`, `okf/`)
 * and deletes every `version/<slug>/*` snapshot branch. Write operation —
 * callers must run this through the repo's write lock. Postgres metadata is
 * the caller's responsibility.
 */
export async function purgeBundleContent(
  gitdir: string,
  bundleSlug: string,
  branch: string,
  author: CommitAuthor,
): Promise<void> {
  const prefixes = [
    bundleGitPathPrefix(bundleSlug),
    legacyBundleGitPathPrefix(bundleSlug),
    okfGitPathPrefix(bundleSlug),
  ];

  const files: FileWrite[] = [];
  for (const prefix of prefixes) {
    for (const path of await listFilesAtRef(gitdir, branch, prefix)) {
      files.push({ path, content: null });
    }
  }

  if (files.length > 0) {
    await writeAndCommit(
      gitdir,
      branch,
      files,
      `Delete bundle "${bundleSlug}"`,
      author,
    );
  }

  const versions = await listBundleWikiVersions(gitdir, await listBranches(gitdir), bundleSlug);
  for (const version of versions) {
    await deleteBundleWikiVersion(gitdir, bundleSlug, version.name);
  }
}
