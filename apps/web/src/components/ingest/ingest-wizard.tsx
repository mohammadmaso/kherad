"use client";

import { Alert, AlertDescription, AlertTitle } from "@kherad/ui/components/ui/alert";
import { Button } from "@kherad/ui/components/ui/button";
import { Input } from "@kherad/ui/components/ui/input";
import { Label } from "@kherad/ui/components/ui/label";
import { Select } from "@kherad/ui/components/ui/select";
import { pagePathFromTitle } from "@kherad/core/page-paths";
import {
  ArrowLeft,
  AudioLinesIcon,
  CheckIcon,
  FileTextIcon,
  Loader2Icon,
  MicIcon,
  ScanTextIcon,
  UploadIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";

import { Editor } from "@/components/editor/editor";
import { AudioWaveformPlayer } from "@/components/ingest/audio-waveform-player";
import { FilePreview } from "@/components/ingest/file-preview";
import { VoiceRecorder } from "@/components/ingest/voice-recorder";
import {
  commitIngestDocument,
  convertIngestDocument,
  fetchBundle,
  fetchMyBundles,
  fetchOcrStatus,
  fetchSttStatus,
  ocrIngestDocument,
  suggestIngestPlacement,
  transcribeIngestAudio,
  type AdminBundle,
  type IngestPageImage,
} from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

type Step = "upload" | "edit" | "place";
type SourceKind = "document" | "voice";
type ConvertMode = "library" | "ocr";
type VoiceInputMode = "record" | "upload";

const DOCUMENT_ACCEPT =
  ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.html,.htm,.md,.txt,.png,.jpg,.jpeg,.webp,.gif,.bmp";
const VOICE_ACCEPT = "audio/*,.mp3,.wav,.m4a,.ogg,.oga,.opus,.flac,.webm,.aac,.mp4";

function StepPill({
  index,
  label,
  active,
  done,
}: {
  index: number;
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <li
      className={`flex items-center gap-2 text-sm transition-colors duration-200 ease-[var(--ease-out-spring)] ${
        active
          ? "text-foreground font-medium"
          : done
            ? "text-foreground/70"
            : "text-muted-foreground"
      }`}
      aria-current={active ? "step" : undefined}
    >
      <span
        className={`flex size-7 items-center justify-center rounded-full text-xs font-semibold transition-[background-color,color,transform] duration-200 ease-[var(--ease-out-spring)] ${
          active
            ? "bg-primary text-primary-foreground scale-105"
            : done
              ? "bg-primary/15 text-primary"
              : "bg-muted text-muted-foreground"
        }`}
      >
        {done && !active ? <CheckIcon className="size-3.5" /> : index}
      </span>
      <span className="hidden sm:inline">{label}</span>
    </li>
  );
}

function ChoiceCard({
  selected,
  disabled,
  onSelect,
  icon,
  title,
  description,
}: {
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={`surface-card flex flex-col items-start gap-2 rounded-2xl p-4 text-start transition-[transform,box-shadow,border-color,background-color] duration-200 ease-[var(--ease-out-spring)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${
        selected
          ? "border-primary ring-primary/20 bg-primary/5 ring-2"
          : "border-border hover:border-foreground/20"
      }`}
    >
      <span
        className={`flex size-9 items-center justify-center rounded-xl transition-colors duration-150 ${
          selected ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
        }`}
      >
        {icon}
      </span>
      <span className="text-sm font-medium">{title}</span>
      <span className="text-muted-foreground text-xs leading-relaxed">{description}</span>
    </button>
  );
}

export function IngestWizard({
  bundleId: initialBundleId,
  showBundlePicker,
}: {
  bundleId?: string;
  showBundlePicker?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [bundleId, setBundleId] = useState(initialBundleId ?? "");
  const [bundle, setBundle] = useState<AdminBundle | null>(null);
  const [pickerBundles, setPickerBundles] = useState<AdminBundle[]>([]);
  const [ocrConfigured, setOcrConfigured] = useState(false);
  const [sttConfigured, setSttConfigured] = useState(false);
  const [sourceKind, setSourceKind] = useState<SourceKind>("document");
  const [voiceInputMode, setVoiceInputMode] = useState<VoiceInputMode>("record");
  const [mode, setMode] = useState<ConvertMode>("library");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [jobId, setJobId] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [pageImages, setPageImages] = useState<IngestPageImage[]>([]);
  const [audioObjectUrl, setAudioObjectUrl] = useState<string | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [filename, setFilename] = useState("");
  const [format, setFormat] = useState("");
  const [titleHint, setTitleHint] = useState("");
  const [editorKey, setEditorKey] = useState(0);

  const [title, setTitle] = useState("");
  const [path, setPath] = useState("");
  const [aiSuggested, setAiSuggested] = useState(false);
  const suggestedPath = title.trim() && !path.trim() ? pagePathFromTitle(title) : "";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [ocr, stt] = await Promise.all([fetchOcrStatus(), fetchSttStatus()]);
        if (cancelled) return;
        setOcrConfigured(ocr.configured);
        setSttConfigured(stt.configured);
      } catch {
        if (!cancelled) {
          setOcrConfigured(false);
          setSttConfigured(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!showBundlePicker) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchMyBundles();
        if (!cancelled) setPickerBundles(rows.filter((b) => b.role !== "viewer"));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t.ingest.loadBundlesFailed);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showBundlePicker, t.ingest.loadBundlesFailed]);

  useEffect(() => {
    if (!bundleId) return;
    let cancelled = false;
    (async () => {
      try {
        const row = await fetchBundle(bundleId);
        if (!cancelled) setBundle(row);
      } catch (err) {
        if (!cancelled) {
          setBundle(null);
          setError(err instanceof Error ? err.message : t.bundles.loadFailed);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bundleId, t.bundles.loadFailed]);

  useEffect(() => {
    return () => {
      if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
    };
  }, [audioObjectUrl]);

  const pagePreviewUrls = useMemo(
    () =>
      pageImages.map((page) => ({
        page: page.page,
        url: `data:${page.mime};base64,${page.base64}`,
      })),
    [pageImages],
  );

  const stepIndex = step === "upload" ? 0 : step === "edit" ? 1 : 2;

  async function handleFile(file: File | null) {
    if (!file) return;
    if (!bundleId) {
      setError(t.ingest.selectBundleFirst);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (sourceKind === "voice") {
        if (!sttConfigured) throw new Error(t.ingest.sttUnavailable);
        const result = await transcribeIngestAudio(bundleId, file);
        if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
        setAudioObjectUrl(URL.createObjectURL(file));
        setSourceFile(null);
        setJobId(result.jobId);
        setPageImages([]);
        setFilename(result.filename);
        setFormat(result.format);
        setTitleHint(result.titleHint);
        setMarkdown(result.markdown);
        setEditorKey((k) => k + 1);
        setTitle(result.titleHint || file.name.replace(/\.[^.]+$/, ""));
        setPath("");
        setAiSuggested(false);
        setStep("edit");
        return;
      }

      if (audioObjectUrl) {
        URL.revokeObjectURL(audioObjectUrl);
        setAudioObjectUrl(null);
      }

      const result = await convertIngestDocument(bundleId, file);
      setSourceFile(file);
      setJobId(result.jobId);
      setPageImages(result.pageImages);
      setFilename(result.filename);
      setFormat(result.format);
      setTitleHint(result.titleHint);
      let md = result.markdown;
      if (mode === "ocr") {
        if (!ocrConfigured) throw new Error(t.ingest.ocrUnavailable);
        if (result.pageImages.length === 0) throw new Error(t.ingest.ocrFailed);
        const ocr = await ocrIngestDocument(bundleId, result.jobId);
        md = ocr.markdown;
      }
      setMarkdown(md);
      setEditorKey((k) => k + 1);
      setTitle(result.titleHint || file.name.replace(/\.[^.]+$/, ""));
      setPath("");
      setAiSuggested(false);
      setStep("edit");
    } catch (err) {
      const fallback =
        sourceKind === "voice"
          ? t.ingest.sttFailed
          : mode === "ocr"
            ? t.ingest.ocrFailed
            : t.ingest.convertFailed;
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (busy || !bundleId) return;
    const file = event.dataTransfer.files?.[0] ?? null;
    void handleFile(file);
  }

  async function goToPlace() {
    if (!bundleId || !bundle) return;
    setBusy(true);
    setError(null);
    try {
      if (bundle.mode === "llm_compiled") {
        try {
          const suggestion = await suggestIngestPlacement(bundleId, {
            markdown,
            filename,
          });
          setTitle(suggestion.title);
          setPath(suggestion.path);
          setAiSuggested(true);
        } catch {
          if (!title.trim()) setTitle(titleHint || filename);
          setAiSuggested(false);
          setError(t.ingest.suggestFailed);
        }
      } else if (!title.trim()) {
        setTitle(titleHint || filename);
      }
      setStep("place");
    } finally {
      setBusy(false);
    }
  }

  async function handleCommit() {
    if (!bundleId || !title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const page = await commitIngestDocument(bundleId, {
        title: title.trim(),
        path: path.trim() || suggestedPath,
        markdown,
        ...(jobId ? { jobId } : {}),
      });
      router.push(`/bundles/${bundleId}/pages/${page.id}/edit`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.ingest.commitFailed);
      setBusy(false);
    }
  }

  const busyLabel =
    sourceKind === "voice"
      ? t.ingest.transcribing
      : mode === "ocr"
        ? t.ingest.runningOcr
        : t.ingest.converting;

  return (
    <div className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-6 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-64 bg-[radial-gradient(ellipse_at_top,var(--color-primary)/0.08,transparent_65%)]"
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link
            href={bundleId ? `/bundles/${bundleId}` : "/dashboard"}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm transition-colors duration-150"
          >
            <ArrowLeft className="size-3.5 rtl:rotate-180" />
            {bundleId ? t.common.back : t.bundles.backDocs}
          </Link>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{t.ingest.title}</h1>
          <p className="text-muted-foreground mt-1 max-w-xl text-sm leading-relaxed">
            {t.ingest.subtitle}
          </p>
          {bundle ? (
            <p className="text-muted-foreground mt-2 text-sm">
              <span className="text-foreground font-medium" dir="auto">
                {bundle.title}
              </span>{" "}
              <span className="font-mono text-xs">({bundle.slug})</span>
            </p>
          ) : null}
        </div>

        <ol className="flex items-center gap-4 sm:gap-6">
          <StepPill
            index={1}
            label={t.ingest.stepUpload}
            active={step === "upload"}
            done={stepIndex > 0}
          />
          <span className="bg-border h-px w-6 sm:w-10" aria-hidden />
          <StepPill
            index={2}
            label={t.ingest.stepEdit}
            active={step === "edit"}
            done={stepIndex > 1}
          />
          <span className="bg-border h-px w-6 sm:w-10" aria-hidden />
          <StepPill index={3} label={t.ingest.stepPlace} active={step === "place"} done={false} />
        </ol>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t.common.error}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {step === "upload" ? (
        <div className="flex flex-col gap-6">
          {showBundlePicker ? (
            <div className="flex max-w-md flex-col gap-1.5">
              <Label htmlFor="ingest-bundle">{t.ingest.pickBundle}</Label>
              <Select
                id="ingest-bundle"
                value={bundleId}
                onChange={(e) => {
                  const next = e.target.value;
                  setBundleId(next);
                  if (!next) setBundle(null);
                }}
              >
                <option value="">{t.ingest.pickBundlePlaceholder}</option>
                {pickerBundles.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <ChoiceCard
              selected={sourceKind === "document"}
              onSelect={() => setSourceKind("document")}
              icon={<FileTextIcon className="size-4" />}
              title={t.ingest.sourceDocument}
              description={t.ingest.sourceDocumentDesc}
            />
            <ChoiceCard
              selected={sourceKind === "voice"}
              disabled={!sttConfigured}
              onSelect={() => setSourceKind("voice")}
              icon={<AudioLinesIcon className="size-4" />}
              title={t.ingest.sourceVoice}
              description={sttConfigured ? t.ingest.sourceVoiceDesc : t.ingest.sttUnavailable}
            />
          </div>

          {sourceKind === "document" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <ChoiceCard
                selected={mode === "library"}
                onSelect={() => setMode("library")}
                icon={<FileTextIcon className="size-4" />}
                title={t.ingest.modeLibrary}
                description={t.ingest.modeLibraryDesc}
              />
              <ChoiceCard
                selected={mode === "ocr"}
                disabled={!ocrConfigured}
                onSelect={() => setMode("ocr")}
                icon={<ScanTextIcon className="size-4" />}
                title={t.ingest.modeOcr}
                description={ocrConfigured ? t.ingest.modeOcrDesc : t.ingest.ocrUnavailable}
              />
            </div>
          ) : null}

          {sourceKind === "voice" && sttConfigured ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant={voiceInputMode === "record" ? "default" : "outline"}
                disabled={busy || !bundleId}
                onClick={() => setVoiceInputMode("record")}
              >
                <MicIcon />
                {t.ingest.voiceInputRecord}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={voiceInputMode === "upload" ? "default" : "outline"}
                disabled={busy}
                onClick={() => setVoiceInputMode("upload")}
              >
                <UploadIcon />
                {t.ingest.voiceInputUpload}
              </Button>
            </div>
          ) : null}

          {sourceKind === "voice" && sttConfigured && voiceInputMode === "record" ? (
            <VoiceRecorder
              disabled={busy || !bundleId}
              onUseRecording={(file) => void handleFile(file)}
            />
          ) : (
            <div
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (!busy && bundleId) fileInputRef.current?.click();
                }
              }}
              onClick={() => {
                if (!busy && bundleId) fileInputRef.current?.click();
              }}
              onDragEnter={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragging(false);
              }}
              onDrop={onDrop}
              className={`relative flex min-h-[14rem] cursor-pointer flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed px-6 py-10 text-center transition-[border-color,background-color,transform] duration-200 ease-[var(--ease-out-spring)] ${
                dragging
                  ? "border-primary bg-primary/5 scale-[1.01]"
                  : "border-border hover:border-foreground/25 hover:bg-muted/30"
              } ${!bundleId || busy ? "pointer-events-none opacity-60" : ""}`}
            >
              <span
                className={`flex size-12 items-center justify-center rounded-2xl transition-transform duration-200 ease-[var(--ease-out-spring)] ${
                  dragging
                    ? "bg-primary/15 text-primary scale-110"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {busy ? (
                  <Loader2Icon className="size-5 animate-spin" />
                ) : sourceKind === "voice" ? (
                  <AudioLinesIcon className="size-5" />
                ) : (
                  <UploadIcon className="size-5" />
                )}
              </span>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">
                  {busy
                    ? busyLabel
                    : sourceKind === "voice"
                      ? t.ingest.dropVoice
                      : t.ingest.dropDocument}
                </p>
                {!busy ? (
                  <p className="text-muted-foreground text-xs">{t.ingest.orBrowse}</p>
                ) : null}
              </div>
              <p className="text-muted-foreground max-w-sm text-xs leading-relaxed">
                {sourceKind === "voice" ? t.ingest.voiceTypes : t.ingest.documentTypes}
              </p>
              {!bundleId ? (
                <p className="text-muted-foreground text-xs">{t.ingest.selectBundleFirst}</p>
              ) : null}
              <input
                ref={fileInputRef}
                type="file"
                className="sr-only"
                accept={sourceKind === "voice" ? VOICE_ACCEPT : DOCUMENT_ACCEPT}
                disabled={busy || !bundleId}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  void handleFile(file);
                }}
              />
            </div>
          )}
        </div>
      ) : null}

      {step === "edit" ? (
        <div className="flex flex-col gap-4">
          <div className="text-muted-foreground flex flex-wrap gap-4 text-xs">
            <span>
              {t.ingest.filename}: <span className="text-foreground font-mono">{filename}</span>
            </span>
            <span>
              {t.ingest.format}: <span className="text-foreground font-mono">{format}</span>
            </span>
          </div>
          <div className="grid min-h-[28rem] grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="border-border flex flex-col overflow-hidden rounded-2xl border">
              <div className="border-border bg-muted/40 border-b px-3 py-2 text-sm font-medium">
                {audioObjectUrl ? t.ingest.audioPreview : t.ingest.sourcePreview}
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                {audioObjectUrl ? (
                  <div className="flex flex-col items-center justify-center gap-4 py-8">
                    <span className="bg-primary/10 text-primary flex size-14 items-center justify-center rounded-2xl">
                      <AudioLinesIcon className="size-6" />
                    </span>
                    <AudioWaveformPlayer src={audioObjectUrl} />
                    <p className="text-muted-foreground text-center text-xs" dir="auto">
                      {filename}
                    </p>
                  </div>
                ) : pagePreviewUrls.length > 0 ? (
                  <div className="flex flex-col gap-4">
                    {pagePreviewUrls.map((page) => (
                      <figure key={page.page} className="flex flex-col gap-1">
                        <figcaption className="text-muted-foreground text-xs">
                          {t.ingest.pageLabel(page.page)}
                        </figcaption>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={page.url}
                          alt={t.ingest.pageLabel(page.page)}
                          className="border-border bg-background w-full rounded-md border"
                        />
                      </figure>
                    ))}
                  </div>
                ) : sourceFile ? (
                  <FilePreview file={sourceFile} filename={filename} format={format} />
                ) : (
                  <p className="text-muted-foreground text-sm">{t.ingest.noPagePreview}</p>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">{t.ingest.markdownEditable}</p>
              <Editor
                key={editorKey}
                initialMarkdown={markdown}
                onMarkdownChange={setMarkdown}
                bundleId={bundleId}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setStep("upload")}>
              {t.ingest.back}
            </Button>
            <Button disabled={busy || !markdown.trim()} onClick={() => void goToPlace()}>
              {busy ? t.ingest.suggesting : t.ingest.continue}
            </Button>
          </div>
        </div>
      ) : null}

      {step === "place" ? (
        <div className="surface-card mx-auto flex w-full max-w-lg flex-col gap-4 rounded-2xl p-6">
          {aiSuggested ? (
            <p className="text-muted-foreground text-sm">{t.ingest.aiSuggested}</p>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ingest-title">{t.bundles.titleLabel}</Label>
            <Input
              id="ingest-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t.bundles.titlePlaceholder}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ingest-path">{t.bundles.pathOptional}</Label>
            <Input
              id="ingest-path"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder={suggestedPath || "getting-started"}
            />
            {suggestedPath ? (
              <p className="text-muted-foreground text-xs">
                {t.bundles.pathHintPrefix} <span className="font-mono">/{suggestedPath}</span>
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button variant="outline" disabled={busy} onClick={() => setStep("edit")}>
              {t.ingest.back}
            </Button>
            <Button disabled={busy || !title.trim()} onClick={() => void handleCommit()}>
              {busy ? t.ingest.saving : t.ingest.saveToWiki}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
