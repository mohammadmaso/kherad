import { type AuthedUser } from "@kherad/core/auth";
import { defaultGitEngine } from "@kherad/core/git";
import { renderMarkdownToHtml } from "@kherad/core/markdown";
import { checkPermission } from "@kherad/core/permissions";
import { schema } from "@kherad/db";
import { and, eq } from "drizzle-orm";

import { db } from "./db";

export type SourcePageResult =
  | { kind: "not-found" }
  | { kind: "forbidden"; signedIn: boolean }
  | { kind: "tombstone"; title: string }
  | { kind: "redirect"; to: string }
  | {
      kind: "unpublished";
      title: string;
      bundleId: string;
      pageId: string;
      canEdit: boolean;
    }
  | {
      kind: "ok";
      title: string;
      html: string;
      bundleId: string;
      pageId: string;
      canEdit: boolean;
    };

/**
 * Resolves an author source page for `/sources/<slug>/…`. Always reads the
 * Postgres `pages` row + git `raw/` (legacy `wiki/` fallback) — never OKF.
 */
export async function resolveSourcePage(
  bundleSlug: string,
  pathSegments: string[],
  viewer: AuthedUser | null,
): Promise<SourcePageResult> {
  const bundle = await db.query.bundles.findFirst({ where: eq(schema.bundles.slug, bundleSlug) });
  if (!bundle || bundle.archivedAt) return { kind: "not-found" };

  const pagePath = pathSegments.join("/");
  const allowed = await checkPermission(db, viewer, bundle, pagePath, "view");
  if (!allowed) return { kind: "forbidden", signedIn: viewer !== null };

  const page = await db.query.pages.findFirst({
    where: and(
      eq(schema.pages.bundleId, bundle.id),
      eq(schema.pages.source, "raw"),
      eq(schema.pages.path, pagePath),
    ),
  });
  if (!page) return { kind: "not-found" };

  if (page.isDeleted) {
    if (page.redirectTo) {
      return { kind: "redirect", to: `/sources/${bundleSlug}/${page.redirectTo}` };
    }
    return { kind: "tombstone", title: page.title };
  }

  const canEdit = viewer ? await checkPermission(db, viewer, bundle, pagePath, "edit") : false;
  const git = defaultGitEngine();
  const contentBytes = await git.getLatestSourcePageAtRef(bundle.defaultBranch, bundle.slug, pagePath);
  if (contentBytes === null) {
    return {
      kind: "unpublished",
      title: page.title,
      bundleId: bundle.id,
      pageId: page.id,
      canEdit,
    };
  }

  const html = await renderMarkdownToHtml(new TextDecoder().decode(contentBytes));
  return {
    kind: "ok",
    title: page.title,
    html,
    bundleId: bundle.id,
    pageId: page.id,
    canEdit,
  };
}
