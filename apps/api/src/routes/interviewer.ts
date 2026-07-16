import { Readable } from "node:stream";

import type { AuthedUser } from "@kherad/core/auth";
import { resolvePagePath, type GitEngine } from "@kherad/core/git";
import { canAccessAgents, checkPermission } from "@kherad/core/permissions";
import { schema, type Database } from "@kherad/db";
import { toAISdkStream } from "@mastra/ai-sdk";
import { Agent } from "@mastra/core/agent";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { interviewerInstructions } from "../agents/interviewer/prompt";
import { createInterviewerTools } from "../agents/interviewer/tools";
import { startIndexerRun } from "../agents/indexer/run";
import { buildModel, loadAiSettings } from "../agents/settings";
import { getBundleOrNull } from "../lib/get-bundle";
import { pageGitPath } from "../lib/wiki-paths";

const MAX_AGENT_STEPS = 24;
const MAX_UPLOAD_BYTES = 256 * 1024;
const MAX_UPLOADS_PER_SESSION = 10;
const TEXT_MIME_PREFIXES = ["text/", "application/json", "application/csv"];
const TEXT_EXTENSIONS = new Set([".md", ".txt", ".csv", ".json", ".markdown", ".tsv"]);

const AVAILABLE_AGENTS = [
  {
    id: "interviewer" as const,
    name: "Interviewer",
    description:
      "Define a documentation goal, answer structured questions, and produce a wiki-ready markdown draft.",
    href: "/agents/interviewer",
  },
];

async function allocatePagePath(
  db: Database,
  bundleId: string,
  basePath: string,
): Promise<string> {
  let candidate = basePath;
  let suffix = 2;
  while (true) {
    const taken = await db.query.pages.findFirst({
      where: and(
        eq(schema.pages.bundleId, bundleId),
        eq(schema.pages.source, "raw"),
        eq(schema.pages.path, candidate),
      ),
      columns: { id: true },
    });
    if (!taken) return candidate;
    candidate = `${basePath}-${suffix}`;
    suffix += 1;
  }
}

function sessionTitleFrom(goal: string | null | undefined, message?: UIMessage): string {
  if (goal?.trim()) return goal.trim().slice(0, 80);
  const text = message?.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join(" ")
    .trim();
  return (text || "Interview session").slice(0, 80);
}

function isAllowedTextUpload(filename: string, mimeType: string): boolean {
  const lower = filename.toLowerCase();
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".")) : "";
  if (TEXT_EXTENSIONS.has(ext)) return true;
  return TEXT_MIME_PREFIXES.some((p) => mimeType === p || mimeType.startsWith(p));
}

async function requireAgentAccess(
  db: Database,
  user: AuthedUser | null,
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
) {
  if (!user) {
    reply.code(401).send({ error: "Unauthorized" });
    return false;
  }
  const allowed = await canAccessAgents(db, user);
  if (!allowed) {
    reply.code(403).send({ error: "Forbidden" });
    return false;
  }
  return true;
}

async function loadOwnedSession(db: Database, sessionId: string, userId: string, isAdmin: boolean) {
  const session = await db.query.agentSessions.findFirst({
    where: and(
      eq(schema.agentSessions.id, sessionId),
      eq(schema.agentSessions.agentType, "interviewer"),
    ),
  });
  if (!session) return null;
  if (!isAdmin && session.userId !== userId) return null;
  return session;
}

function toSessionResponse(
  session: typeof schema.agentSessions.$inferSelect,
  extras?: { uploadCount?: number; bundle?: { id: string; slug: string; title: string; mode: string } | null },
) {
  return {
    id: session.id,
    agentType: session.agentType,
    title: session.title,
    goal: session.goal,
    bundleId: session.bundleId,
    draftMarkdown: session.draftMarkdown,
    status: session.status,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    uploadCount: extras?.uploadCount ?? 0,
    bundle: extras?.bundle ?? null,
  };
}

export async function interviewerRoutes(server: FastifyInstance, db: Database, git: GitEngine) {
  // @fastify/multipart is registered by ingest routes on the same Fastify
  // instance — do not register it again here.

  server.get("/agents", async (request, reply) => {
    if (!(await requireAgentAccess(db, request.user, reply))) return;
    const user = request.user!;

    const sessions = await db.query.agentSessions.findMany({
      where: and(
        eq(schema.agentSessions.userId, user.id),
        eq(schema.agentSessions.agentType, "interviewer"),
      ),
      orderBy: desc(schema.agentSessions.updatedAt),
      limit: 30,
    });

    return {
      agents: AVAILABLE_AGENTS,
      sessions: sessions.map((s) => ({
        id: s.id,
        agentType: s.agentType,
        title: s.title,
        goal: s.goal,
        status: s.status,
        bundleId: s.bundleId,
        updatedAt: s.updatedAt.toISOString(),
        createdAt: s.createdAt.toISOString(),
      })),
    };
  });

  server.post<{
    Body: { goal?: string; bundleId?: string | null };
  }>("/agents/interviewer/sessions", async (request, reply) => {
    if (!(await requireAgentAccess(db, request.user, reply))) return;
    const user = request.user!;
    const goal = request.body?.goal?.trim() || null;
    let bundleId: string | null = request.body?.bundleId ?? null;

    if (bundleId) {
      const bundle = await getBundleOrNull(db, bundleId);
      if (!bundle || bundle.archivedAt) {
        return reply.code(404).send({ error: "Bundle not found" });
      }
      const canView = await checkPermission(db, user, bundle, null, "view");
      if (!canView) {
        return reply.code(403).send({ error: "Forbidden" });
      }
    } else {
      bundleId = null;
    }

    const [session] = await db
      .insert(schema.agentSessions)
      .values({
        userId: user.id,
        agentType: "interviewer",
        title: sessionTitleFrom(goal),
        goal,
        bundleId,
        status: "active",
      })
      .returning();

    if (!session) {
      return reply.code(500).send({ error: "Failed to create session" });
    }

    reply.code(201);
    return toSessionResponse(session, { uploadCount: 0 });
  });

  server.get<{ Params: { sessionId: string } }>(
    "/agents/interviewer/sessions/:sessionId",
    async (request, reply) => {
      if (!(await requireAgentAccess(db, request.user, reply))) return;
      const user = request.user!;
      const session = await loadOwnedSession(db, request.params.sessionId, user.id, user.isAdmin);
      if (!session) {
        return reply.code(404).send({ error: "Session not found" });
      }

      const [uploads, messages, bundle] = await Promise.all([
        db.query.agentUploads.findMany({
          where: eq(schema.agentUploads.sessionId, session.id),
          columns: {
            id: true,
            filename: true,
            mimeType: true,
            byteSize: true,
            createdAt: true,
          },
          orderBy: schema.agentUploads.createdAt,
        }),
        db.query.agentMessages.findMany({
          where: eq(schema.agentMessages.sessionId, session.id),
          orderBy: schema.agentMessages.createdAt,
        }),
        session.bundleId ? getBundleOrNull(db, session.bundleId) : Promise.resolve(undefined),
      ]);

      return {
        session: toSessionResponse(session, {
          uploadCount: uploads.length,
          bundle: bundle
            ? { id: bundle.id, slug: bundle.slug, title: bundle.title, mode: bundle.mode }
            : null,
        }),
        uploads: uploads.map((u) => ({
          id: u.id,
          filename: u.filename,
          mimeType: u.mimeType,
          byteSize: u.byteSize,
          createdAt: u.createdAt.toISOString(),
        })),
        messages: messages.map((row) => ({
          id: row.id,
          role: row.role,
          parts: row.parts,
        })),
      };
    },
  );

  server.patch<{
    Params: { sessionId: string };
    Body: {
      goal?: string | null;
      bundleId?: string | null;
      draftMarkdown?: string | null;
      title?: string;
      status?: "active" | "draft_ready" | "imported" | "archived";
    };
  }>("/agents/interviewer/sessions/:sessionId", async (request, reply) => {
    if (!(await requireAgentAccess(db, request.user, reply))) return;
    const user = request.user!;
    const session = await loadOwnedSession(db, request.params.sessionId, user.id, user.isAdmin);
    if (!session) {
      return reply.code(404).send({ error: "Session not found" });
    }

    const updates: Partial<typeof schema.agentSessions.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (request.body.goal !== undefined) {
      updates.goal = request.body.goal?.trim() || null;
      if (updates.goal && !request.body.title) {
        updates.title = updates.goal.slice(0, 80);
      }
    }
    if (request.body.title !== undefined) {
      const title = request.body.title.trim();
      if (!title) return reply.code(400).send({ error: "Title is required" });
      updates.title = title.slice(0, 120);
    }
    if (request.body.draftMarkdown !== undefined) {
      updates.draftMarkdown = request.body.draftMarkdown;
      if (request.body.draftMarkdown?.trim() && session.status === "active") {
        updates.status = "draft_ready";
      }
    }
    if (request.body.status !== undefined) {
      updates.status = request.body.status;
    }
    if (request.body.bundleId !== undefined) {
      if (request.body.bundleId === null) {
        updates.bundleId = null;
      } else {
        const bundle = await getBundleOrNull(db, request.body.bundleId);
        if (!bundle || bundle.archivedAt) {
          return reply.code(404).send({ error: "Bundle not found" });
        }
        const canView = await checkPermission(db, user, bundle, null, "view");
        if (!canView) {
          return reply.code(403).send({ error: "Forbidden" });
        }
        updates.bundleId = bundle.id;
      }
    }

    const [updated] = await db
      .update(schema.agentSessions)
      .set(updates)
      .where(eq(schema.agentSessions.id, session.id))
      .returning();

    return toSessionResponse(updated!);
  });

  server.post<{ Params: { sessionId: string } }>(
    "/agents/interviewer/sessions/:sessionId/uploads",
    async (request, reply) => {
      if (!(await requireAgentAccess(db, request.user, reply))) return;
      const user = request.user!;
      const session = await loadOwnedSession(db, request.params.sessionId, user.id, user.isAdmin);
      if (!session) {
        return reply.code(404).send({ error: "Session not found" });
      }

      const existing = await db.query.agentUploads.findMany({
        where: eq(schema.agentUploads.sessionId, session.id),
        columns: { id: true },
      });
      if (existing.length >= MAX_UPLOADS_PER_SESSION) {
        return reply.code(400).send({ error: `At most ${MAX_UPLOADS_PER_SESSION} uploads per session` });
      }

      const file = await request.file();
      if (!file) {
        return reply.code(400).send({ error: "file is required" });
      }

      const buffer = await file.toBuffer();
      if (buffer.byteLength > MAX_UPLOAD_BYTES) {
        return reply.code(400).send({ error: "File exceeds 256KB limit" });
      }

      const mimeType = file.mimetype || "text/plain";
      if (!isAllowedTextUpload(file.filename, mimeType)) {
        return reply
          .code(400)
          .send({ error: "Only text, markdown, csv, or json uploads are supported" });
      }

      const textContent = buffer.toString("utf8");
      const [upload] = await db
        .insert(schema.agentUploads)
        .values({
          sessionId: session.id,
          filename: file.filename.slice(0, 255),
          mimeType,
          byteSize: buffer.byteLength,
          textContent,
        })
        .returning();

      await db
        .update(schema.agentSessions)
        .set({ updatedAt: new Date() })
        .where(eq(schema.agentSessions.id, session.id));

      reply.code(201);
      return {
        id: upload!.id,
        filename: upload!.filename,
        mimeType: upload!.mimeType,
        byteSize: upload!.byteSize,
        createdAt: upload!.createdAt.toISOString(),
      };
    },
  );

  server.delete<{ Params: { sessionId: string; uploadId: string } }>(
    "/agents/interviewer/sessions/:sessionId/uploads/:uploadId",
    async (request, reply) => {
      if (!(await requireAgentAccess(db, request.user, reply))) return;
      const user = request.user!;
      const session = await loadOwnedSession(db, request.params.sessionId, user.id, user.isAdmin);
      if (!session) {
        return reply.code(404).send({ error: "Session not found" });
      }

      const [deleted] = await db
        .delete(schema.agentUploads)
        .where(
          and(
            eq(schema.agentUploads.id, request.params.uploadId),
            eq(schema.agentUploads.sessionId, session.id),
          ),
        )
        .returning({ id: schema.agentUploads.id });

      if (!deleted) {
        return reply.code(404).send({ error: "Upload not found" });
      }
      return { deleted: deleted.id };
    },
  );

  server.post<{
    Params: { sessionId: string };
    Body: { messages: UIMessage[] };
  }>("/agents/interviewer/sessions/:sessionId/chat", async (request, reply) => {
    if (!(await requireAgentAccess(db, request.user, reply))) return;
    const user = request.user!;
    const session = await loadOwnedSession(db, request.params.sessionId, user.id, user.isAdmin);
    if (!session) {
      return reply.code(404).send({ error: "Session not found" });
    }

    const settings = await loadAiSettings(db);
    if (!settings) {
      return reply.code(503).send({ error: "AI settings are not configured" });
    }

    const { messages } = request.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return reply.code(400).send({ error: "messages is required" });
    }
    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");

    if (lastUserMessage) {
      await db.insert(schema.agentMessages).values({
        sessionId: session.id,
        role: "user",
        parts: lastUserMessage.parts,
      });
      if (!session.goal && session.title === "Interview session") {
        const title = sessionTitleFrom(null, lastUserMessage);
        await db
          .update(schema.agentSessions)
          .set({ title, updatedAt: new Date() })
          .where(eq(schema.agentSessions.id, session.id));
      } else {
        await db
          .update(schema.agentSessions)
          .set({ updatedAt: new Date() })
          .where(eq(schema.agentSessions.id, session.id));
      }
    }

    const bundle = session.bundleId ? await getBundleOrNull(db, session.bundleId) : null;
    const uploadCount = await db.query.agentUploads.findMany({
      where: eq(schema.agentUploads.sessionId, session.id),
      columns: { id: true },
    });

    const agent = new Agent({
      id: "interviewer",
      name: "Interviewer",
      instructions: interviewerInstructions({
        goal: session.goal,
        bundleTitle: bundle?.title ?? null,
        hasUploads: uploadCount.length > 0,
      }),
      model: buildModel(settings, "interviewer"),
      tools: createInterviewerTools({
        db,
        git,
        user,
        sessionId: session.id,
        bundle: bundle
          ? {
              id: bundle.id,
              slug: bundle.slug,
              title: bundle.title,
              defaultBranch: bundle.defaultBranch,
              isPublic: bundle.isPublic,
            }
          : null,
      }),
    });

    const agentStream = await agent.stream(messages, { maxSteps: MAX_AGENT_STEPS });
    const chunkStream = toAISdkStream(agentStream, {
      from: "agent",
    }) as unknown as ReadableStream<UIMessageChunk>;

    const uiStream = createUIMessageStream({
      originalMessages: messages,
      execute: ({ writer }) => {
        writer.merge(chunkStream);
      },
      onFinish: async ({ responseMessage }) => {
        try {
          await db.insert(schema.agentMessages).values({
            sessionId: session.id,
            role: "assistant",
            parts: responseMessage.parts,
          });
          await db
            .update(schema.agentSessions)
            .set({ updatedAt: new Date() })
            .where(eq(schema.agentSessions.id, session.id));
        } catch (err) {
          server.log.error({ err, sessionId: session.id }, "failed to persist interviewer chat");
        }
      },
    });

    const response = createUIMessageStreamResponse({ stream: uiStream });
    reply.status(response.status);
    for (const [key, value] of response.headers) {
      reply.header(key, value);
    }
    return reply.send(
      response.body ? Readable.fromWeb(response.body as import("stream/web").ReadableStream) : "",
    );
  });

  server.post<{
    Params: { sessionId: string };
    Body: { bundleId: string; path?: string; title: string };
  }>("/agents/interviewer/sessions/:sessionId/import", async (request, reply) => {
    if (!(await requireAgentAccess(db, request.user, reply))) return;
    const user = request.user!;
    const session = await loadOwnedSession(db, request.params.sessionId, user.id, user.isAdmin);
    if (!session) {
      return reply.code(404).send({ error: "Session not found" });
    }

    const draft = session.draftMarkdown?.trim();
    if (!draft) {
      return reply.code(400).send({ error: "Draft is empty — finish the interview first" });
    }

    const { title } = request.body;
    if (!title?.trim()) {
      return reply.code(400).send({ error: "Title is required" });
    }

    const bundle = await getBundleOrNull(db, request.body.bundleId);
    if (!bundle || bundle.archivedAt) {
      return reply.code(404).send({ error: "Bundle not found" });
    }

    const basePath = resolvePagePath({ path: request.body.path ?? "", title });
    if (basePath === null) {
      return reply.code(400).send({ error: "Invalid path" });
    }
    const path = await allocatePagePath(db, bundle.id, basePath);

    const allowed = await checkPermission(db, user, bundle, path, "edit");
    if (!allowed) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const branch = await git.createUserBranch(user.id);
    await git.writeAndCommit(
      branch,
      [{ path: pageGitPath(bundle.slug, path), content: draft }],
      `Import interview draft: ${path}`,
      { name: user.displayName, email: user.email },
    );

    const [page] = await db
      .insert(schema.pages)
      .values({ bundleId: bundle.id, path, title: title.trim(), isDeleted: false })
      .returning();

    await db
      .update(schema.agentSessions)
      .set({
        status: "imported",
        bundleId: bundle.id,
        updatedAt: new Date(),
      })
      .where(eq(schema.agentSessions.id, session.id));

    type CompileResult =
      | { status: "started"; runId: string }
      | { status: "skipped"; reason: string }
      | { status: "failed"; reason: string };

    let compile: CompileResult = { status: "skipped", reason: "Bundle is not LLM-compiled" };

    if (bundle.mode === "llm_compiled") {
      const canReview = await checkPermission(db, user, bundle, null, "review");
      if (!canReview) {
        compile = { status: "skipped", reason: "Missing review permission to start compile" };
      } else {
        const settings = await loadAiSettings(db);
        if (!settings) {
          compile = { status: "skipped", reason: "AI settings are not configured" };
        } else {
          const result = await startIndexerRun({
            db,
            git,
            bundle,
            settings,
            triggeredById: user.id,
            log: server.log,
          });
          if (result.ok) {
            compile = { status: "started", runId: result.runId };
          } else {
            compile = { status: "failed", reason: "A compile run is already in progress" };
          }
        }
      }
    }

    reply.code(201);
    return { page, compile, branch };
  });

  // Bundles the caller can attach / import into (view for context, edit for import).
  server.get("/agents/interviewer/bundles", async (request, reply) => {
    if (!(await requireAgentAccess(db, request.user, reply))) return;
    const user = request.user!;

    const all = await db.query.bundles.findMany({
      where: isNull(schema.bundles.archivedAt),
      orderBy: schema.bundles.title,
    });

    const visible: Array<{
      id: string;
      slug: string;
      title: string;
      mode: string;
      canEdit: boolean;
    }> = [];

    for (const bundle of all) {
      const canView = await checkPermission(db, user, bundle, null, "view");
      if (!canView) continue;
      const canEdit = await checkPermission(db, user, bundle, null, "edit");
      visible.push({
        id: bundle.id,
        slug: bundle.slug,
        title: bundle.title,
        mode: bundle.mode,
        canEdit,
      });
    }

    return visible;
  });
}
