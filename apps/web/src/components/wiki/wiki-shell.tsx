"use client";

import { Select } from "@kherad/ui/components/ui/select";
import {
  ChevronRightIcon,
  FileTextIcon,
  HistoryIcon,
  LibraryIcon,
  PanelLeftIcon,
  SettingsIcon,
  SparklesIcon,
  WaypointsIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { BundleChat } from "@/components/chat/bundle-chat";
import type { WikiNavNode } from "@/lib/wiki-nav";
import { isFolderNode, labelFor } from "@/lib/page-tree";
import { useI18n } from "@/lib/i18n/provider";

type Bundle = {
  id: string;
  slug: string;
  title: string;
  isPublic: boolean;
  mode: "raw" | "llm_compiled";
};

type ShellProps = {
  bundle: Bundle;
  tree: WikiNavNode[];
  pageCount: number;
  canManage: boolean;
  isAuthed: boolean;
  /** This bundle's version names (newest first) for the reader's version selector. */
  versions: string[];
  children: React.ReactNode;
};

function nodeHref(slug: string, node: WikiNavNode): string {
  return `/wiki/${slug}/${node.path}`;
}

/** Every folder path in the tree — the sidebar starts fully expanded. */
function allFolderPaths(nodes: WikiNavNode[], into: string[] = []): string[] {
  for (const node of nodes) {
    if (isFolderNode(node)) {
      into.push(node.path);
      allFolderPaths(node.children, into);
    }
  }
  return into;
}

/** Folder paths that must start expanded so the active page is visible. */
function ancestorsOf(pathname: string, slug: string): string[] {
  const prefix = `/wiki/${slug}/`;
  if (!pathname.startsWith(prefix)) return [];
  const segments = decodeURIComponent(pathname.slice(prefix.length)).split("/");
  const ancestors: string[] = [];
  for (let i = 1; i < segments.length; i++) {
    ancestors.push(segments.slice(0, i).join("/"));
  }
  return ancestors;
}

function TreeNode({
  node,
  slug,
  pathname,
  suffix,
  expanded,
  onToggle,
}: {
  node: WikiNavNode;
  slug: string;
  pathname: string;
  /** Query string (e.g. `?version=v1`) appended to page links so a picked version sticks while browsing. */
  suffix: string;
  expanded: Set<string>;
  onToggle: (path: string) => void;
}) {
  const { t } = useI18n();
  const isFolder = isFolderNode(node);
  const isOpen = expanded.has(node.path);
  const isActive = !isFolder && node.page !== null && pathname === nodeHref(slug, node);

  const rowClass = `group flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors duration-150 ${
    isActive
      ? "bg-primary/10 font-medium text-primary"
      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
  }`;

  const chevron = isFolder ? (
    <button
      type="button"
      aria-label={isOpen ? t.wiki.collapse(labelFor(node)) : t.wiki.expand(labelFor(node))}
      aria-expanded={isOpen}
      onClick={() => onToggle(node.path)}
      className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-5 shrink-0 items-center justify-center rounded transition-colors duration-150"
    >
      {/* Closed chevron points into the reading direction; open points down in both. */}
      <ChevronRightIcon
        className={`size-3.5 transition-transform duration-200 [transition-timing-function:var(--ease-out-spring)] ${isOpen ? "rotate-90" : "rtl:rotate-180"}`}
      />
    </button>
  ) : (
    <FileTextIcon className="size-3.5 shrink-0 opacity-60" />
  );

  return (
    <li>
      <div className="flex items-center gap-0.5">
        {isFolder ? (
          <button
            type="button"
            onClick={() => onToggle(node.path)}
            className={`${rowClass} text-start`}
          >
            {chevron}
            <span className="truncate">{labelFor(node)}</span>
          </button>
        ) : node.page ? (
          <Link
            href={nodeHref(slug, node) + suffix}
            className={rowClass}
            aria-current={isActive ? "page" : undefined}
          >
            {chevron}
            <span className="truncate">{labelFor(node)}</span>
          </Link>
        ) : null}
      </div>
      {isFolder ? (
        <div
          className={`grid transition-[grid-template-rows] duration-300 [transition-timing-function:var(--ease-out-spring)] ${
            isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          }`}
        >
          <div className="overflow-hidden">
            <ul className="border-border/70 ms-[0.8125rem] mt-0.5 flex flex-col gap-0.5 border-s ps-2">
              {node.children.map((child) => (
                <TreeNode
                  key={child.path}
                  node={child}
                  slug={slug}
                  pathname={pathname}
                  suffix={suffix}
                  expanded={expanded}
                  onToggle={onToggle}
                />
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Whole-wiki version picker. Selecting a version re-renders the current page
 * from that `version/<name>` snapshot (`?version=` param); "Current" returns
 * to the live wiki. Sidebar page links keep the selection while browsing.
 */
function VersionSelector({
  versions,
  current,
  pathname,
}: {
  versions: string[];
  current: string | null;
  pathname: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  // A stale URL (deleted version) still renders as a listed option so the
  // select shows what the reader is actually looking at.
  const options = current && !versions.includes(current) ? [current, ...versions] : versions;

  return (
    <label className="mb-3 flex items-center gap-2 px-2">
      <HistoryIcon className="text-muted-foreground size-3.5 shrink-0 opacity-80" />
      <span className="sr-only">{t.wiki.versionLabel}</span>
      <Select
        value={current ?? ""}
        onChange={(e) => {
          const version = e.target.value;
          router.push(version ? `${pathname}?version=${encodeURIComponent(version)}` : pathname);
        }}
        className="h-8 min-w-0 flex-1 text-sm"
      >
        <option value="">{t.wiki.currentVersion}</option>
        {options.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </Select>
    </label>
  );
}

function SidebarContent({
  bundle,
  tree,
  pageCount,
  canManage,
  pathname,
  versions,
  version,
}: {
  bundle: Bundle;
  tree: WikiNavNode[];
  pageCount: number;
  canManage: boolean;
  pathname: string;
  versions: string[];
  version: string | null;
}) {
  const { t } = useI18n();
  // Everything starts expanded — the whole hierarchy is visible at a glance;
  // collapsing is an explicit reader choice that persists while browsing.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(allFolderPaths(tree)));

  // Navigating (sidebar link, in-page link, back button) must reveal the new
  // active page even if its folder was collapsed by hand. State is adjusted
  // during render (not in an effect) so there's no extra committed frame.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    const ancestors = ancestorsOf(pathname, bundle.slug);
    if (!ancestors.every((a) => expanded.has(a))) {
      const next = new Set(expanded);
      for (const a of ancestors) next.add(a);
      setExpanded(next);
    }
  }

  const onToggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const indexActive = pathname === `/wiki/${bundle.slug}`;
  const graphHref = `/wiki/${bundle.slug}/graph`;
  const graphActive = pathname === graphHref;
  const suffix = version ? `?version=${encodeURIComponent(version)}` : "";

  return (
    <nav aria-label={t.wiki.navLabel} className="flex flex-col p-3">
      <div className="flex items-center gap-1">
        <Link
          href={`/wiki/${bundle.slug}${suffix}`}
          className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-2 transition-colors duration-150 ${
            indexActive ? "bg-primary/10" : "hover:bg-muted"
          }`}
        >
          <span className="bg-primary/12 text-primary flex size-8 shrink-0 items-center justify-center rounded-lg">
            <LibraryIcon className="size-4" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className={`truncate text-sm font-semibold ${indexActive ? "text-primary" : ""}`}>
              {bundle.title}
            </span>
            <span className="text-muted-foreground text-xs">{t.wiki.pageCount(pageCount)}</span>
          </span>
        </Link>
        {canManage ? (
          <Link
            href={`/bundles/${bundle.id}`}
            aria-label={t.wiki.manage}
            title={t.wiki.manage}
            className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-150"
          >
            <SettingsIcon className="size-4" />
          </Link>
        ) : null}
      </div>

      <div className="border-sidebar-border mx-2 my-3 border-t" />

      {versions.length > 0 || version ? (
        <VersionSelector versions={versions} current={version} pathname={pathname} />
      ) : null}

      <Link
        href={graphHref}
        aria-current={graphActive ? "page" : undefined}
        className={`mb-3 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors duration-150 ${
          graphActive
            ? "bg-primary/10 text-primary font-medium"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        }`}
      >
        <WaypointsIcon className="size-3.5 shrink-0 opacity-80" />
        <span className="truncate">{t.wiki.graph}</span>
      </Link>

      <span className="text-muted-foreground mb-1.5 px-2 text-[0.6875rem] font-medium uppercase tracking-[0.06em]">
        {t.wiki.pagesLabel}
      </span>

      {tree.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {tree.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              slug={bundle.slug}
              pathname={pathname}
              suffix={suffix}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground px-2 text-xs">{t.wiki.noPages}</p>
      )}
    </nav>
  );
}

export function WikiShell({
  bundle,
  tree,
  pageCount,
  canManage,
  isAuthed,
  versions,
  children,
}: ShellProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const version = searchParams.get("version");
  const { t } = useI18n();

  // The server-rendered tree reflects the live wiki (the layout can't see
  // `?version=`), so when a version is picked, fetch that snapshot's
  // hierarchy and swap it in. The payload is tagged with its version — a
  // stale or failed fetch just leaves the live tree in place.
  const [versionNav, setVersionNav] = useState<{
    version: string;
    tree: WikiNavNode[];
    pageCount: number;
  } | null>(null);

  useEffect(() => {
    if (!version) return;
    let cancelled = false;
    fetch(
      `/api/wiki-nav?bundle=${encodeURIComponent(bundle.slug)}&version=${encodeURIComponent(version)}`,
    )
      .then((res) =>
        res.ok ? (res.json() as Promise<{ tree: WikiNavNode[]; pageCount: number }>) : null,
      )
      .then((data) => {
        if (!cancelled && data) {
          setVersionNav({ version, tree: data.tree, pageCount: data.pageCount });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [version, bundle.slug]);

  const atVersion = version !== null && versionNav?.version === version;
  const effectiveTree = atVersion ? versionNav!.tree : tree;
  const effectivePageCount = atVersion ? versionNav!.pageCount : pageCount;

  const [mobileOpen, setMobileOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // Mount the chat tree only after the reader opens it once so a zero-width
  // flex sibling cannot leak the full panel beside the article.
  const [chatMounted, setChatMounted] = useState(false);
  const chatEnabled = bundle.mode === "llm_compiled";

  const openChat = () => {
    setChatMounted(true);
    setChatOpen(true);
  };

  const closeChat = () => setChatOpen(false);

  // Close the mobile drawer after navigation so the destination is visible.
  // Adjusted during render rather than in an effect.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    if (mobileOpen) setMobileOpen(false);
  }

  useEffect(() => {
    if (!mobileOpen && !chatOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (mobileOpen) setMobileOpen(false);
      else setChatOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen, chatOpen]);

  const sidebar = useMemo(
    () => (
      <SidebarContent
        // Remount when the tree source flips (live ↔ a version snapshot) so
        // the expanded-folder state re-initializes to "all expanded" for the
        // new hierarchy, without resetting on ordinary navigation.
        key={atVersion ? `version:${version}` : "live"}
        bundle={bundle}
        tree={effectiveTree}
        pageCount={effectivePageCount}
        canManage={canManage}
        pathname={pathname}
        versions={versions}
        version={version}
      />
    ),
    [bundle, effectiveTree, effectivePageCount, canManage, pathname, versions, version, atVersion],
  );

  return (
    <div className="flex min-w-0 flex-1">
      <aside className="w-68 border-sidebar-border bg-sidebar sticky top-14 hidden h-[calc(100dvh-3.5rem)] shrink-0 overflow-y-auto border-e md:block">
        {sidebar}
      </aside>

      <div className="flex min-w-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Small screens: slim bar that summons the sidebar as a start-edge drawer. */}
          <div className="border-border bg-background sticky top-14 z-30 flex h-11 items-center gap-2 border-b px-3 md:hidden">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label={t.wiki.showPages}
              className="text-muted-foreground hover:bg-muted hover:text-foreground flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors duration-150"
            >
              <PanelLeftIcon className="size-4 rtl:-scale-x-100" />
              <span className="text-foreground max-w-48 truncate font-medium">{bundle.title}</span>
            </button>
          </div>

          <main className="flex min-w-0 flex-1 flex-col">{children}</main>
        </div>

        {chatEnabled && chatMounted ? (
          <aside
            aria-label={t.chat.title}
            className={`border-border bg-background sticky top-14 flex h-[calc(100dvh-3.5rem)] w-full max-w-md shrink-0 flex-col border-s ${
              chatOpen ? "" : "hidden"
            }`}
          >
            <BundleChat bundle={bundle} isAuthed={isAuthed} onClose={closeChat} />
          </aside>
        ) : null}
      </div>

      {/* Drawer: enters from the start edge, exits the same way (same path both ways). */}
      <div
        aria-hidden={!mobileOpen}
        className={`fixed inset-0 top-14 z-40 md:hidden ${mobileOpen ? "" : "pointer-events-none"}`}
      >
        <div
          onClick={() => setMobileOpen(false)}
          className={`absolute inset-0 bg-black/40 transition-opacity duration-300 ${
            mobileOpen ? "opacity-100" : "opacity-0"
          }`}
        />
        <aside
          className={`border-sidebar-border bg-sidebar absolute inset-y-0 start-0 w-72 overflow-y-auto border-e shadow-xl transition-transform duration-300 [transition-timing-function:var(--ease-out-spring)] ${
            mobileOpen ? "translate-x-0" : "-translate-x-full rtl:translate-x-full"
          }`}
        >
          <div className="flex justify-end px-3 pt-3">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label={t.wiki.hidePages}
              className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-7 items-center justify-center rounded-md transition-colors duration-150"
            >
              <XIcon className="size-4" />
            </button>
          </div>
          {sidebar}
        </aside>
      </div>

      {chatEnabled && !chatOpen ? (
        <button
          type="button"
          onClick={openChat}
          aria-label={t.chat.open}
          aria-expanded={chatOpen}
          className="bg-primary text-primary-foreground fixed bottom-5 end-5 z-30 flex h-11 items-center gap-2 rounded-full px-4 text-sm font-medium shadow-lg transition-[transform,opacity] duration-200 [transition-timing-function:var(--ease-out-spring)] hover:scale-[1.03] active:scale-[0.97] motion-reduce:transition-none"
        >
          <SparklesIcon className="size-4" />
          {t.chat.open}
        </button>
      ) : null}
    </div>
  );
}
