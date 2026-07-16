"use client";

import { Alert, AlertDescription, AlertTitle } from "@kherad/ui/components/ui/alert";
import { Badge } from "@kherad/ui/components/ui/badge";
import { Button } from "@kherad/ui/components/ui/button";
import { Input } from "@kherad/ui/components/ui/input";
import { Label } from "@kherad/ui/components/ui/label";
import { useEffect, useState } from "react";

import { fetchOcrSettings, saveOcrSettings } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

const DEFAULT_OCR_MODEL = "gpt-4o";

export default function AdminOcrPage() {
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
        const settings = await fetchOcrSettings();
        if (cancelled) return;
        setBaseUrl(settings.baseUrl ?? "");
        setHasApiKey(settings.hasApiKey);
        setModel(settings.model);
        setLoaded(true);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : t.admin.loadOcrFailed);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t.admin.loadOcrFailed]);

  async function handleSave() {
    setSubmitting(true);
    setError(null);
    setSaved(false);
    try {
      const settings = await saveOcrSettings({
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
      setError(err instanceof Error ? err.message : t.admin.saveOcrFailed);
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
        <h2 className="text-lg font-semibold">{t.admin.ocrHeading}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{t.admin.ocrDesc}</p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t.common.error}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ocr-base-url">
          {t.admin.baseUrl} <span className="text-muted-foreground font-normal">{t.admin.required}</span>
        </Label>
        <Input
          id="ocr-base-url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://llm.example.com/v1"
        />
        <p className="text-muted-foreground text-xs">{t.admin.ocrBaseUrlHint}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ocr-api-key" className="flex items-center gap-2">
          {t.admin.apiKey}
          {hasApiKey ? <Badge variant="success">{t.admin.keyIsSet}</Badge> : null}
        </Label>
        <Input
          id="ocr-api-key"
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={hasApiKey ? t.admin.leaveBlankKey : "sk-…"}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ocr-model">{t.admin.ocrModel}</Label>
        <Input
          id="ocr-model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={DEFAULT_OCR_MODEL}
        />
        <p className="text-muted-foreground text-xs">{t.admin.ocrModelHint}</p>
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
