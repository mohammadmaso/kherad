"use client";

import { Badge } from "@kherad/ui/components/ui/badge";
import {
  BrainIcon,
  CopyIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  CheckIcon,
  ScaleIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { AboutShell } from "@/components/about/about-shell";
import { APP_INFO, APP_STACK } from "@/lib/app-info";
import { useI18n } from "@/lib/i18n/provider";

function formatCommitDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 items-baseline gap-1 border-b border-border/70 py-3.5 last:border-b-0 sm:grid-cols-[10rem_1fr] sm:gap-6">
      <dt className="text-muted-foreground text-xs font-medium tracking-[0.04em] uppercase">
        {label}
      </dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

function CopyableMono({ value, copiedLabel }: { value: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(id);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard can be blocked; leave the value visible to select manually.
    }
  }

  return (
    <span className="inline-flex max-w-full items-center gap-2">
      <code dir="ltr" className="bg-muted/70 truncate rounded-md px-2 py-0.5 font-mono text-xs">
        {value}
      </code>
      <button
        type="button"
        onClick={() => void copy()}
        className="text-muted-foreground hover:bg-muted/70 hover:text-foreground inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-[color,background-color,transform] duration-150 ease-[var(--ease-out-spring)] active:scale-95"
        aria-label={copied ? copiedLabel : value}
      >
        {copied ? <CheckIcon className="size-3.5 text-emerald-600" /> : <CopyIcon className="size-3.5" />}
      </button>
    </span>
  );
}

export default function AboutAppPage() {
  const { t, locale } = useI18n();
  const commitDate = APP_INFO.gitCommitDate
    ? formatCommitDate(APP_INFO.gitCommitDate, locale)
    : null;

  return (
    <AboutShell>
      <div className="flex flex-col gap-8">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
          <div className="bg-primary text-primary-foreground flex size-14 shrink-0 items-center justify-center rounded-2xl shadow-sm">
            <BrainIcon className="size-7" strokeWidth={2} />
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-3xl tracking-[-0.02em]">{t.common.appName}</h1>
              <Badge variant="secondary" className="font-mono text-xs" dir="ltr">
                v{APP_INFO.version}
              </Badge>
            </div>
            <p className="text-muted-foreground max-w-xl text-pretty text-sm leading-relaxed">
              {t.about.appSubtitle}
            </p>
          </div>
        </header>

        <section className="surface-card rounded-xl p-5 sm:p-6">
          <div className="mb-1 flex items-center gap-2">
            <GitBranchIcon className="text-muted-foreground size-4" aria-hidden />
            <h2 className="text-base">{t.about.buildDetails}</h2>
          </div>
          <p className="text-muted-foreground mb-2 text-xs">{t.about.buildDetailsHint}</p>
          <dl>
            <InfoRow label={t.about.version}>
              <CopyableMono value={APP_INFO.version} copiedLabel={t.about.copied} />
            </InfoRow>
            <InfoRow label={t.about.commit}>
              <CopyableMono value={APP_INFO.gitSha} copiedLabel={t.about.copied} />
            </InfoRow>
            {commitDate ? (
              <InfoRow label={t.about.buildDate}>
                <span dir="ltr" className="text-start">
                  {commitDate}
                </span>
              </InfoRow>
            ) : null}
            <InfoRow label={t.about.repository}>
              <a
                href={APP_INFO.repositoryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground hover:text-primary inline-flex max-w-full items-center gap-1.5 font-medium underline-offset-4 transition-colors hover:underline"
              >
                <span dir="ltr" className="truncate">
                  {APP_INFO.repositoryLabel}
                </span>
                <ExternalLinkIcon className="size-3.5 shrink-0 opacity-60" />
              </a>
            </InfoRow>
            <InfoRow label={t.about.license}>
              <a
                href={APP_INFO.licenseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground hover:text-primary inline-flex items-center gap-1.5 font-medium underline-offset-4 transition-colors hover:underline"
              >
                <ScaleIcon className="size-3.5 opacity-60" />
                {APP_INFO.license}
                <ExternalLinkIcon className="size-3.5 opacity-60" />
              </a>
            </InfoRow>
          </dl>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-base">{t.about.stack}</h2>
          <p className="text-muted-foreground text-sm">{t.about.stackHint}</p>
          <ul className="flex flex-wrap gap-2">
            {APP_STACK.map((item) => (
              <li key={item}>
                <span
                  dir="ltr"
                  className="border-border bg-card text-muted-foreground inline-flex rounded-full border px-3 py-1 text-xs font-medium"
                >
                  {item}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="surface-card flex flex-col gap-4 rounded-xl p-5 sm:p-6">
          <h2 className="text-base">{t.about.whatItIs}</h2>
          <p className="text-muted-foreground text-sm leading-relaxed text-pretty">
            {t.about.whatItIsBody}
          </p>
          <ul className="text-muted-foreground grid gap-2.5 text-sm">
            {t.about.highlights.map((line) => (
              <li key={line} className="flex gap-2.5">
                <span
                  aria-hidden
                  className="bg-primary/15 text-primary mt-1.5 size-1.5 shrink-0 rounded-full"
                />
                <span className="text-pretty">{line}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AboutShell>
  );
}
