"use client";

import { Button } from "@kherad/ui/components/ui/button";
import { Input } from "@kherad/ui/components/ui/input";
import { useState } from "react";

import { Response } from "@/components/ai-elements/response";
import { useI18n } from "@/lib/i18n/provider";

export type AskQuestionPayload = {
  id: string;
  prompt: string;
  options: string[];
  allowCustom: boolean;
};

/**
 * Structured interview question: pick a chip or write a custom answer.
 * Prompt is rendered as markdown.
 */
export function AskQuestionCard({
  question,
  disabled,
  onSubmit,
}: {
  question: AskQuestionPayload;
  disabled?: boolean;
  onSubmit: (answer: string) => void;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [useCustom, setUseCustom] = useState(false);

  function submit() {
    const answer = useCustom ? custom.trim() : selected?.trim();
    if (!answer || disabled) return;
    onSubmit(answer);
  }

  return (
    <div className="border-border bg-muted/30 my-2 rounded-xl border p-3">
      <div className="text-sm font-medium leading-snug">
        <Response>{question.prompt}</Response>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {question.options.map((option) => {
          const active = !useCustom && selected === option;
          return (
            <button
              key={option}
              type="button"
              disabled={disabled}
              onClick={() => {
                setUseCustom(false);
                setSelected(option);
              }}
              className={`rounded-full px-3 py-1.5 text-sm transition-colors duration-150 active:scale-[0.97] ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-background border-border hover:bg-muted border"
              }`}
            >
              <span dir="auto">{option}</span>
            </button>
          );
        })}
        {question.allowCustom ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setUseCustom(true);
              setSelected(null);
            }}
            className={`rounded-full px-3 py-1.5 text-sm transition-colors duration-150 active:scale-[0.97] ${
              useCustom
                ? "bg-primary text-primary-foreground"
                : "bg-background border-border hover:bg-muted border"
            }`}
          >
            {t.agents.questionOther}
          </button>
        ) : null}
      </div>
      {question.allowCustom && useCustom ? (
        <Input
          className="mt-3"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder={t.agents.questionCustom}
          disabled={disabled}
        />
      ) : null}
      <Button
        className="mt-3"
        size="sm"
        disabled={disabled || (useCustom ? !custom.trim() : !selected)}
        onClick={submit}
      >
        {t.agents.questionSubmit}
      </Button>
    </div>
  );
}

/** Pull ask_question tool payloads from AI SDK / Mastra message parts. */
export function extractAskQuestions(parts: unknown[]): AskQuestionPayload[] {
  const out: AskQuestionPayload[] = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const p = part as Record<string, unknown>;
    const type = typeof p.type === "string" ? p.type : "";
    const toolName =
      typeof p.toolName === "string"
        ? p.toolName
        : type.startsWith("tool-")
          ? type.slice("tool-".length)
          : null;
    if (toolName !== "ask_question") continue;

    const input = (p.input ?? p.args ?? p.output) as Record<string, unknown> | undefined;
    const fromOutput =
      p.output && typeof p.output === "object"
        ? (p.output as Record<string, unknown>)
        : undefined;
    const source = fromOutput?.prompt ? fromOutput : input;
    if (!source || typeof source.prompt !== "string") continue;
    const options = Array.isArray(source.options)
      ? source.options.filter((o): o is string => typeof o === "string")
      : [];
    if (options.length === 0) continue;
    out.push({
      id: typeof source.id === "string" ? source.id : "q",
      prompt: source.prompt,
      options,
      allowCustom: source.allowCustom !== false,
    });
  }
  return out;
}
