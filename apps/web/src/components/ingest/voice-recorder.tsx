"use client";

import { Button } from "@kherad/ui/components/ui/button";
import { CheckIcon, MicIcon, PauseIcon, PlayIcon, RotateCcwIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type WaveSurfer from "wavesurfer.js";
import type RecordPlugin from "wavesurfer.js/plugins/record";

import { useI18n } from "@/lib/i18n/provider";
import { formatDuration, readCssColor } from "./ingest-format";

type Phase = "idle" | "recording" | "paused" | "reviewing";

function extensionFor(mimeType: string): string {
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  return "webm";
}

export function VoiceRecorder({
  disabled,
  onUseRecording,
}: {
  disabled?: boolean;
  onUseRecording: (file: File) => void;
}) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const recordRef = useRef<RecordPlugin | null>(null);
  const blobRef = useRef<Blob | null>(null);

  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [durationMs, setDurationMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [{ default: WaveSurfer }, { default: RecordPluginCtor }] = await Promise.all([
        import("wavesurfer.js"),
        import("wavesurfer.js/plugins/record"),
      ]);
      if (cancelled || !containerRef.current) return;

      const el = containerRef.current;
      const waveColor = readCssColor(el, "--color-muted-foreground", "#a1a1aa");
      const progressColor = readCssColor(el, "--color-primary", "#6366f1");

      const ws = WaveSurfer.create({
        container: el,
        height: 64,
        waveColor,
        progressColor,
        cursorWidth: 1,
        barWidth: 2,
        barGap: 2,
        barRadius: 2,
        normalize: true,
      });

      const record = ws.registerPlugin(
        RecordPluginCtor.create({ scrollingWaveform: true, renderRecordedAudio: true }),
      );
      record.on("record-progress", (ms) => {
        if (!cancelled) setDurationMs(ms);
      });
      record.on("record-end", (blob) => {
        blobRef.current = blob;
        if (!cancelled) setPhase("reviewing");
      });
      ws.on("play", () => {
        if (!cancelled) setIsPlaying(true);
      });
      ws.on("pause", () => {
        if (!cancelled) setIsPlaying(false);
      });
      ws.on("finish", () => {
        if (!cancelled) setIsPlaying(false);
      });

      wavesurferRef.current = ws;
      recordRef.current = record;
      if (!cancelled) setReady(true);
    })();

    return () => {
      cancelled = true;
      recordRef.current?.stopRecording();
      wavesurferRef.current?.destroy();
      wavesurferRef.current = null;
      recordRef.current = null;
    };
  }, []);

  async function start() {
    setError(null);
    blobRef.current = null;
    setDurationMs(0);
    try {
      await recordRef.current?.startRecording();
      setPhase("recording");
    } catch {
      setError(t.ingest.micPermissionDenied);
    }
  }

  function stop() {
    recordRef.current?.stopRecording();
  }

  function pause() {
    recordRef.current?.pauseRecording();
    setPhase("paused");
  }

  function resume() {
    recordRef.current?.resumeRecording();
    setPhase("recording");
  }

  function discard() {
    blobRef.current = null;
    setDurationMs(0);
    setIsPlaying(false);
    setPhase("idle");
  }

  function togglePlay() {
    wavesurferRef.current?.playPause();
  }

  function useRecording() {
    const blob = blobRef.current;
    if (!blob) return;
    const file = new File([blob], `recording-${Date.now()}.${extensionFor(blob.type)}`, {
      type: blob.type,
    });
    onUseRecording(file);
  }

  const isRecording = phase === "recording";
  const isPaused = phase === "paused";
  const isReviewing = phase === "reviewing";
  const statusLabel = isRecording
    ? t.ingest.recordingBadge
    : isPaused
      ? t.ingest.pausedBadge
      : isReviewing
        ? t.ingest.recordReadyLabel
        : t.ingest.recordIdleLabel;

  return (
    <div className="surface-card flex flex-col gap-4 rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          {isRecording || isPaused ? (
            <span
              className={`bg-destructive size-2 rounded-full ${
                isRecording ? "motion-safe:animate-pulse" : ""
              }`}
              aria-hidden
            />
          ) : null}
          <span>{statusLabel}</span>
        </div>
        <span className="text-muted-foreground font-mono text-xs" dir="ltr">
          {formatDuration(durationMs)}
        </span>
      </div>

      <div
        ref={containerRef}
        dir="ltr"
        className="border-border bg-muted/30 h-16 w-full overflow-hidden rounded-xl border"
      />

      {error ? <p className="text-destructive text-xs">{error}</p> : null}

      <div className="flex items-center gap-2">
        {phase === "idle" ? (
          <Button type="button" disabled={disabled || !ready} onClick={() => void start()}>
            <MicIcon />
            {t.ingest.recordStart}
          </Button>
        ) : null}

        {isRecording ? (
          <>
            <Button type="button" variant="outline" onClick={pause}>
              <PauseIcon />
              {t.ingest.recordPause}
            </Button>
            <Button type="button" variant="destructive" onClick={stop}>
              <SquareIcon />
              {t.ingest.recordStop}
            </Button>
          </>
        ) : null}

        {isPaused ? (
          <>
            <Button type="button" variant="outline" onClick={resume}>
              <PlayIcon />
              {t.ingest.recordResume}
            </Button>
            <Button type="button" variant="destructive" onClick={stop}>
              <SquareIcon />
              {t.ingest.recordStop}
            </Button>
          </>
        ) : null}

        {isReviewing ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={togglePlay}
              aria-label={isPlaying ? t.ingest.pause : t.ingest.play}
            >
              {isPlaying ? <PauseIcon /> : <PlayIcon />}
            </Button>
            <Button type="button" variant="ghost" disabled={disabled} onClick={discard}>
              <RotateCcwIcon />
              {t.ingest.recordAgain}
            </Button>
            <Button type="button" disabled={disabled} onClick={useRecording}>
              <CheckIcon />
              {t.ingest.recordUse}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
