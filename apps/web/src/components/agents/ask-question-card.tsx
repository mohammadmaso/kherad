"use client";

import { Button } from "@kherad/ui/components/ui/button";
import { Input } from "@kherad/ui/components/ui/input";
import { useEffect, useState } from "react";

import { Response } from "@/components/ai-elements/response";
import { useI18n } from "@/lib/i18n/provider";

export type AskQuestionPayload = {
  /** Stable unique key for React / answer state (toolCallId when available). */
  key: string;
  id: string;
  prompt: string;
  options: string[];
  allowCustom: boolean;
};

type AnswerDraft = {
  selected: string | null;
  custom: string;
  useCustom: boolean;
};

const emptyDraft = (): AnswerDraft => ({
  selected: null,
  custom: "",
  useCustom: false,
});

function draftValue(draft: AnswerDraft | undefined): string {
  if (!draft) return "";
  return (draft.useCustom ? draft.custom : draft.selected)?.trim() ?? "";
}

/**
 * Structured interview question: pick a chip or write a custom answer.
 * Prompt is rendered as markdown. Selection only — parent owns submit.
 */
export function AskQuestionCard({
  question,
  disabled,
  draft,
  onChange,
}: {
  question: AskQuestionPayload;
  disabled?: boolean;
  draft: AnswerDraft;
  onChange: (next: AnswerDraft) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="border-border bg-muted/30 my-2 rounded-xl border p-3">
      <div className="text-sm font-medium leading-snug">
        <Response>{question.prompt}</Response>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {question.options.map((option) => {
          const active = !draft.useCustom && draft.selected === option;
          return (
            <button
              key={option}
              type="button"
              disabled={disabled}
              onClick={() => {
                onChange({ selected: option, custom: draft.custom, useCustom: false });
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
              onChange({ selected: null, custom: draft.custom, useCustom: true });
            }}
            className={`rounded-full px-3 py-1.5 text-sm transition-colors duration-150 active:scale-[0.97] ${
              draft.useCustom
                ? "bg-primary text-primary-foreground"
                : "bg-background border-border hover:bg-muted border"
            }`}
          >
            {t.agents.questionOther}
          </button>
        ) : null}
      </div>
      {question.allowCustom && draft.useCustom ? (
        <Input
          className="mt-3"
          value={draft.custom}
          onChange={(e) =>
            onChange({ selected: null, custom: e.target.value, useCustom: true })
          }
          placeholder={t.agents.questionCustom}
          disabled={disabled}
        />
      ) : null}
    </div>
  );
}

/** Format one or many structured answers into a single user message. */
export function formatAskQuestionAnswers(
  questions: AskQuestionPayload[],
  drafts: Record<string, AnswerDraft>,
): string {
  const answered = questions
    .map((q) => {
      const answer = draftValue(drafts[q.key]);
      if (!answer) return null;
      return { q, answer };
    })
    .filter((row): row is { q: AskQuestionPayload; answer: string } => row !== null);

  if (answered.length === 0) return "";
  if (answered.length === 1) return answered[0]!.answer;

  return answered
    .map(({ q, answer }) => `**${q.id}** — ${q.prompt}\n${answer}`)
    .join("\n\n");
}

/**
 * Renders all pending ask_question cards with one shared Submit.
 * Answers stay selectable until everything is answered, then one message is sent.
 */
export function AskQuestionsBatch({
  questions,
  disabled,
  onSubmit,
}: {
  questions: AskQuestionPayload[];
  disabled?: boolean;
  onSubmit: (answer: string) => void;
}) {
  const { t } = useI18n();
  const [drafts, setDrafts] = useState<Record<string, AnswerDraft>>(() =>
    Object.fromEntries(questions.map((q) => [q.key, emptyDraft()])),
  );

  const questionKeys = questions.map((q) => q.key).join("\0");

  useEffect(() => {
    const keys = questionKeys ? questionKeys.split("\0") : [];
    setDrafts((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const key of keys) {
        if (!(key in next)) {
          next[key] = emptyDraft();
          changed = true;
        }
      }
      const keySet = new Set(keys);
      for (const key of Object.keys(next)) {
        if (!keySet.has(key)) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [questionKeys]);

  const allAnswered =
    questions.length > 0 && questions.every((q) => Boolean(draftValue(drafts[q.key])));

  function submit() {
    if (!allAnswered || disabled) return;
    const text = formatAskQuestionAnswers(questions, drafts);
    if (!text) return;
    onSubmit(text);
  }

  return (
    <div className="my-2 flex flex-col gap-1">
      {questions.map((q) => (
        <AskQuestionCard
          key={q.key}
          question={q}
          disabled={disabled}
          draft={drafts[q.key] ?? emptyDraft()}
          onChange={(next) => {
            setDrafts((prev) => ({ ...prev, [q.key]: next }));
          }}
        />
      ))}
      <Button className="mt-1 self-start" size="sm" disabled={disabled || !allAnswered} onClick={submit}>
        {questions.length > 1 ? t.agents.questionsSubmitAll : t.agents.questionSubmit}
      </Button>
    </div>
  );
}

/** Pull ask_question tool payloads from AI SDK / Mastra message parts. */
export function extractAskQuestions(parts: unknown[]): AskQuestionPayload[] {
  const out: AskQuestionPayload[] = [];
  const seenKeys = new Set<string>();

  parts.forEach((part, index) => {
    if (!part || typeof part !== "object") return;
    const p = part as Record<string, unknown>;
    const type = typeof p.type === "string" ? p.type : "";
    const toolName =
      typeof p.toolName === "string"
        ? p.toolName
        : type.startsWith("tool-")
          ? type.slice("tool-".length)
          : null;
    if (toolName !== "ask_question") return;

    const input = (p.input ?? p.args ?? p.output) as Record<string, unknown> | undefined;
    const fromOutput =
      p.output && typeof p.output === "object"
        ? (p.output as Record<string, unknown>)
        : undefined;
    const source = fromOutput?.prompt ? fromOutput : input;
    if (!source || typeof source.prompt !== "string") return;
    const options = Array.isArray(source.options)
      ? source.options.filter((o): o is string => typeof o === "string")
      : [];
    if (options.length === 0) return;

    const id = typeof source.id === "string" && source.id.trim() ? source.id : `q${out.length + 1}`;
    const toolCallId = typeof p.toolCallId === "string" ? p.toolCallId : null;
    let key = toolCallId ?? `${id}:${index}`;
    if (seenKeys.has(key)) key = `${key}:${index}`;
    seenKeys.add(key);

    out.push({
      key,
      id,
      prompt: source.prompt,
      options,
      allowCustom: source.allowCustom !== false,
    });
  });

  return out;
}
