"use client";

import { ExternalLinkIcon } from "lucide-react";
import Link from "next/link";

import { AboutShell } from "@/components/about/about-shell";
import { APP_INFO } from "@/lib/app-info";
import { useI18n } from "@/lib/i18n/provider";

export default function AboutUsPage() {
  const { t } = useI18n();

  return (
    <AboutShell>
      <div className="flex flex-col gap-8">
        <header className="flex flex-col gap-2">
          <p className="text-muted-foreground text-xs font-medium tracking-[0.08em] uppercase">
            {t.about.usKicker}
          </p>
          <h1 className="text-3xl tracking-[-0.02em]">{t.about.usTitle}</h1>
          <p className="text-muted-foreground max-w-2xl text-pretty text-sm leading-relaxed">
            {t.about.usLead}
          </p>
        </header>

        <section className="surface-card flex flex-col gap-3 rounded-xl p-5 sm:p-6">
          <h2 className="text-base">{t.about.mission}</h2>
          <p className="text-muted-foreground text-sm leading-relaxed text-pretty">
            {t.about.missionBody}
          </p>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-base">{t.about.principles}</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {t.about.principlesList.map((item) => (
              <li
                key={item.title}
                className="surface-card flex flex-col gap-1.5 rounded-xl p-4 transition-[border-color,box-shadow] duration-200 ease-[var(--ease-out-spring)] motion-reduce:transition-none"
              >
                <h3 className="text-sm font-semibold tracking-[-0.01em]">{item.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed text-pretty">
                  {item.body}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="surface-card flex flex-col gap-4 rounded-xl p-5 sm:p-6">
          <h2 className="text-base">{t.about.openSource}</h2>
          <p className="text-muted-foreground text-sm leading-relaxed text-pretty">
            {t.about.openSourceBody}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={APP_INFO.repositoryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-primary text-primary-foreground inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-[transform,opacity] duration-150 ease-[var(--ease-out-spring)] hover:opacity-95 active:scale-[0.98]"
            >
              <span dir="ltr">{APP_INFO.repositoryLabel}</span>
              <ExternalLinkIcon className="size-3.5 opacity-80" />
            </a>
            <Link
              href="/about"
              className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 transition-colors hover:underline"
            >
              {t.about.viewBuildDetails}
            </Link>
          </div>
        </section>
      </div>
    </AboutShell>
  );
}
