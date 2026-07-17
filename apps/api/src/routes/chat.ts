import { Readable } from "node:stream";

import { type GitEngine } from "@kherad/core/git";
import { checkPermission } from "@kherad/core/permissions";
import { schema, type Database } from "@kherad/db";
import { toAISdkStream } from "@mastra/ai-sdk";
import { Agent } from "@mastra/core/agent";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { chatInstructions } from "../agents/chat/prompt";
import { createChatTools } from "../agents/chat/tools";
import { buildPageMentionContext, extractPageMentions } from "../agents/page-mentions";
import { buildModel, loadAiSettings } from "../agents/settings";
import { getBundleOrNull, isUuid } from "../lib/get-bundle";

export const CHAT_THREAD_HEADER = "x-chat-thread-id";

const MAX_AGENT_STEPS = 16;

// Anonymous chat on public bundles is unauthenticated LLM spend — a small
// in-memory sliding window per IP keeps it from being abused. Authenticated
// users are accountable through their account and skip this.
const ANON_WINDOW_MS = 5 * 60 * 1000;
const ANON_MAX_REQUESTS = 10;
const anonHits = new Map<string, number[]>();

function allowAnonymous(ip: string): boolean {
  const now = Date.now();
  if (anonHits.size > 1000) {
    for (const [key, hits] of anonHits) {
      if (hits.every((t) => now - t >= ANON_WINDOW_MS)) anonHits.delete(key);
    }
  }
  const recent = (anonHits.get(ip) ?? []).filter((t) => now - t < ANON_WINDOW_MS);
  if (recent.length >= ANON_MAX_REQUESTS) {
    anonHits.set(ip, recent);
    return false;
  }
  recent.push(now);
  anonHits.set(ip, recent);
  return true;
}

function threadTitleFrom(message: UIMessage | undefined): string {
  const text = message?.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join(" ")
    .trim();
  return (text || "New conversation").slice(0, 80);
}

export async function chatRoutes(server: FastifyInstance, db: Database, git: GitEngine) {
  server.post<{
    Params: { bundleId: string };
    Body: { messages: UIMessage[]; threadId?: string };
  }>("/bundles/:bundleId/chat", async (request, reply) => {
    const bundle = await getBundleOrNull(db, request.params.bundleId);
    if (!bundle) {
      return reply.code(404).send({ error: "Bundle not found" });
    }
    const allowed = await checkPermission(db, request.user, bundle, null, "view");
    if (!allowed) {
      return reply.code(403).send({ error: "Forbidden" });
    }
    if (bundle.mode !== "llm_compiled") {
      return reply.code(409).send({ error: "Chat is only available on LLM-compiled bundles" });
    }

    const settings = await loadAiSettings(db);
    if (!settings) {
      return reply.code(503).send({ error: "AI settings are not configured" });
    }

    const user = request.user;
    if (!user && !allowAnonymous(request.ip)) {
      return reply.code(429).send({ error: "Too many requests — please slow down" });
    }

    const { messages, threadId: requestedThreadId } = request.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return reply.code(400).send({ error: "messages is required" });
    }
    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");

    // Threads persist for authenticated users only; anonymous conversations
    // live purely in the browser.
    let threadId: string | null = null;
    if (user) {
      if (requestedThreadId) {
        if (!isUuid(requestedThreadId)) {
          return reply.code(404).send({ error: "Thread not found" });
        }
        const thread = await db.query.chatThreads.findFirst({
          where: and(
            eq(schema.chatThreads.id, requestedThreadId),
            eq(schema.chatThreads.bundleId, bundle.id),
            eq(schema.chatThreads.userId, user.id),
          ),
        });
        if (!thread) {
          return reply.code(404).send({ error: "Thread not found" });
        }
        threadId = thread.id;
      } else {
        const [thread] = await db
          .insert(schema.chatThreads)
          .values({
            bundleId: bundle.id,
            userId: user.id,
            title: threadTitleFrom(lastUserMessage),
          })
          .returning();
        threadId = thread?.id ?? null;
      }

      if (threadId && lastUserMessage) {
        await db.insert(schema.chatMessages).values({
          threadId,
          role: "user",
          parts: lastUserMessage.parts,
        });
      }
    }

    const mentionContext = await buildPageMentionContext({
      db,
      git,
      user,
      mentions: extractPageMentions(messages),
    });

    const agent = new Agent({
      id: "okf-chat",
      name: "Knowledge Assistant",
      instructions: chatInstructions(bundle) + mentionContext,
      model: buildModel(settings, "chat"),
      tools: createChatTools({ db, git, bundle }),
    });

    const agentStream = await agent.stream(messages, { maxSteps: MAX_AGENT_STEPS });
    // Mastra types its chunks against a vendored copy of the AI SDK — the
    // wire shapes match the installed `ai` package, so the cast is safe.
    const chunkStream = toAISdkStream(agentStream, {
      from: "agent",
    }) as unknown as ReadableStream<UIMessageChunk>;

    const persistThreadId = threadId;
    const uiStream = createUIMessageStream({
      originalMessages: messages,
      execute: ({ writer }) => {
        writer.merge(chunkStream);
      },
      onFinish:
        user && persistThreadId
          ? async ({ responseMessage }) => {
              try {
                await db.insert(schema.chatMessages).values({
                  threadId: persistThreadId,
                  role: "assistant",
                  parts: responseMessage.parts,
                });
                await db
                  .update(schema.chatThreads)
                  .set({ updatedAt: new Date() })
                  .where(eq(schema.chatThreads.id, persistThreadId));
              } catch (err) {
                server.log.error({ err, threadId: persistThreadId }, "failed to persist chat");
              }
            }
          : undefined,
    });

    const response = createUIMessageStreamResponse({
      stream: uiStream,
      ...(threadId ? { headers: { [CHAT_THREAD_HEADER]: threadId } } : {}),
    });

    // Copy the Response's headers onto the Fastify reply (keeping CORS hooks
    // in charge) and stream the SSE body as a Node readable.
    reply.status(response.status);
    for (const [key, value] of response.headers) {
      reply.header(key, value);
    }
    return reply.send(
      response.body ? Readable.fromWeb(response.body as import("stream/web").ReadableStream) : "",
    );
  });

  server.get<{ Params: { bundleId: string } }>(
    "/bundles/:bundleId/chat/threads",
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }
      if (!request.user) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const allowed = await checkPermission(db, request.user, bundle, null, "view");
      if (!allowed) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const threads = await db.query.chatThreads.findMany({
        where: and(
          eq(schema.chatThreads.bundleId, bundle.id),
          eq(schema.chatThreads.userId, request.user.id),
        ),
        orderBy: desc(schema.chatThreads.updatedAt),
        limit: 50,
        columns: { id: true, title: true, createdAt: true, updatedAt: true },
      });
      return threads;
    },
  );

  server.get<{ Params: { bundleId: string; threadId: string } }>(
    "/bundles/:bundleId/chat/threads/:threadId",
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }
      if (!request.user) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const thread = isUuid(request.params.threadId)
        ? await db.query.chatThreads.findFirst({
            where: and(
              eq(schema.chatThreads.id, request.params.threadId),
              eq(schema.chatThreads.bundleId, bundle.id),
              eq(schema.chatThreads.userId, request.user.id),
            ),
          })
        : undefined;
      if (!thread) {
        return reply.code(404).send({ error: "Thread not found" });
      }

      const rows = await db.query.chatMessages.findMany({
        where: eq(schema.chatMessages.threadId, thread.id),
        orderBy: schema.chatMessages.createdAt,
      });
      return {
        thread: { id: thread.id, title: thread.title },
        messages: rows.map((row) => ({ id: row.id, role: row.role, parts: row.parts })),
      };
    },
  );

  server.delete<{ Params: { bundleId: string; threadId: string } }>(
    "/bundles/:bundleId/chat/threads/:threadId",
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }
      if (!request.user) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      if (!isUuid(request.params.threadId)) {
        return reply.code(404).send({ error: "Thread not found" });
      }

      const [deleted] = await db
        .delete(schema.chatThreads)
        .where(
          and(
            eq(schema.chatThreads.id, request.params.threadId),
            eq(schema.chatThreads.bundleId, bundle.id),
            eq(schema.chatThreads.userId, request.user.id),
          ),
        )
        .returning({ id: schema.chatThreads.id });
      if (!deleted) {
        return reply.code(404).send({ error: "Thread not found" });
      }
      return { deleted: deleted.id };
    },
  );
}
