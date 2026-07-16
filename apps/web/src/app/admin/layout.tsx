"use client";

import {
  AudioLinesIcon,
  CloudIcon,
  GitPullRequestIcon,
  LibraryIcon,
  ScanTextIcon,
  SparklesIcon,
  TagsIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useI18n } from "@/lib/i18n/provider";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = useI18n();

  const tabs: Array<{ href: string; label: string; icon: LucideIcon }> = [
    { href: "/admin/users", label: t.admin.users, icon: UsersIcon },
    { href: "/admin/bundles", label: t.admin.bundles, icon: LibraryIcon },
    { href: "/admin/merge-requests", label: t.admin.mergeRequests, icon: GitPullRequestIcon },
    { href: "/admin/ai", label: t.admin.ai, icon: SparklesIcon },
    { href: "/admin/ocr", label: t.admin.ocr, icon: ScanTextIcon },
    { href: "/admin/stt", label: t.admin.stt, icon: AudioLinesIcon },
    { href: "/admin/remote", label: t.admin.remote, icon: CloudIcon },
    { href: "/admin/versions", label: t.admin.versions, icon: TagsIcon },
  ];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">{t.admin.title}</h1>
        <nav className="border-border mt-3 flex border-b text-sm">
          {tabs.map((tab) => {
            const isActive = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={isActive ? "page" : undefined}
                className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 px-3 py-2 text-center font-medium transition-colors duration-150 ${
                  isActive
                    ? "border-primary text-foreground"
                    : "text-muted-foreground hover:text-foreground border-transparent"
                }`}
              >
                <Icon className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{tab.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
      {children}
    </div>
  );
}
