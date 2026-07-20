"use client";

import { Alert, AlertDescription, AlertTitle } from "@kherad/ui/components/ui/alert";
import { Badge } from "@kherad/ui/components/ui/badge";
import { Button } from "@kherad/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@kherad/ui/components/ui/dialog";
import { BriefcaseIcon, PlusIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  deleteAgentSession,
  fetchAgentsHub,
  getToken,
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

function statusVariant(
  status: AgentSessionSummary["status"],
): "secondary" | "success" | "outline" | "warning" {
  switch (status) {
    case "draft_ready":
      return "success";
    case "imported":
      return "outline";
    case "archived":
      return "secondary";
    default:
      return "secondary";
  }
}

function relativeTime(
  iso: string,
  t: ReturnType<typeof useI18n>["t"],
): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return t.agents.relativeJustNow;
  if (minutes < 60) return t.agents.relativeMinutes(minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return t.agents.relativeHours(hours);
  return t.agents.relativeDays(Math.floor(hours / 24));
}

export default function AgentsPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  async function handleDelete() {
    if (!deleteId) return;
    const id = deleteId;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAgentSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      setDeleteId(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : t.agents.deleteFailed);
    } finally {
      setDeleting(false);
    }
  }

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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.agents.title}</h1>
          <p className="text-muted-foreground mt-1.5 max-w-xl text-sm leading-relaxed">
            {t.agents.subtitle}
          </p>
        </div>
        <Button
          nativeButton={false}
          render={<Link href="/agents/new" />}
          className="shrink-0"
        >
          <PlusIcon className="size-4" />
          {t.agents.newSpecialist}
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t.common.error}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-xs font-semibold tracking-[0.06em] uppercase">
          {t.agents.recentSessions}
        </h2>

        {sessions.length === 0 ? (
          <div className="border-border bg-muted/20 flex flex-col items-center gap-4 rounded-2xl border border-dashed px-6 py-14 text-center">
            <span className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-2xl transition-transform duration-200 ease-out">
              <BriefcaseIcon className="size-5" />
            </span>
            <div className="max-w-sm">
              <p className="text-base font-semibold tracking-tight">
                {t.agents.emptySessionsTitle}
              </p>
              <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
                {t.agents.emptySessionsDesc}
              </p>
            </div>
            <Button nativeButton={false} render={<Link href="/agents/new" />}>
              {t.agents.newSpecialist}
            </Button>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {sessions.map((session) => (
              <li
                key={session.id}
                className="border-border bg-card has-[a:hover]:bg-muted/30 has-[a:active]:scale-[0.99] group relative flex h-full flex-col gap-3 rounded-2xl border p-4 transition-[background-color,transform,box-shadow] duration-150 ease-out motion-reduce:transition-colors motion-reduce:has-[a:active]:scale-100"
              >
                <Link
                  href={`/agents/${session.id}`}
                  aria-label={session.title}
                  className="absolute inset-0 z-0 rounded-2xl"
                />
                <div className="pointer-events-none relative z-10 flex items-start justify-between gap-2">
                  <p className="line-clamp-2 text-sm font-semibold tracking-tight group-has-[a:hover]:text-foreground">
                    {session.title}
                  </p>
                  <div className="pointer-events-auto flex shrink-0 items-center gap-1">
                    <Badge variant={statusVariant(session.status)}>
                      {statusLabel(session.status, t)}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t.common.remove}
                      onClick={(e) => {
                        e.preventDefault();
                        setDeleteError(null);
                        setDeleteId(session.id);
                      }}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2Icon className="size-3.5" />
                    </Button>
                  </div>
                </div>
                {session.goal ? (
                  <p className="text-muted-foreground pointer-events-none relative z-10 line-clamp-2 text-xs leading-relaxed">
                    {session.goal}
                  </p>
                ) : null}
                <div className="text-muted-foreground pointer-events-none relative z-10 mt-auto flex flex-wrap items-center gap-2 text-xs">
                  {session.role ? (
                    <span className="bg-muted/60 rounded-md px-1.5 py-0.5 font-medium">
                      {session.role}
                    </span>
                  ) : (
                    <span className="bg-muted/60 rounded-md px-1.5 py-0.5">
                      {t.agents.specialist}
                    </span>
                  )}
                  <span className="ms-auto tabular-nums">
                    {relativeTime(session.updatedAt, t)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.agents.deleteSession}</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">{t.agents.deleteConfirm}</p>
          {deleteError ? (
            <Alert variant="destructive">
              <AlertTitle>{t.common.error}</AlertTitle>
              <AlertDescription>{deleteError}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)} disabled={deleting}>
              {t.common.cancel}
            </Button>
            <Button variant="destructive" onClick={() => void handleDelete()} disabled={deleting}>
              {t.common.remove}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
