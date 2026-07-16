"use client";

import { Alert, AlertDescription, AlertTitle } from "@kherad/ui/components/ui/alert";
import { Badge } from "@kherad/ui/components/ui/badge";
import { Button } from "@kherad/ui/components/ui/button";
import { Input } from "@kherad/ui/components/ui/input";
import { Label } from "@kherad/ui/components/ui/label";
import { Select } from "@kherad/ui/components/ui/select";
import { useEffect, useState } from "react";

import { fetchAiSettings, saveAiSettings, type AiProvider } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

const DEFAULT_INDEXER_MODEL = "claude-opus-4-8";
const DEFAULT_CHAT_MODEL = "claude-sonnet-5";

export default function AdminAiPage() {
  const { t } = useI18n();
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [provider, setProvider] = useState<AiProvider>("anthropic");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [indexerModel, setIndexerModel] = useState("");
  const [chatModel, setChatModel] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await fetchAiSettings();
        if (cancelled) return;
        setProvider(settings.provider);
        setBaseUrl(settings.baseUrl ?? "");
        setHasApiKey(settings.hasApiKey);
        setIndexerModel(settings.indexerModel);
        setChatModel(settings.chatModel);
        setLoaded(true);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : t.admin.loadAiFailed);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t.admin.loadAiFailed]);

  async function handleSave() {
    setSubmitting(true);
    setError(null);
    setSaved(false);
    try {
      const settings = await saveAiSettings({
        provider,
        baseUrl: baseUrl.trim() || null,
        // Blank keeps the stored key (it is write-only and never echoed back).
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        indexerModel,
        chatModel,
      });
      setHasApiKey(settings.hasApiKey);
      setIndexerModel(settings.indexerModel);
      setChatModel(settings.chatModel);
      setApiKey("");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.admin.saveAiFailed);
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
        <h2 className="text-lg font-semibold">{t.admin.aiHeading}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{t.admin.aiDesc}</p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t.common.error}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ai-provider">{t.admin.provider}</Label>
        <Select
          id="ai-provider"
          value={provider}
          onChange={(event) => setProvider(event.target.value as AiProvider)}
        >
          <option value="anthropic">{t.admin.anthropic}</option>
          <option value="openai_compatible">{t.admin.openaiCompatible}</option>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ai-base-url">
          {t.admin.baseUrl}{" "}
          <span className="text-muted-foreground font-normal">
            {provider === "anthropic" ? t.admin.optionalGateway : t.admin.required}
          </span>
        </Label>
        <Input
          id="ai-base-url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={
            provider === "anthropic" ? "https://api.anthropic.com" : "https://llm.example.com/v1"
          }
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ai-api-key" className="flex items-center gap-2">
          {t.admin.apiKey}
          {hasApiKey ? <Badge variant="success">{t.admin.keyIsSet}</Badge> : null}
        </Label>
        <Input
          id="ai-api-key"
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={hasApiKey ? t.admin.leaveBlankKey : "sk-…"}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-indexer-model">{t.admin.indexerModel}</Label>
          <Input
            id="ai-indexer-model"
            value={indexerModel}
            onChange={(e) => setIndexerModel(e.target.value)}
            placeholder={DEFAULT_INDEXER_MODEL}
          />
          <p className="text-muted-foreground text-xs">{t.admin.indexerHint}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-chat-model">{t.admin.chatModel}</Label>
          <Input
            id="ai-chat-model"
            value={chatModel}
            onChange={(e) => setChatModel(e.target.value)}
            placeholder={DEFAULT_CHAT_MODEL}
          />
          <p className="text-muted-foreground text-xs">{t.admin.chatHint}</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button
          disabled={
            submitting ||
            (!hasApiKey && !apiKey.trim()) ||
            (provider === "openai_compatible" && !baseUrl.trim())
          }
          onClick={handleSave}
        >
          {submitting ? t.common.saving : t.common.save}
        </Button>
        {saved ? <span className="text-muted-foreground text-sm">{t.common.saved}</span> : null}
      </div>
    </div>
  );
}
