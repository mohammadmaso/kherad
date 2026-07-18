"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useI18n } from "@/lib/i18n/provider";

const TABS = [
  { href: "/about", key: "app" as const },
  { href: "/about/us", key: "us" as const },
];

export function AboutShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { t } = useI18n();

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background:radial-gradient(55%_45%_at_50%_0%,color-mix(in_oklch,var(--primary),transparent_90%),transparent_70%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/25 to-transparent"
      />

      <div className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-10 sm:py-14">
        <div className="flex flex-col gap-5">
          <nav aria-label={t.about.navLabel} className="flex items-center gap-1">
            {TABS.map((tab) => {
              const active =
                tab.href === "/about" ? pathname === "/about" : pathname.startsWith(tab.href);
              const label = tab.key === "app" ? t.about.tabApp : t.about.tabUs;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`rounded-full px-3.5 py-1.5 text-sm transition-[color,background-color,transform] duration-150 ease-[var(--ease-out-spring)] active:scale-[0.98] motion-reduce:transition-none ${
                    active
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="animate-in fade-in slide-in-from-bottom-1 fill-mode-both duration-300 ease-[var(--ease-out-spring)] motion-reduce:animate-none">
          {children}
        </div>
      </div>
    </div>
  );
}
