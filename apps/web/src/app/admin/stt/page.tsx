"use client";

import { Alert, AlertDescription, AlertTitle } from "@kherad/ui/components/ui/alert";
import { Badge } from "@kherad/ui/components/ui/badge";
import { Button } from "@kherad/ui/components/ui/button";
import { Input } from "@kherad/ui/components/ui/input";
import { Label } from "@kherad/ui/components/ui/label";
import { useEffect, useState } from "react";

import { fetchSttSettings, saveSttSettings } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

const DEFAULT_STT_MODEL = "whisper-1";

export default function AdminSttPage() {
  const { t } = useI18n();
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [model, setModel] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await fetchSttSettings();
        if (cancelled) return;
        setBaseUrl(settings.baseUrl ?? "");
        setHasApiKey(settings.hasApiKey);
        setModel(settings.model);
        setLoaded(true);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : t.admin.loadSttFailed);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t.admin.loadSttFailed]);

  async function handleSave() {
    setSubmitting(true);
    setError(null);
    setSaved(false);
    try {
      const settings = await saveSttSettings({
        baseUrl: baseUrl.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        model,
      });
      setHasApiKey(settings.hasApiKey);
      setModel(settings.model);
      setBaseUrl(settings.baseUrl ?? "");
      setApiKey("");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.admin.saveSttFailed);
    } finally {
      setSubmitting(false);
    }
  }

  if (!loaded && !error) {
    return <p className="text-muted-foreground text-sm">{t.common.loading}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{t.admin.sttHeading}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{t.admin.sttDesc}</p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t.common.error}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="stt-base-url">
          {t.admin.baseUrl}{" "}
          <span className="text-muted-foreground font-normal">{t.admin.required}</span>
        </Label>
        <Input
          id="stt-base-url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://llm.example.com/v1"
        />
        <p className="text-muted-foreground text-xs">{t.admin.sttBaseUrlHint}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="stt-api-key" className="flex items-center gap-2">
          {t.admin.apiKey}
          {hasApiKey ? <Badge variant="success">{t.admin.keyIsSet}</Badge> : null}
        </Label>
        <Input
          id="stt-api-key"
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={hasApiKey ? t.admin.leaveBlankKey : "sk-…"}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="stt-model">{t.admin.sttModel}</Label>
        <Input
          id="stt-model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={DEFAULT_STT_MODEL}
        />
        <p className="text-muted-foreground text-xs">{t.admin.sttModelHint}</p>
      </div>

      <div className="flex items-center gap-3">
        <Button
          disabled={submitting || (!hasApiKey && !apiKey.trim()) || !baseUrl.trim()}
          onClick={handleSave}
        >
          {submitting ? t.common.saving : t.common.save}
        </Button>
        {saved ? <span className="text-muted-foreground text-sm">{t.common.saved}</span> : null}
      </div>
    </div>
  );
}
