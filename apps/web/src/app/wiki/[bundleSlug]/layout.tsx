import { defaultGitEngine } from "@kherad/core/git";
import { checkPermission } from "@kherad/core/permissions";
import { notFound } from "next/navigation";

import { WikiShell } from "@/components/wiki/wiki-shell";
import { getViewer } from "@/lib/auth";
import { db } from "@/lib/db";
import { getWikiNav } from "@/lib/wiki-nav";

import "../wiki-content.css";

type Props = {
  children: React.ReactNode;
  params: Promise<{ bundleSlug: string }>;
};

/**
 * Shared wiki chrome: every page under /wiki/<bundle> renders inside a
 * persistent document sidebar showing the bundle's page hierarchy (filtered
 * to what the viewer may see — see `getWikiNav`). The page itself still does
 * its own permission check; an empty sidebar never leaks titles.
 */
export default async function WikiLayout({ children, params }: Props) {
  const { bundleSlug } = await params;
  const viewer = await getViewer();
  const nav = await getWikiNav(bundleSlug, viewer);
  if (!nav) notFound();

  const canManage = await checkPermission(db, viewer, nav.bundle, null, "edit");

  // Whole-wiki snapshots for the reader's version selector. Anyone who can
  // view the bundle may read it at a version — a snapshot only ever contains
  // published (merged) content.
  let versions: string[] = [];
  try {
    versions = (await defaultGitEngine().listWikiVersions()).map((version) => version.name);
  } catch {
    // Repo missing/uninitialized — the selector just stays hidden.
  }

  return (
    <WikiShell
      bundle={nav.bundle}
      tree={nav.tree}
      pageCount={nav.pageCount}
      canManage={canManage}
      isAuthed={viewer !== null}
      versions={versions}
    >
      {children}
    </WikiShell>
  );
}
