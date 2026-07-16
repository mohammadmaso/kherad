"use client";

import { useChat } from "@ai-sdk/react";
import { Button } from "@kherad/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@kherad/ui/components/ui/dropdown-menu";
import { DefaultChatTransport, type UIMessage } from "ai";
import { HistoryIcon, SparklesIcon, SquarePenIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";

import {
  API_URL,
  fetchChatThread,
  fetchChatThreads,
  getToken,
  type ChatThreadSummary,
} from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Loader } from "@/components/ai-elements/loader";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { PromptInput } from "@/components/ai-elements/prompt-input";
import { Response } from "@/components/ai-elements/response";

type ChatBundle = { id: string; slug: string; title: string };

/**
 * Per-bundle Q&A panel grounded in the bundle's approved OKF knowledge base.
 * Authenticated users get persisted threads (the server assigns a thread id
 * via the x-chat-thread-id response header on the first message); anonymous
 * readers on public bundles chat ephemerally.
 */
export function BundleChat({
  bundle,
  isAuthed,
  onClose,
}: {
  bundle: ChatBundle;
  isAuthed: boolean;
  onClose?: () => void;
}) {
  const { t } = useI18n();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<ChatThreadSummary[] | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${API_URL}/bundles/${bundle.id}/chat`,
        headers: (): Record<string, string> => {
          const token = getToken();
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
        // Snapshot the active thread into each request; recreating the transport
        // when `threadId` changes is intentional so subsequent turns stay attached.
        body: { threadId },
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
          const res = await fetch(input, init);
          const assigned = res.headers.get("x-chat-thread-id");
          if (assigned) {
            setThreadId((prev) => prev ?? assigned);
          }
          return res;
        }) as typeof fetch,
      }),
    [bundle.id, threadId],
  );

  const { messages, sendMessage, setMessages, status, stop, error, clearError } = useChat({
    transport,
  });

  async function openHistory() {
    if (!isAuthed) return;
    try {
      setThreads(await fetchChatThreads(bundle.id));
    } catch {
      setThreads([]);
    }
  }

  async function openThread(id: string) {
    setLoadingThread(true);
    try {
      const { messages: rows } = await fetchChatThread(bundle.id, id);
      setThreadId(id);
      clearError();
      setMessages(rows as unknown as UIMessage[]);
    } finally {
      setLoadingThread(false);
    }
  }

  function newChat() {
    setThreadId(null);
    clearError();
    setMessages([]);
  }

  const busy = status === "submitted" || status === "streaming";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border flex items-center justify-between gap-2 border-b px-3 py-2.5">
        <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <SparklesIcon className="text-primary size-4 shrink-0" />
          <span className="truncate">{t.chat.title}</span>
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {isAuthed ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t.chat.history}
                    onClick={openHistory}
                  >
                    <HistoryIcon className="size-4" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={newChat}>
                  <SquarePenIcon className="size-3.5" />
                  {t.chat.newChat}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {threads === null ? (
                  <DropdownMenuItem disabled>{t.common.loading}</DropdownMenuItem>
                ) : threads.length === 0 ? (
                  <DropdownMenuItem disabled>{t.chat.noHistory}</DropdownMenuItem>
                ) : (
                  threads.map((thread) => (
                    <DropdownMenuItem key={thread.id} onClick={() => openThread(thread.id)}>
                      <span className="max-w-56 truncate">{thread.title}</span>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button variant="ghost" size="icon-sm" aria-label={t.chat.newChat} onClick={newChat}>
              <SquarePenIcon className="size-4" />
            </Button>
          )}
          {onClose ? (
            <Button variant="ghost" size="icon-sm" aria-label={t.chat.close} onClick={onClose}>
              <XIcon className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>

      <Conversation>
        <ConversationContent>
          {messages.length === 0 && !loadingThread ? (
            <div className="text-muted-foreground m-auto flex max-w-60 flex-col items-center gap-2 py-10 text-center text-sm">
              <SparklesIcon className="text-primary/60 size-6" />
              {t.chat.empty(bundle.title)}
            </div>
          ) : null}
          {messages.map((message) => (
            <Message key={message.id} from={message.role === "user" ? "user" : "assistant"}>
              <MessageContent from={message.role === "user" ? "user" : "assistant"}>
                {message.parts.map((part, i) =>
                  part.type === "text" ? (
                    <Response key={`${message.id}-${i}`}>{part.text}</Response>
                  ) : null,
                )}
              </MessageContent>
            </Message>
          ))}
          {status === "submitted" || loadingThread ? <Loader label={t.chat.thinking} /> : null}
          {error ? <p className="text-destructive text-xs">{t.chat.error}</p> : null}
        </ConversationContent>
        <ConversationScrollButton label={t.chat.scrollToBottom} />
      </Conversation>

      <div className="border-border border-t p-3">
        <PromptInput
          placeholder={t.chat.placeholder}
          submitLabel={t.chat.send}
          stopLabel={t.chat.stop}
          status={status}
          disabled={loadingThread}
          onSubmit={(text) => void sendMessage({ text })}
          onStop={() => void stop()}
        />
        {busy ? null : (
          <p className="text-muted-foreground mt-1.5 px-1 text-[0.6875rem]">{t.chat.disclaimer}</p>
        )}
      </div>
    </div>
  );
}
