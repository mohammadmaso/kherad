import type { AuthedUser } from "@kherad/core/auth";
import type { GitEngine } from "@kherad/core/git";

import { pageGitPath } from "./wiki-paths";

type BundleLike = { slug: string };
type PageLike = { path: string };

/**
 * Create (or reuse) the user's branch and commit one page write.
 * Shared by pages PUT .../content and agent-session edit save.
 */
export async function writePageContent(
  git: GitEngine,
  bundle: BundleLike,
  page: PageLike,
  content: string,
  user: AuthedUser,
  commitMessage: string,
): Promise<{ commitOid: string; branch: string }> {
  const branch = await git.createUserBranch(user.id);
  const commitOid = await git.writeAndCommit(
    branch,
    [{ path: pageGitPath(bundle.slug, page.path), content }],
    commitMessage,
    { name: user.displayName, email: user.email },
  );
  return { commitOid, branch };
}
