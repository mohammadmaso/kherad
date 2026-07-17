"use client";

import {
  AudioLinesIcon,
  CloudIcon,
  GitPullRequestIcon,
  LibraryIcon,
  ScanTextIcon,
  SparklesIcon,
  UsersIcon,
  VectorSquareIcon,
  WandSparklesIcon,
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
    { href: "/admin/skills", label: t.admin.skills, icon: WandSparklesIcon },
    { href: "/admin/ocr", label: t.admin.ocr, icon: ScanTextIcon },
    { href: "/admin/stt", label: t.admin.stt, icon: AudioLinesIcon },
    { href: "/admin/embeddings", label: t.admin.embeddings, icon: VectorSquareIcon },
    { href: "/admin/remote", label: t.admin.remote, icon: CloudIcon },
  ];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">{t.admin.title}</h1>
        <nav
          aria-label={t.admin.title}
          className="bg-muted/50 mt-4 flex w-full gap-1 overflow-x-auto rounded-lg p-1 text-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {tabs.map((tab) => {
            const isActive = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={isActive ? "page" : undefined}
                className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 font-medium whitespace-nowrap transition-colors duration-150 ${
                  isActive
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="size-3.5 shrink-0" aria-hidden />
                <span>{tab.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
      {children}
    </div>
  );
}
