"use client";

import { Alert, AlertDescription, AlertTitle } from "@kherad/ui/components/ui/alert";
import { Badge } from "@kherad/ui/components/ui/badge";
import { Button } from "@kherad/ui/components/ui/button";
import { MessageSquareIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  fetchAgentsHub,
  getToken,
  type AgentCatalogItem,
  type AgentSessionSummary,
} from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

function statusLabel(
  status: AgentSessionSummary["status"],
  t: ReturnType<typeof useI18n>["t"],
): string {
  switch (status) {
    case "draft_ready":
      return t.agents.statusDraftReady;
    case "imported":
      return t.agents.statusImported;
    case "archived":
      return t.agents.statusArchived;
    default:
      return t.agents.statusActive;
  }
}

export default function AgentsPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [agents, setAgents] = useState<AgentCatalogItem[]>([]);
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!getToken()) {
        router.replace("/login");
        return;
      }
      try {
        const hub = await fetchAgentsHub();
        if (cancelled) return;
        setAgents(hub.agents);
        setSessions(hub.sessions);
        setLoaded(true);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : t.agents.loadFailed;
        if (message.includes("Unauthorized")) {
          router.replace("/login");
          return;
        }
        if (message.includes("Forbidden")) setForbidden(true);
        setError(message);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, t.agents.loadFailed]);

  if (!loaded) {
    return (
      <div className="mx-auto w-full max-w-4xl p-6">
        <p className="text-muted-foreground text-sm">{t.common.loading}</p>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="mx-auto w-full max-w-4xl p-6">
        <Alert>
          <AlertTitle>{t.common.error}</AlertTitle>
          <AlertDescription>{t.agents.forbidden}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.agents.title}</h1>
        <p className="text-muted-foreground mt-1.5 text-sm">{t.agents.subtitle}</p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t.common.error}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2">
        {agents.map((agent) => (
          <Link
            key={agent.id}
            href="/agents/interviewer"
            className="border-border bg-card hover:bg-muted/40 group flex flex-col gap-3 rounded-2xl border p-5 transition-colors duration-150"
          >
            <div className="flex items-center gap-2">
              <span className="bg-primary/12 text-primary flex size-9 items-center justify-center rounded-xl">
                <MessageSquareIcon className="size-4" />
              </span>
              <h2 className="text-base font-semibold">{t.agents.interviewer}</h2>
            </div>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {t.agents.interviewerDesc}
            </p>
            <span className="text-primary text-sm font-medium group-hover:underline">
              {t.agents.newInterview}
            </span>
          </Link>
        ))}
        <div className="border-border bg-muted/20 text-muted-foreground flex flex-col gap-3 rounded-2xl border border-dashed p-5">
          <div className="flex items-center gap-2">
            <span className="bg-muted flex size-9 items-center justify-center rounded-xl">
              <SparklesIcon className="size-4" />
            </span>
            <h2 className="text-base font-semibold">{t.agents.comingSoon}</h2>
          </div>
          <p className="text-sm leading-relaxed">{t.agents.subtitle}</p>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-wide uppercase opacity-80">
            {t.agents.recentSessions}
          </h2>
          <Button size="sm" nativeButton={false} render={<Link href="/agents/interviewer" />}>
            {t.agents.newInterview}
          </Button>
        </div>
        {sessions.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.agents.noSessions}</p>
        ) : (
          <ul className="border-border divide-border divide-y overflow-hidden rounded-xl border">
            {sessions.map((session) => (
              <li key={session.id}>
                <Link
                  href={`/agents/interviewer/${session.id}`}
                  className="hover:bg-muted/40 flex items-center justify-between gap-3 px-4 py-3 transition-colors duration-150"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{session.title}</p>
                    {session.goal ? (
                      <p className="text-muted-foreground truncate text-xs">{session.goal}</p>
                    ) : null}
                  </div>
                  <Badge variant="secondary">{statusLabel(session.status, t)}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
