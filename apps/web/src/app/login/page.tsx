"use client";

import { Alert, AlertDescription } from "@kherad/ui/components/ui/alert";
import { Button } from "@kherad/ui/components/ui/button";
import { Input } from "@kherad/ui/components/ui/input";
import { Label } from "@kherad/ui/components/ui/label";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { clearToken, fetchCurrentUser, getToken, login, setToken } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/dashboard";
  const { t, locale, setLocale } = useI18n();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!getToken()) {
        if (!cancelled) setCheckingSession(false);
        return;
      }

      try {
        await fetchCurrentUser();
        if (!cancelled) router.replace(next);
      } catch {
        await clearToken();
        if (!cancelled) setCheckingSession(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router, next]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { token, user } = await login(email, password);
      await setToken(token);
      // The account's saved language wins over whatever the sign-in screen used.
      if (user.locale !== locale) setLocale(user.locale);
      router.push(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.login.failed);
      setSubmitting(false);
    }
  }

  if (checkingSession) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
        {t.common.loading}
      </div>
    );
  }

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background:radial-gradient(60%_50%_at_50%_35%,color-mix(in_oklch,var(--primary),transparent_92%),transparent)]"
      />
      <form
        onSubmit={handleSubmit}
        className="surface-card relative flex w-full max-w-sm flex-col gap-5 rounded-2xl p-6 shadow-sm"
      >
        <div className="flex flex-col items-center gap-1.5 text-center">
          <span className="text-muted-foreground text-xs font-medium uppercase tracking-[0.08em]">
            {t.common.appName}
          </span>
          <h1 className="text-xl font-semibold">{t.login.heading}</h1>
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">{t.login.email}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@kherad.local"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">{t.login.password}</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            dir="ltr"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <Button type="submit" className="mt-1" disabled={submitting}>
          {submitting ? t.login.submitting : t.common.signIn}
        </Button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
