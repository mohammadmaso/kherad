"use client";

import { Button } from "@kherad/ui/components/ui/button";
import { PauseIcon, PlayIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type WaveSurfer from "wavesurfer.js";

import { useI18n } from "@/lib/i18n/provider";
import { formatDuration, readCssColor } from "./ingest-format";

export function AudioWaveformPlayer({ src }: { src: string }) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { default: WaveSurfer } = await import("wavesurfer.js");
      if (cancelled || !containerRef.current) return;

      const el = containerRef.current;
      const waveColor = readCssColor(el, "--color-muted-foreground", "#a1a1aa");
      const progressColor = readCssColor(el, "--color-primary", "#6366f1");

      const ws = WaveSurfer.create({
        container: el,
        height: 56,
        waveColor,
        progressColor,
        cursorWidth: 1,
        barWidth: 2,
        barGap: 2,
        barRadius: 2,
        normalize: true,
        url: src,
      });

      ws.on("play", () => !cancelled && setIsPlaying(true));
      ws.on("pause", () => !cancelled && setIsPlaying(false));
      ws.on("finish", () => !cancelled && setIsPlaying(false));
      ws.on("timeupdate", (seconds) => !cancelled && setCurrentMs(seconds * 1000));
      ws.on("ready", (seconds) => !cancelled && setDurationMs(seconds * 1000));

      wavesurferRef.current = ws;
    })();

    return () => {
      cancelled = true;
      wavesurferRef.current?.destroy();
      wavesurferRef.current = null;
    };
  }, [src]);

  return (
    <div className="flex w-full max-w-md flex-col gap-2">
      <div
        ref={containerRef}
        dir="ltr"
        className="border-border bg-muted/30 h-14 w-full overflow-hidden rounded-xl border"
      />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => wavesurferRef.current?.playPause()}
          aria-label={isPlaying ? t.ingest.pause : t.ingest.play}
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </Button>
        <span className="text-muted-foreground font-mono text-xs" dir="ltr">
          {formatDuration(currentMs)} / {formatDuration(durationMs)}
        </span>
      </div>
    </div>
  );
}
