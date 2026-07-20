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
  PaperclipIcon,
  SparklesIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useEffectEvent } from "react";

import { AskQuestionsBatch, extractAskQuestions } from "@/components/agents/ask-question-card";
import { PageEditViewerPanel } from "@/components/agents/page-edit-viewer-panel";
import {
  extractSectionEditProposals,
  SectionEditProposalCard,
} from "@/components/agents/section-edit-proposal-card";
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
import { PromptInput, type PromptInputHandle } from "@/components/ai-elements/prompt-input";
import {
  buildMentionMessageParts,
  MessageMentionChips,
  type MentionPage,
} from "@/components/chat/page-mentions";
import { MessageQuoteChips } from "@/components/chat/message-quote-chips";
import {
  MAX_QUOTES_PER_MESSAGE,
  withTextQuoteParts,
  type TextQuote,
} from "@/components/chat/text-quotes";
import {
  API_URL,
  deleteAgentUpload,
  fetchAgentBundles,
  fetchAgentSession,
  fetchBundlePages,
  getToken,
  importAgentDraft,
  startMcpOauth,
  submitForReview,
  updateAgentSession,
  uploadAgentFile,
  type AgentBundleOption,
  type AgentPageSection,
  type AgentSession,
  type AgentUpload,
  type PageSummary,
} from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";
import { resolveCreatePagePath } from "@kherad/core/page-paths";
import { existingFolderPaths } from "@/lib/page-tree";
import { PagePathFields } from "@/components/wiki/page-path-fields";

// The specialist researches across bundles, so its picker offers pages from
// every viewable bundle — capped to keep the lazy fetch bounded.
const MAX_MENTION_BUNDLES = 20;

/** Chat + draft workspace for a specialist agent session. */
export function AgentSessionWorkspace({ sessionId }: { sessionId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<PromptInputHandle>(null);

  const [session, setSession] = useState<AgentSession | null>(null);
  const [uploads, setUploads] = useState<AgentUpload[]>([]);
  const [sections, setSections] = useState<AgentPageSection[]>([]);
  const [effectiveMarkdown, setEffectiveMarkdown] = useState("");
  const [draft, setDraft] = useState("");
  const [draftEditorKey, setDraftEditorKey] = useState(0);
  const [bundles, setBundles] = useState<AgentBundleOption[]>([]);
  const [mentionPages, setMentionPages] = useState<MentionPage[]>([]);
  const [quotes, setQuotes] = useState<TextQuote[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importBundleId, setImportBundleId] = useState("");
  const [importTitle, setImportTitle] = useState("");
  const [importFolder, setImportFolder] = useState("");
  const [importPath, setImportPath] = useState("");
  const [importIfExists, setImportIfExists] = useState<"update" | "create">("update");
  const [importBundlePages, setImportBundlePages] = useState<PageSummary[]>([]);
  const [importResult, setImportResult] = useState<{
    pageId: string;
    bundleId: string;
    compileNote: string | null;
    successNote: string;
  } | null>(null);
  const [answeredToolKeys, setAnsweredToolKeys] = useState<Set<string>>(new Set());
  const [decidedEditKeys, setDecidedEditKeys] = useState<Set<string>>(new Set());
  const [connectingMcpId, setConnectingMcpId] = useState<string | null>(null);
  const refreshedProposalTokenRef = useRef<string | null>(null);

  const isEditMode = session?.mode === "edit";
  const mcpNeedsAuth = (session?.mcpServers ?? []).filter(
    (s) => s.authType === "oauth2_auth_code" && s.status === "needs_auth",
  );
  const oauthConnected = searchParams.get("connected");
  const oauthErrorParam = searchParams.get("oauthError");
  const mcpBanner = oauthConnected ? t.agents.mcpConnectedBanner : null;
  const oauthCallbackError = oauthErrorParam ? t.agents.mcpOauthErrorBanner : null;

  const labels = {
    chatTitle: isEditMode ? t.agents.editChatTitle : t.agents.specialistChatTitle,
    chatEmpty: isEditMode ? t.agents.editChatEmpty : t.agents.specialistChatEmpty,
    chatPlaceholder: isEditMode
      ? t.agents.editChatPlaceholder
      : t.agents.specialistChatPlaceholder,
    thinking: t.agents.specialistThinking,
    defaultTitle: "Specialist session",
  };

  const reloadSession = useCallback(async () => {
    const data = await fetchAgentSession(sessionId);
    setSession(data.session);
    setUploads(data.uploads);
    setSections(data.session.sections ?? []);
    setEffectiveMarkdown(data.session.effectiveMarkdown ?? "");
    setDraft(data.session.draftMarkdown ?? "");
    if (data.session.bundleId) setImportBundleId(data.session.bundleId);
    return data;
  }, [sessionId]);

  useEffect(() => {
    if (!oauthConnected && !oauthErrorParam) return;
    const reloadTimer = window.setTimeout(() => {
      void reloadSession().catch(() => undefined);
    }, 0);
    const clearTimer = window.setTimeout(() => {
      router.replace(`/agents/${sessionId}`);
    }, 2500);
    return () => {
      window.clearTimeout(reloadTimer);
      window.clearTimeout(clearTimer);
    };
  }, [oauthConnected, oauthErrorParam, sessionId, router, reloadSession]);

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
    if (status !== "ready" || isEditMode) return;
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
      setDraftEditorKey((k) => k + 1);
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
  }, [messages, status, isEditMode]);

  const refreshViewerForProposals = useEffectEvent((token: string) => {
    if (refreshedProposalTokenRef.current === token) return;
    refreshedProposalTokenRef.current = token;
    void reloadSession();
  });

  // After propose_section_edit finishes, refresh the viewer once per proposal set.
  useEffect(() => {
    if (status !== "ready" || !isEditMode) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return;
    const proposals = extractSectionEditProposals(last.parts as unknown[]);
    if (proposals.length === 0) return;
    const token = `${last.id}:${proposals.map((p) => p.editId).sort().join(",")}`;
    refreshViewerForProposals(token);
  }, [messages, status, isEditMode]);

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

  async function handleImport() {
    setImporting(true);
    setError(null);
    try {
      // Persist latest editor markdown, then write the page and open an MR.
      await updateAgentSession(sessionId, { draftMarkdown: draft });
      const resolvedPath = resolveCreatePagePath({
        folder: importFolder,
        path: importPath,
        title: importTitle.trim(),
      });
      if (!resolvedPath) {
        setError(t.agents.loadFailed);
        return;
      }
      const result = await importAgentDraft(sessionId, {
        bundleId: importBundleId,
        title: importTitle.trim(),
        path: resolvedPath,
        ifExists: pathConflict ? importIfExists : undefined,
      });
      const mr = await submitForReview(result.page.bundleId);
      let compileNote: string | null = null;
      if (result.compile.status === "started") {
        compileNote = t.agents.compileStarted;
      } else if (result.compile.status === "skipped") {
        compileNote = t.agents.compileSkipped(result.compile.reason);
      } else {
        compileNote = t.agents.compileFailed(result.compile.reason);
      }
      const pageNote = result.created
        ? result.remapped
          ? t.agents.importSuccessRemapped(result.requestedPath, result.path)
          : t.agents.importSuccessCreated(result.path)
        : t.agents.importSuccessUpdated(result.path);
      setImportResult({
        pageId: result.page.id,
        bundleId: result.page.bundleId,
        compileNote,
        successNote: t.agents.importSuccessWithReview(pageNote, mr.branchName),
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
    setImportFolder("");
    setImportPath("");
    setImportIfExists("update");
    const editable = bundles.filter((b) => b.canEdit);
    if (!importBundleId && editable[0]) setImportBundleId(editable[0].id);
    setImportOpen(true);
  }

  // Load live pages for the selected import bundle so we can detect path conflicts.
  useEffect(() => {
    if (!importOpen || !importBundleId) {
      setImportBundlePages([]);
      return;
    }
    let cancelled = false;
    void fetchBundlePages(importBundleId)
      .then((pages) => {
        if (!cancelled) {
          setImportBundlePages(pages.filter((p) => !p.isDeleted && !p.redirectTo));
        }
      })
      .catch(() => {
        if (!cancelled) setImportBundlePages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [importOpen, importBundleId]);

  const importExistingFolders = useMemo(
    () => existingFolderPaths(importBundlePages),
    [importBundlePages],
  );

  const resolvedImportPath = useMemo(() => {
    if (!importTitle.trim()) return "";
    return (
      resolveCreatePagePath({
        folder: importFolder,
        path: importPath,
        title: importTitle.trim(),
      }) ?? ""
    );
  }, [importFolder, importPath, importTitle]);

  const conflictingPage = useMemo(() => {
    if (!resolvedImportPath) return null;
    return importBundlePages.find((p) => p.path === resolvedImportPath) ?? null;
  }, [importBundlePages, resolvedImportPath]);

  const pathConflict = Boolean(conflictingPage);

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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/agents"
            className="text-muted-foreground hover:text-foreground mb-1.5 inline-flex items-center gap-1.5 text-sm transition-colors duration-150 active:scale-[0.98]"
          >
            <ArrowLeft className="size-3.5" />
            {t.agents.title}
          </Link>
          <h1 className="truncate text-xl font-semibold tracking-tight">{session.title}</h1>
          <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {session.role ? (
              <span className="bg-muted/60 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium">
                <BriefcaseIcon className="size-3" />
                {session.role}
              </span>
            ) : null}
            {session.bundle ? (
              <span>
                {t.agents.attachBundle}: {session.bundle.title}
              </span>
            ) : null}
            <span>{t.agents.aggressivenessOptions[session.aggressiveness]}</span>
            {session.skills.length > 0 ? (
              <span className="truncate">{session.skills.map((s) => s.name).join(" · ")}</span>
            ) : null}
            {session.mcpServers?.length > 0 ? (
              <span className="truncate">
                {session.mcpServers.map((s) => s.name).join(" · ")}
              </span>
            ) : null}
          </div>
        </div>
        <Badge
          variant={
            session.status === "draft_ready"
              ? "success"
              : session.status === "imported"
                ? "outline"
                : "secondary"
          }
        >
          {session.status === "draft_ready"
            ? t.agents.statusDraftReady
            : session.status === "imported"
              ? t.agents.statusImported
              : t.agents.statusActive}
        </Badge>
      </div>

      {mcpBanner ? (
        <Alert>
          <AlertTitle>{t.common.saved}</AlertTitle>
          <AlertDescription>{mcpBanner}</AlertDescription>
        </Alert>
      ) : null}

      {error || oauthCallbackError ? (
        <Alert variant="destructive">
          <AlertTitle>{t.common.error}</AlertTitle>
          <AlertDescription>{error ?? oauthCallbackError}</AlertDescription>
        </Alert>
      ) : null}

      {mcpNeedsAuth.length > 0 ? (
        <Alert>
          <AlertTitle>{t.agents.mcpNeedsAuthWorkspace}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>{t.agents.mcpNeedsAuthHint}</span>
            <div className="flex flex-wrap gap-2">
              {mcpNeedsAuth.map((server) => (
                <Button
                  key={server.id}
                  size="sm"
                  variant="outline"
                  disabled={connectingMcpId === server.id}
                  onClick={() => {
                    setConnectingMcpId(server.id);
                    void (async () => {
                      try {
                        const result = await startMcpOauth(
                          server.id,
                          `/agents/${sessionId}`,
                        );
                        if (result.alreadyAuthorized || !result.authorizationUrl) {
                          await reloadSession();
                          setConnectingMcpId(null);
                          return;
                        }
                        window.location.assign(result.authorizationUrl);
                      } catch (err) {
                        setError(
                          err instanceof Error ? err.message : t.agents.mcpOauthErrorBanner,
                        );
                        setConnectingMcpId(null);
                      }
                    })();
                  }}
                >
                  {connectingMcpId === server.id
                    ? t.common.loading
                    : `${t.agents.mcpConnect}: ${server.name}`}
                </Button>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {importResult ? (
        <Alert>
          <AlertTitle>{importResult.successNote}</AlertTitle>
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
                const sectionEdits = isEditMode
                  ? extractSectionEditProposals(message.parts as unknown[])
                  : [];
                const isLastAssistant =
                  message.role === "assistant" && messageIndex === messages.length - 1;
                const skipToolNames = isEditMode
                  ? ["ask_question", "propose_section_edit"]
                  : ["ask_question", "propose_document"];
                return (
                  <Message
                    key={message.id}
                    from={message.role === "user" ? "user" : "assistant"}
                  >
                    <MessageContent from={message.role === "user" ? "user" : "assistant"}>
                      {message.role === "user" ? (
                        <>
                          <MessageQuoteChips parts={message.parts as unknown[]} />
                          <MessageMentionChips parts={message.parts} />
                        </>
                      ) : null}
                      {message.role === "assistant" ? (
                        <MessageParts
                          parts={message.parts}
                          messageId={message.id}
                          reasoningLabel={t.agents.reasoningLabel}
                          skipToolNames={skipToolNames}
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
                      {isLastAssistant && questions.length > 0
                        ? (() => {
                            const pending = questions.filter(
                              (q) => !answeredToolKeys.has(`${message.id}:${q.key}`),
                            );
                            if (pending.length === 0) return null;
                            return (
                              <AskQuestionsBatch
                                questions={pending}
                                disabled={busy}
                                onSubmit={(answer) => {
                                  setAnsweredToolKeys((prev) => {
                                    const next = new Set(prev);
                                    for (const q of pending) {
                                      next.add(`${message.id}:${q.key}`);
                                    }
                                    return next;
                                  });
                                  void sendMessage({ text: answer });
                                }}
                              />
                            );
                          })()
                        : null}
                      {isLastAssistant
                        ? sectionEdits.map((proposal) => {
                            const key = `${message.id}:${proposal.editId}`;
                            const live = sections.find((s) => s.editId === proposal.editId);
                            const liveStatus =
                              live?.status === "accepted" ||
                              live?.status === "rejected" ||
                              live?.status === "superseded"
                                ? live.status
                                : decidedEditKeys.has(key)
                                  ? ("accepted" as const)
                                  : proposal.status;
                            return (
                              <SectionEditProposalCard
                                key={key}
                                sessionId={sessionId}
                                proposal={{ ...proposal, status: liveStatus }}
                                readOnly={liveStatus !== "proposed"}
                                onDecided={(next) => {
                                  setDecidedEditKeys((prev) => new Set(prev).add(key));
                                  setSections((prev) =>
                                    prev.map((s) =>
                                      s.id === proposal.sectionId ||
                                      s.editId === proposal.editId
                                        ? {
                                            ...s,
                                            status: next,
                                            editId: proposal.editId,
                                            ...(next === "accepted" && proposal.proposedHtml
                                              ? { html: proposal.proposedHtml }
                                              : {}),
                                          }
                                        : s,
                                    ),
                                  );
                                  void reloadSession();
                                }}
                              />
                            );
                          })
                        : null}
                    </MessageContent>
                  </Message>
                );
              })}
              {/* Fixed-height slot so the loader appearing/disappearing doesn't
                  nudge StickToBottom and cause an end-of-scroll bounce. */}
              <div className="flex min-h-7 items-center" aria-live="polite">
                {(() => {
                  const last = messages[messages.length - 1];
                  const lastAssistant = last?.role === "assistant" ? last : null;
                  const showThinking =
                    status === "submitted" ||
                    (status === "streaming" &&
                      (!lastAssistant || !hasVisibleAssistantContent(lastAssistant.parts)));
                  return showThinking ? <Loader label={labels.thinking} /> : null;
                })()}
              </div>
              {chatError ? <p className="text-destructive text-xs">{t.chat.error}</p> : null}
            </ConversationContent>
            <ConversationScrollButton label={t.chat.scrollToBottom} />
          </Conversation>

          <div className="border-border min-w-0 border-t p-3">
            <p className="text-muted-foreground mb-1.5 text-[0.6875rem]">{t.agents.uploadHint}</p>
            <PromptInput
              ref={promptRef}
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
              quotes={quotes}
              onQuotesChange={setQuotes}
              quotesOnlyFallback={t.agents.quoteOnlyFallback}
              onSubmit={(text, mentions, nextQuotes) =>
                void sendMessage({
                  role: "user",
                  parts: withTextQuoteParts(
                    buildMentionMessageParts(text, mentions),
                    nextQuotes,
                  ),
                })
              }
              onStop={() => void stop()}
            />
          </div>
        </div>

        {/* Document column — same Preview/Edit chrome for create and edit sessions */}
        {isEditMode ? (
          <PageEditViewerPanel
            sessionId={sessionId}
            bundleId={session.bundleId}
            title={session.title}
            sections={sections}
            effectiveMarkdown={effectiveMarkdown}
            onSaved={() => void reloadSession()}
            onAddQuote={(quote) => {
              setQuotes((prev) => {
                if (prev.some((q) => q.text === quote.text)) return prev;
                return [...prev, quote].slice(-MAX_QUOTES_PER_MESSAGE);
              });
              requestAnimationFrame(() => promptRef.current?.focus());
            }}
          />
        ) : (
          <PageEditViewerPanel
            mode="create"
            title={session.title}
            draftMarkdown={draft}
            editorResetKey={draftEditorKey}
            bundleId={session.bundleId}
            onDraftChange={(md) => {
              setDraft(md);
            }}
            onImport={openImport}
            onAddQuote={(quote) => {
              setQuotes((prev) => {
                if (prev.some((q) => q.text === quote.text)) return prev;
                return [...prev, quote].slice(-MAX_QUOTES_PER_MESSAGE);
              });
              requestAnimationFrame(() => promptRef.current?.focus());
            }}
          />
        )}
      </div>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.agents.importTitle}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <p className="text-muted-foreground text-sm">{t.agents.importHint}</p>
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
                    onChange={(e) => setImportTitle(e.target.value)}
                  />
                </div>
                <PagePathFields
                  folder={importFolder}
                  onFolderChange={setImportFolder}
                  path={importPath}
                  onPathChange={setImportPath}
                  title={importTitle}
                  existingFolders={importExistingFolders}
                  labels={{
                    pathFolderLabel: t.bundles.pathFolderLabel,
                    pathFolderPlaceholder: t.bundles.pathFolderPlaceholder,
                    pathFolderHint: t.bundles.pathFolderHint,
                    pathDocLabel: t.bundles.pathDocLabel,
                    pathDocPlaceholder: t.bundles.pathDocPlaceholder,
                    pathParentRoot: t.bundles.pathParentRoot,
                    pathAddSubfolder: t.bundles.pathAddSubfolder,
                    pathCreatesPrefix: t.bundles.pathCreatesPrefix,
                  }}
                />
                {conflictingPage ? (
                  <div className="border-border bg-muted/40 flex flex-col gap-2 rounded-xl border p-3">
                    <p className="text-sm leading-relaxed">
                      {t.agents.importExistsNotice(conflictingPage.title, conflictingPage.path)}
                    </p>
                    <div className="flex flex-col gap-1.5" role="radiogroup" aria-label={t.agents.importHint}>
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="import-if-exists"
                          checked={importIfExists === "update"}
                          onChange={() => setImportIfExists("update")}
                        />
                        {t.agents.importIfExistsUpdate}
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="import-if-exists"
                          checked={importIfExists === "create"}
                          onChange={() => setImportIfExists("create")}
                        />
                        {t.agents.importIfExistsCreate}
                      </label>
                    </div>
                  </div>
                ) : null}
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
              {importing
                ? t.common.loading
                : pathConflict
                  ? importIfExists === "update"
                    ? t.agents.importSubmitUpdate
                    : t.agents.importSubmitCreate
                  : t.agents.importSubmit}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
