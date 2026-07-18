"use client";

import {
  AudioLinesIcon,
  CloudIcon,
  GitPullRequestIcon,
  LibraryIcon,
  PanelLeftIcon,
  PlugZapIcon,
  ScanTextIcon,
  SparklesIcon,
  UsersIcon,
  VectorSquareIcon,
  WandSparklesIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { useI18n } from "@/lib/i18n/provider";

function AdminNav({
  tabs,
  pathname,
  title,
  navLabel,
  onNavigate,
}: {
  tabs: Array<{ href: string; label: string; icon: LucideIcon }>;
  pathname: string;
  title: string;
  navLabel: string;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label={navLabel} className="flex flex-col gap-1 p-3">
      <div className="px-2 py-2">
        <p className="text-foreground text-sm font-semibold">{title}</p>
      </div>
      <div className="border-sidebar-border mx-2 mb-2 border-t" />
      {tabs.map((tab) => {
        const isActive = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            onClick={onNavigate}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors duration-150 ${
              isActive
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            }`}
          >
            <Icon className="size-3.5 shrink-0 opacity-80" aria-hidden />
            <span className="truncate">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const [mobileOpen, setMobileOpen] = useState(false);

  const tabs: Array<{ href: string; label: string; icon: LucideIcon }> = [
    { href: "/admin/users", label: t.admin.users, icon: UsersIcon },
    { href: "/admin/bundles", label: t.admin.bundles, icon: LibraryIcon },
    { href: "/admin/merge-requests", label: t.admin.mergeRequests, icon: GitPullRequestIcon },
    { href: "/admin/ai", label: t.admin.ai, icon: SparklesIcon },
    { href: "/admin/skills", label: t.admin.skills, icon: WandSparklesIcon },
    { href: "/admin/mcp", label: t.admin.mcp, icon: PlugZapIcon },
    { href: "/admin/ocr", label: t.admin.ocr, icon: ScanTextIcon },
    { href: "/admin/stt", label: t.admin.stt, icon: AudioLinesIcon },
    { href: "/admin/embeddings", label: t.admin.embeddings, icon: VectorSquareIcon },
    { href: "/admin/remote", label: t.admin.remote, icon: CloudIcon },
  ];

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  // Close the drawer whenever the route changes (e.g. browser back).
  useEffect(() => {
    const id = window.setTimeout(() => setMobileOpen(false), 0);
    return () => window.clearTimeout(id);
  }, [pathname]);

  const activeTab = tabs.find(
    (tab) => pathname === tab.href || pathname.startsWith(`${tab.href}/`),
  );
  const activeLabel = activeTab?.label ?? t.admin.title;

  return (
    <div className="flex min-w-0 flex-1">
      <aside className="border-sidebar-border bg-sidebar sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-56 shrink-0 overflow-y-auto border-e md:block">
        <AdminNav
          tabs={tabs}
          pathname={pathname}
          title={t.admin.title}
          navLabel={t.admin.navLabel}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-border bg-background sticky top-14 z-30 flex h-11 items-center gap-2 border-b px-3 md:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label={t.admin.showMenu}
            className="text-muted-foreground hover:bg-muted hover:text-foreground flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors duration-150"
          >
            <PanelLeftIcon className="size-4 rtl:-scale-x-100" />
            <span className="text-foreground max-w-48 truncate font-medium">{activeLabel}</span>
          </button>
        </div>

        <main className="mx-auto w-full max-w-5xl flex-1 p-6">{children}</main>
      </div>

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
              aria-label={t.admin.hideMenu}
              className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-7 items-center justify-center rounded-md transition-colors duration-150"
            >
              <XIcon className="size-4" />
            </button>
          </div>
          <AdminNav
            tabs={tabs}
            pathname={pathname}
            title={t.admin.title}
            navLabel={t.admin.navLabel}
            onNavigate={() => setMobileOpen(false)}
          />
        </aside>
      </div>
    </div>
  );
}
