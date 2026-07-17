"use client";

import { useChat } from "@ai-sdk/react";
import { Alert, AlertDescription, AlertTitle } from "@kherad/ui/components/ui/alert";
import { Badge } from "@kherad/ui/components/ui/badge";
import { Button } from "@kherad/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@kherad/ui/components/ui/dialog";
import { Input } from "@kherad/ui/components/ui/input";
import { Label } from "@kherad/ui/components/ui/label";
import { Select } from "@kherad/ui/components/ui/select";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  ArrowLeft,
  BriefcaseIcon,
  FileTextIcon,
  PaperclipIcon,
  SparklesIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AskQuestionCard, extractAskQuestions } from "@/components/agents/ask-question-card";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Loader } from "@/components/ai-elements/loader";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  hasVisibleAssistantContent,
  MessageParts,
} from "@/components/ai-elements/message-parts";
import { PromptInput } from "@/components/ai-elements/prompt-input";
import {
  buildMentionMessageParts,
  MessageMentionChips,
  type MentionPage,
} from "@/components/chat/page-mentions";
import {
  API_URL,
  deleteAgentUpload,
  fetchAgentBundles,
  fetchAgentSession,
  fetchBundlePages,
  getToken,
  importAgentDraft,
  updateAgentSession,
  uploadAgentFile,
  type AgentBundleOption,
  type AgentSession,
  type AgentUpload,
} from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";
import { pagePathFromTitle } from "@kherad/core/page-paths";

// The specialist researches across bundles, so its picker offers pages from
// every viewable bundle — capped to keep the lazy fetch bounded.
const MAX_MENTION_BUNDLES = 20;

/** Chat + draft workspace for a specialist agent session. */
export function AgentSessionWorkspace({ sessionId }: { sessionId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [session, setSession] = useState<AgentSession | null>(null);
  const [uploads, setUploads] = useState<AgentUpload[]>([]);
  const [draft, setDraft] = useState("");
  const [bundles, setBundles] = useState<AgentBundleOption[]>([]);
  const [mentionPages, setMentionPages] = useState<MentionPage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importBundleId, setImportBundleId] = useState("");
  const [importTitle, setImportTitle] = useState("");
  const [importPath, setImportPath] = useState("");
  const [importResult, setImportResult] = useState<{
    pageId: string;
    bundleId: string;
    compileNote: string | null;
  } | null>(null);
  const [answeredToolKeys, setAnsweredToolKeys] = useState<Set<string>>(new Set());

  const labels = {
    chatTitle: t.agents.specialistChatTitle,
    chatEmpty: t.agents.specialistChatEmpty,
    chatPlaceholder: t.agents.specialistChatPlaceholder,
    thinking: t.agents.specialistThinking,
    defaultTitle: "Specialist session",
  };

  const reloadSession = useCallback(async () => {
    const data = await fetchAgentSession(sessionId);
    setSession(data.session);
    setUploads(data.uploads);
    setDraft(data.session.draftMarkdown ?? "");
    if (data.session.bundleId) setImportBundleId(data.session.bundleId);
    return data;
  }, [sessionId]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${API_URL}/agents/sessions/${sessionId}/chat`,
        headers: (): Record<string, string> => {
          const token = getToken();
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
      }),
    [sessionId],
  );

  const { messages, sendMessage, setMessages, status, stop, error: chatError } = useChat({
    transport,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!getToken()) {
        router.replace("/login");
        return;
      }
      try {
        const [data, bundleRows] = await Promise.all([reloadSession(), fetchAgentBundles()]);
        if (cancelled) return;
        setBundles(bundleRows);
        setMessages(
          data.messages.map((row) => ({
            id: row.id,
            role: row.role as UIMessage["role"],
            parts: row.parts as UIMessage["parts"],
          })),
        );
        setLoaded(true);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : t.agents.loadFailed;
        if (message.includes("Unauthorized")) {
          router.replace("/login");
          return;
        }
        setError(message.includes("Forbidden") ? t.agents.forbidden : message);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadSession, router, sessionId, setMessages, t.agents.forbidden, t.agents.loadFailed]);

  // Pages for the "@" mention picker — the specialist researches across every
  // bundle the user can view, so offer pages from all of them.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const scope = bundles.slice(0, MAX_MENTION_BUNDLES);
        if (scope.length === 0) {
          setMentionPages([]);
          return;
        }
        const perBundle = await Promise.all(
          scope.map(async (bundle) => {
            const pages = await fetchBundlePages(bundle.id).catch(() => []);
            return pages
              .filter((page) => !page.isDeleted && !page.redirectTo)
              .map((page) => ({
                bundleSlug: bundle.slug,
                path: page.path,
                title: page.title,
                bundleTitle: bundle.title,
              }));
          }),
        );
        if (!cancelled) setMentionPages(perBundle.flat());
      } catch {
        // Mentions are an enhancement; the chat works without them.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bundles]);

  // When propose_document finishes, mirror its markdown into the draft panel.
  useEffect(() => {
    if (status !== "ready") return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return;

    let markdown: string | null = null;
    let title: string | null = null;
    for (const part of last.parts) {
      if (!part || typeof part !== "object") continue;
      const p = part as Record<string, unknown>;
      const type = typeof p.type === "string" ? p.type : "";
      const toolName =
        typeof p.toolName === "string"
          ? p.toolName
          : type.startsWith("tool-")
            ? type.slice("tool-".length)
            : null;
      if (toolName !== "propose_document") continue;
      const source = (p.input ?? p.args ?? p.output) as Record<string, unknown> | undefined;
      if (source && typeof source.markdown === "string" && source.markdown.trim()) {
        markdown = source.markdown.trim();
        if (typeof source.title === "string") title = source.title.trim();
      }
    }
    if (!markdown) return;

    const nextMarkdown = markdown;
    const nextTitle = title;
    queueMicrotask(() => {
      setDraft(nextMarkdown);
      setDraftSaved(false);
      setSession((prev) =>
        prev
          ? {
              ...prev,
              draftMarkdown: nextMarkdown,
              status: "draft_ready",
              ...(nextTitle ? { title: nextTitle.slice(0, 120) } : {}),
            }
          : prev,
      );
    });
  }, [messages, status]);

  const busy = status === "submitted" || status === "streaming";

  async function handleUpload(file: File) {
    try {
      const upload = await uploadAgentFile(sessionId, file);
      setUploads((prev) => [...prev, upload]);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.agents.uploadFailed);
    }
  }

  async function handleDeleteUpload(uploadId: string) {
    await deleteAgentUpload(sessionId, uploadId);
    setUploads((prev) => prev.filter((u) => u.id !== uploadId));
  }

  async function handleSaveDraft() {
    setDraftSaving(true);
    setDraftSaved(false);
    setError(null);
    try {
      const updated = await updateAgentSession(sessionId, { draftMarkdown: draft });
      setSession(updated);
      setDraftSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.agents.loadFailed);
    } finally {
      setDraftSaving(false);
    }
  }

  async function handleImport() {
    setImporting(true);
    setError(null);
    try {
      // Persist latest edits before import.
      await updateAgentSession(sessionId, { draftMarkdown: draft });
      const result = await importAgentDraft(sessionId, {
        bundleId: importBundleId,
        title: importTitle.trim(),
        path: importPath.trim() || undefined,
      });
      let compileNote: string | null = null;
      if (result.compile.status === "started") {
        compileNote = t.agents.compileStarted;
      } else if (result.compile.status === "skipped") {
        compileNote = t.agents.compileSkipped(result.compile.reason);
      } else {
        compileNote = t.agents.compileFailed(result.compile.reason);
      }
      setImportResult({
        pageId: result.page.id,
        bundleId: result.page.bundleId,
        compileNote,
      });
      setImportOpen(false);
      await reloadSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.agents.loadFailed);
    } finally {
      setImporting(false);
    }
  }

  function openImport() {
    const titleGuess = session?.title && session.title !== labels.defaultTitle ? session.title : "";
    setImportTitle(titleGuess);
    setImportPath(titleGuess ? pagePathFromTitle(titleGuess) : "");
    const editable = bundles.filter((b) => b.canEdit);
    if (!importBundleId && editable[0]) setImportBundleId(editable[0].id);
    setImportOpen(true);
  }

  if (!loaded) {
    return (
      <div className="mx-auto w-full max-w-6xl p-6">
        <p className="text-muted-foreground text-sm">{t.common.loading}</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="mx-auto w-full max-w-6xl p-6">
        <Alert variant="destructive">
          <AlertTitle>{t.common.error}</AlertTitle>
          <AlertDescription>{error ?? t.agents.loadFailed}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const editableBundles = bundles.filter((b) => b.canEdit);

  return (
    <div className="mx-auto flex h-[calc(100dvh-3.5rem)] w-full max-w-6xl flex-col gap-3 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <Link
            href="/agents"
            className="text-muted-foreground hover:text-foreground mb-1 inline-flex items-center gap-1.5 text-sm transition-colors"
          >
            <ArrowLeft className="size-3.5" />
            {t.agents.title}
          </Link>
          <h1 className="truncate text-lg font-semibold tracking-tight">{session.title}</h1>
          {session.role ? (
            <p className="text-muted-foreground flex items-center gap-1 text-xs">
              <BriefcaseIcon className="size-3" />
              {session.role}
            </p>
          ) : null}
          {session.bundle ? (
            <p className="text-muted-foreground text-xs">
              {t.agents.attachBundle}: {session.bundle.title}
            </p>
          ) : null}
          <p className="text-muted-foreground text-xs">
            {t.agents.aggressivenessOptions[session.aggressiveness]}
            {session.skills.length > 0
              ? ` · ${session.skills.map((s) => s.name).join(", ")}`
              : ""}
          </p>
        </div>
        <Badge variant="secondary">
          {session.status === "draft_ready"
            ? t.agents.statusDraftReady
            : session.status === "imported"
              ? t.agents.statusImported
              : t.agents.statusActive}
        </Badge>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t.common.error}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {importResult ? (
        <Alert>
          <AlertTitle>{t.agents.importSuccess}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            {importResult.compileNote ? <span>{importResult.compileNote}</span> : null}
            <Button
              size="sm"
              className="w-fit"
              nativeButton={false}
              render={
                <Link
                  href={`/bundles/${importResult.bundleId}/pages/${importResult.pageId}/edit`}
                />
              }
            >
              {t.agents.importOpenEdit}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
        {/* Chat column */}
        <div className="border-border flex min-h-0 flex-col overflow-hidden rounded-2xl border">
          <div className="border-border flex items-center gap-2 border-b px-3 py-2.5">
            <BriefcaseIcon className="text-primary size-4" />
            <span className="text-sm font-semibold">{labels.chatTitle}</span>
          </div>

          <div className="border-border flex flex-wrap items-center gap-2 border-b px-3 py-2">
            <span className="text-muted-foreground text-xs font-medium">{t.agents.uploads}</span>
            {uploads.map((upload) => (
              <span
                key={upload.id}
                className="bg-muted inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
              >
                <PaperclipIcon className="size-3" />
                <span className="max-w-28 truncate">{upload.filename}</span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={t.common.remove}
                  onClick={() => void handleDeleteUpload(upload.id)}
                >
                  <Trash2Icon className="size-3" />
                </button>
              </span>
            ))}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
            >
              <UploadIcon className="size-3.5" />
              {t.agents.uploadAdd}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.txt,.csv,.json,.markdown,.tsv,text/*,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void handleUpload(file);
              }}
            />
          </div>

          <Conversation>
            <ConversationContent>
              {messages.length === 0 ? (
                <div className="text-muted-foreground m-auto flex max-w-72 flex-col items-center gap-2 py-10 text-center text-sm">
                  <SparklesIcon className="text-primary/60 size-6" />
                  {labels.chatEmpty}
                </div>
              ) : null}
              {messages.map((message, messageIndex) => {
                const questions = extractAskQuestions(message.parts as unknown[]);
                const isLastAssistant =
                  message.role === "assistant" && messageIndex === messages.length - 1;
                return (
                  <Message
                    key={message.id}
                    from={message.role === "user" ? "user" : "assistant"}
                  >
                    <MessageContent from={message.role === "user" ? "user" : "assistant"}>
                      {message.role === "user" ? (
                        <MessageMentionChips parts={message.parts} />
                      ) : null}
                      {message.role === "assistant" ? (
                        <MessageParts
                          parts={message.parts}
                          messageId={message.id}
                          reasoningLabel={t.agents.reasoningLabel}
                        />
                      ) : (
                        message.parts.map((part, i) =>
                          part.type === "text" ? (
                            <span key={`${message.id}-${i}`} className="whitespace-pre-wrap">
                              {part.text}
                            </span>
                          ) : null,
                        )
                      )}
                      {isLastAssistant
                        ? questions.map((q) => {
                            const key = `${message.id}:${q.id}`;
                            if (answeredToolKeys.has(key)) return null;
                            return (
                              <AskQuestionCard
                                key={key}
                                question={q}
                                disabled={busy}
                                onSubmit={(answer) => {
                                  setAnsweredToolKeys((prev) => new Set(prev).add(key));
                                  void sendMessage({ text: answer });
                                }}
                              />
                            );
                          })
                        : null}
                    </MessageContent>
                  </Message>
                );
              })}
              {(() => {
                const last = messages[messages.length - 1];
                const lastAssistant = last?.role === "assistant" ? last : null;
                const showThinking =
                  status === "submitted" ||
                  (status === "streaming" &&
                    (!lastAssistant || !hasVisibleAssistantContent(lastAssistant.parts)));
                return showThinking ? <Loader label={labels.thinking} /> : null;
              })()}
              {chatError ? <p className="text-destructive text-xs">{t.chat.error}</p> : null}
            </ConversationContent>
            <ConversationScrollButton label={t.chat.scrollToBottom} />
          </Conversation>

          <div className="border-border border-t p-3">
            <p className="text-muted-foreground mb-1.5 text-[0.6875rem]">{t.agents.uploadHint}</p>
            <PromptInput
              placeholder={labels.chatPlaceholder}
              submitLabel={t.chat.send}
              stopLabel={t.chat.stop}
              status={status}
              mentionPages={mentionPages}
              mentionLabels={{
                add: t.chat.mentionAdd,
                searchPlaceholder: t.chat.mentionSearch,
                empty: t.chat.mentionEmpty,
              }}
              onSubmit={(text, mentions) =>
                void sendMessage({
                  role: "user",
                  parts: buildMentionMessageParts(text, mentions),
                })
              }
              onStop={() => void stop()}
            />
          </div>
        </div>

        {/* Draft column */}
        <div className="border-border flex min-h-0 flex-col overflow-hidden rounded-2xl border">
          <div className="border-border flex items-center justify-between gap-2 border-b px-3 py-2.5">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <FileTextIcon className="size-4" />
              {t.agents.draftTitle}
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                disabled={draftSaving || !draft.trim()}
                onClick={() => void handleSaveDraft()}
              >
                {draftSaving ? t.common.saving : t.agents.draftSave}
              </Button>
              <Button size="sm" disabled={!draft.trim()} onClick={openImport}>
                {t.agents.importButton}
              </Button>
            </div>
          </div>
          {draftSaved ? (
            <p className="text-muted-foreground border-border border-b px-3 py-1.5 text-xs">
              {t.agents.draftSaved}
            </p>
          ) : null}
          <textarea
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setDraftSaved(false);
            }}
            placeholder={t.agents.draftEmpty}
            className="placeholder:text-muted-foreground min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-sm leading-relaxed outline-none"
          />
        </div>
      </div>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.agents.importTitle}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {editableBundles.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t.agents.noEditBundles}</p>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="import-bundle">{t.agents.importBundle}</Label>
                  <Select
                    id="import-bundle"
                    value={importBundleId}
                    onChange={(e) => setImportBundleId(e.target.value)}
                  >
                    {editableBundles.map((bundle) => (
                      <option key={bundle.id} value={bundle.id}>
                        {bundle.title}
                        {bundle.mode === "llm_compiled" ? " · AI" : ""}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="import-title">{t.agents.importPageTitle}</Label>
                  <Input
                    id="import-title"
                    value={importTitle}
                    onChange={(e) => {
                      setImportTitle(e.target.value);
                      if (!importPath.trim()) {
                        setImportPath(pagePathFromTitle(e.target.value));
                      }
                    }}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="import-path">{t.agents.importPath}</Label>
                  <Input
                    id="import-path"
                    value={importPath}
                    onChange={(e) => setImportPath(e.target.value)}
                    dir="ltr"
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              disabled={
                importing || !importBundleId || !importTitle.trim() || editableBundles.length === 0
              }
              onClick={() => void handleImport()}
            >
              {importing ? t.common.loading : t.agents.importSubmit}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
