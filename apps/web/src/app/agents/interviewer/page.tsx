"use client";

import { Alert, AlertDescription, AlertTitle } from "@kherad/ui/components/ui/alert";
import { Button } from "@kherad/ui/components/ui/button";
import { Input } from "@kherad/ui/components/ui/input";
import { Label } from "@kherad/ui/components/ui/label";
import { Select } from "@kherad/ui/components/ui/select";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  createInterviewerSession,
  fetchInterviewerBundles,
  getToken,
  type AgentBundleOption,
} from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

export default function NewInterviewerPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [goal, setGoal] = useState("");
  const [bundleId, setBundleId] = useState("");
  const [bundles, setBundles] = useState<AgentBundleOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!getToken()) {
        router.replace("/login");
        return;
      }
      try {
        const rows = await fetchInterviewerBundles();
        if (!cancelled) {
          setBundles(rows);
          setLoaded(true);
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : t.agents.loadFailed;
        if (message.includes("Unauthorized")) {
          router.replace("/login");
          return;
        }
        if (message.includes("Forbidden")) {
          setError(t.agents.forbidden);
        } else {
          setError(message);
        }
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, t.agents.forbidden, t.agents.loadFailed]);

  async function handleStart() {
    setSubmitting(true);
    setError(null);
    try {
      const session = await createInterviewerSession({
        goal: goal.trim() || undefined,
        bundleId: bundleId || null,
      });
      router.push(`/agents/interviewer/${session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.agents.loadFailed);
      setSubmitting(false);
    }
  }

  if (!loaded) {
    return (
      <div className="mx-auto w-full max-w-lg p-6">
        <p className="text-muted-foreground text-sm">{t.common.loading}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 p-6">
      <div>
        <Link
          href="/agents"
          className="text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          {t.agents.title}
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">{t.agents.newInterview}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t.agents.interviewerDesc}</p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t.common.error}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="interview-goal">{t.agents.goalLabel}</Label>
          <Input
            id="interview-goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder={t.agents.goalPlaceholder}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="interview-bundle">{t.agents.bundleLabel}</Label>
          <Select
            id="interview-bundle"
            value={bundleId}
            onChange={(e) => setBundleId(e.target.value)}
          >
            <option value="">{t.agents.bundleNone}</option>
            {bundles.map((bundle) => (
              <option key={bundle.id} value={bundle.id}>
                {bundle.title}
              </option>
            ))}
          </Select>
          <p className="text-muted-foreground text-xs">{t.agents.bundleHint}</p>
        </div>
        <Button onClick={() => void handleStart()} disabled={submitting}>
          {submitting ? t.common.loading : t.agents.startInterview}
        </Button>
      </div>
    </div>
  );
}
