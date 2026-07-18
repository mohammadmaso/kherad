"use client";

import { getToolName, isReasoningUIPart, isToolUIPart, type UIMessage } from "ai";

import { Reasoning } from "@/components/ai-elements/reasoning";
import { Response } from "@/components/ai-elements/response";
import { isAskQuestionToolPart, ToolCall } from "@/components/ai-elements/tool-call";

/**
 * Renders assistant/user message parts: text, reasoning, and tool calls.
 * Special interactive tools (e.g. ask_question) are skipped here — the parent
 * mounts their structured UI separately.
 */
export function MessageParts({
  parts,
  messageId,
  reasoningLabel,
  skipToolNames = ["ask_question"],
}: {
  parts: UIMessage["parts"];
  messageId: string;
  reasoningLabel: string;
  /** Tool names rendered elsewhere as structured UI. */
  skipToolNames?: string[];
}) {
  const skip = new Set(skipToolNames);

  return (
    <div className="flex flex-col gap-2.5">
      {parts.map((part, i) => {
        const key = `${messageId}-${i}`;

        if (part.type === "text") {
          if (!part.text.trim()) return null;
          return (
            <Response key={key} className="text-[0.9375rem] leading-relaxed tracking-[-0.01em]">
              {part.text}
            </Response>
          );
        }

        if (isReasoningUIPart(part)) {
          return (
            <Reasoning
              key={key}
              text={part.text}
              state={part.state}
              label={reasoningLabel}
            />
          );
        }

        if (isToolUIPart(part)) {
          const name = getToolName(part);
          if (skip.has(name) || isAskQuestionToolPart(part)) return null;
          return <ToolCall key={key} part={part} />;
        }

        return null;
      })}
    </div>
  );
}

export function hasVisibleAssistantContent(parts: UIMessage["parts"]): boolean {
  for (const part of parts) {
    if (part.type === "text" && part.text.trim()) return true;
    if (isReasoningUIPart(part) && part.text.trim()) return true;
    if (isToolUIPart(part)) return true;
  }
  return false;
}
