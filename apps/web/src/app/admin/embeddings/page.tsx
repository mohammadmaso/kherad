"use client";

import { Alert, AlertDescription, AlertTitle } from "@kherad/ui/components/ui/alert";
import { Badge } from "@kherad/ui/components/ui/badge";
import { Button } from "@kherad/ui/components/ui/button";
import { Input } from "@kherad/ui/components/ui/input";
import { Label } from "@kherad/ui/components/ui/label";
import { useEffect, useState } from "react";

import {
  fetchEmbeddingSettings,
  saveEmbeddingSettings,
  startEmbeddingReindex,
  type EmbeddingReindexStatus,
} from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

export default function AdminEmbeddingsPage() {
  const { t } = useI18n();
  const a = t.adminEmbeddings;

  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [model, setModel] = useState("");
  const [configuredModel, setConfiguredModel] = useState("");
  const [reindex, setReindex] = useState<EmbeddingReindexStatus>({
    running: false,
    total: 0,
    done: 0,
    failed: 0,
    finishedAt: null,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await fetchEmbeddingSettings();
        if (cancelled) return;
        setBaseUrl(settings.baseUrl ?? "");
        setHasApiKey(settings.hasApiKey);
        setModel(settings.model);
        setConfiguredModel(settings.model);
        setReindex(settings.reindex);
        setLoaded(true);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : a.loadFailed);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [a.loadFailed]);

  // Poll progress while a reindex is running.
  useEffect(() => {
    if (!reindex.running) return;
    const id = setInterval(() => {
      fetchEmbeddingSettings()
        .then((settings) => setReindex(settings.reindex))
        .catch(() => {
          /* keep last known status */
        });
    }, 2000);
    return () => clearInterval(id);
  }, [reindex.running]);

  async function handleSave() {
    setSubmitting(true);
    setError(null);
    setSaved(false);
    try {
      const settings = await saveEmbeddingSettings({
        baseUrl: baseUrl.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        model,
      });
      setHasApiKey(settings.hasApiKey);
      setModel(settings.model);
      setConfiguredModel(settings.model);
      setBaseUrl(settings.baseUrl ?? "");
      setApiKey("");
      setReindex(settings.reindex);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : a.saveFailed);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReindex() {
    setError(null);
    try {
      const status = await startEmbeddingReindex();
      setReindex(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : a.reindexFailed);
    }
  }

  const modelChanging = model.trim() && model.trim() !== configuredModel;
  const configured = hasApiKey && Boolean(baseUrl.trim());

  if (!loaded && !error) {
    return <p className="text-muted-foreground text-sm">{t.common.loading}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{a.title}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{a.subtitle}</p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t.common.error}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="emb-base-url">
          {a.baseUrl}{" "}
          <span className="text-muted-foreground font-normal">{t.admin.required}</span>
        </Label>
        <Input
          id="emb-base-url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://llm.example.com/v1"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="emb-api-key" className="flex items-center gap-2">
          {a.apiKey}
          {hasApiKey ? <Badge variant="success">{t.admin.keyIsSet}</Badge> : null}
        </Label>
        <Input
          id="emb-api-key"
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={hasApiKey ? a.apiKeyConfiguredPlaceholder : "sk-…"}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="emb-model">{a.model}</Label>
        <Input
          id="emb-model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={DEFAULT_EMBEDDING_MODEL}
        />
        <p className="text-muted-foreground text-xs">{a.modelHint}</p>
        {modelChanging ? (
          <p className="text-amber-700 dark:text-amber-400 text-xs">{a.modelChangeWarning}</p>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <Button
          disabled={submitting || (!hasApiKey && !apiKey.trim()) || !baseUrl.trim()}
          onClick={handleSave}
        >
          {submitting ? t.common.saving : a.save}
        </Button>
        {saved ? <span className="text-muted-foreground text-sm">{a.saved}</span> : null}
      </div>

      <div className="border-border mt-2 flex flex-col gap-2 border-t pt-4">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            disabled={!configured || reindex.running}
            onClick={handleReindex}
          >
            {reindex.running ? a.reindexRunning : a.reindex}
          </Button>
          {!configured ? (
            <span className="text-muted-foreground text-sm">{a.notConfigured}</span>
          ) : null}
        </div>
        {reindex.total > 0 || reindex.running ? (
          <p className="text-muted-foreground text-sm tabular-nums">
            {a.reindexDone} {reindex.done}/{reindex.total}
            {reindex.failed > 0 ? ` · ${a.reindexFailed}: ${reindex.failed}` : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}
