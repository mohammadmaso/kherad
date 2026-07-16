import type { AuthedUser } from "@kherad/core/auth";
import { type GitEngine } from "@kherad/core/git";
import { checkPermission } from "@kherad/core/permissions";
import { schema, type Database } from "@kherad/db";
import { createTool } from "@mastra/core/tools";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

type Bundle = { id: string; slug: string; title: string; defaultBranch: string; isPublic: boolean };

const decoder = new TextDecoder();

/**
 * Interviewer tool surface: read wiki (optional bundle) + session uploads,
 * ask structured questions (HITL via UI), and propose the final markdown draft.
 */
export function createInterviewerTools(args: {
  db: Database;
  git: GitEngine;
  user: AuthedUser;
  sessionId: string;
  bundle: Bundle | null;
}) {
  const { db, git, user, sessionId, bundle } = args;

  const listSourcePagesTool = createTool({
    id: "list_source_pages",
    description:
      "List live wiki pages (path + title) in the attached bundle. Use to find what already exists before interviewing.",
    inputSchema: z.object({}),
    execute: async () => {
      if (!bundle) return { error: "No wiki bundle is attached to this session" };
      const allowed = await checkPermission(db, user, bundle, null, "view");
      if (!allowed) return { error: "You do not have permission to view this bundle" };
      const pages = await db.query.pages.findMany({
        where: and(
          eq(schema.pages.bundleId, bundle.id),
          eq(schema.pages.source, "raw"),
          eq(schema.pages.isDeleted, false),
          isNull(schema.pages.redirectTo),
        ),
        columns: { path: true, title: true },
        orderBy: schema.pages.path,
      });
      return { pages };
    },
  });

  const readSourcePage = createTool({
    id: "read_source_page",
    description: "Read the markdown content of one wiki page by its path (from list_source_pages).",
    inputSchema: z.object({
      path: z.string().describe("The wiki page path, exactly as returned by list_source_pages"),
    }),
    execute: async ({ path }) => {
      if (!bundle) return { error: "No wiki bundle is attached to this session" };
      const allowed = await checkPermission(db, user, bundle, path, "view");
      if (!allowed) return { error: "You do not have permission to view this page" };
      const bytes = await git.getLatestSourcePageAtRef(
        bundle.defaultBranch,
        bundle.slug,
        path,
      );
      if (bytes === null) {
        return { error: `No page at path "${path}"` };
      }
      return { content: decoder.decode(bytes) };
    },
  });

  const listUploads = createTool({
    id: "list_uploads",
    description: "List files the manager uploaded to this interview session.",
    inputSchema: z.object({}),
    execute: async () => {
      const uploads = await db.query.agentUploads.findMany({
        where: eq(schema.agentUploads.sessionId, sessionId),
        columns: { id: true, filename: true, mimeType: true, byteSize: true },
        orderBy: schema.agentUploads.createdAt,
      });
      return { uploads };
    },
  });

  const readUpload = createTool({
    id: "read_upload",
    description: "Read the text content of one uploaded file by its upload id.",
    inputSchema: z.object({
      uploadId: z.string().uuid().describe("Upload id from list_uploads"),
    }),
    execute: async ({ uploadId }) => {
      const upload = await db.query.agentUploads.findFirst({
        where: and(
          eq(schema.agentUploads.id, uploadId),
          eq(schema.agentUploads.sessionId, sessionId),
        ),
      });
      if (!upload) return { error: `No upload with id "${uploadId}"` };
      return {
        filename: upload.filename,
        mimeType: upload.mimeType,
        content: upload.textContent,
      };
    },
  });

  const askQuestion = createTool({
    id: "ask_question",
    description:
      "Present a structured question with selectable options (and optional free-text). After calling this, wait for the manager's next message with their answer.",
    inputSchema: z.object({
      id: z.string().describe("Short stable id for this question, e.g. 'audience'"),
      prompt: z.string().describe("The question shown to the manager"),
      options: z
        .array(z.string())
        .min(1)
        .max(8)
        .describe("Selectable answer choices"),
      allowCustom: z
        .boolean()
        .default(true)
        .describe("Whether the manager may type a custom answer"),
    }),
    execute: async ({ id, prompt, options, allowCustom }) => {
      return {
        status: "awaiting_answer" as const,
        id,
        prompt,
        options,
        allowCustom,
        instruction:
          "Stop and wait. The manager will answer in their next message. Do not ask another structured question until they reply.",
      };
    },
  });

  const proposeDocument = createTool({
    id: "propose_document",
    description:
      "Propose the final markdown document for the manager to edit and import into the wiki. Call once when the interview has enough substance.",
    inputSchema: z.object({
      title: z.string().describe("Suggested document title"),
      markdown: z.string().describe("Full markdown body (no outer code fence)"),
    }),
    execute: async ({ title, markdown }) => {
      const trimmed = markdown.trim();
      if (!trimmed) return { error: "markdown must not be empty" };
      await db
        .update(schema.agentSessions)
        .set({
          draftMarkdown: trimmed,
          status: "draft_ready",
          title: title.trim().slice(0, 120) || "Interview draft",
          updatedAt: new Date(),
        })
        .where(eq(schema.agentSessions.id, sessionId));
      return { status: "draft_ready" as const, title: title.trim(), length: trimmed.length };
    },
  });

  return {
    list_source_pages: listSourcePagesTool,
    read_source_page: readSourcePage,
    list_uploads: listUploads,
    read_upload: readUpload,
    ask_question: askQuestion,
    propose_document: proposeDocument,
  };
}
