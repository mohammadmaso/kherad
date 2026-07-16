"use client";

import { GitPullRequestIcon, LibraryIcon, UsersIcon, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchAdminMergeRequests, fetchBundles, fetchUsers } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

export default function AdminRootPage() {
  const { t } = useI18n();
  const [userCount, setUserCount] = useState<number | null>(null);
  const [bundleCount, setBundleCount] = useState<number | null>(null);
  const [openMrCount, setOpenMrCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchUsers(), fetchBundles(), fetchAdminMergeRequests("open")])
      .then(([users, bundles, mrs]) => {
        if (cancelled) return;
        setUserCount(users.length);
        setBundleCount(bundles.length);
        setOpenMrCount(mrs.length);
      })
      .catch(() => {
        // Counts are a nice-to-have; the section pages surface real errors.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const cards: Array<{
    href: string;
    label: string;
    count: number | null;
    desc: string;
    icon: LucideIcon;
  }> = [
    {
      href: "/admin/users",
      label: t.admin.users,
      count: userCount,
      desc: t.admin.usersCardDesc,
      icon: UsersIcon,
    },
    {
      href: "/admin/bundles",
      label: t.admin.bundles,
      count: bundleCount,
      desc: t.admin.bundlesCardDesc,
      icon: LibraryIcon,
    },
    {
      href: "/admin/merge-requests",
      label: t.admin.mergeRequests,
      count: openMrCount,
      desc: t.admin.mrsCardDesc,
      icon: GitPullRequestIcon,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Link
            key={card.href}
            href={card.href}
            className="border-border hover:bg-muted/40 flex flex-col gap-1 rounded-lg border p-4 transition-colors duration-150"
          >
            <span className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
              <span className="bg-primary/12 text-primary flex size-7 items-center justify-center rounded-lg">
                <Icon className="size-3.5" aria-hidden />
              </span>
              {card.label}
            </span>
            <span className="text-2xl font-semibold">{card.count ?? "—"}</span>
            <span className="text-muted-foreground text-sm">{card.desc}</span>
          </Link>
        );
      })}
    </div>
  );
}
