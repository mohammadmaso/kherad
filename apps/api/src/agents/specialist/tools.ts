import type { AuthedUser } from "@kherad/core/auth";
import { type GitEngine } from "@kherad/core/git";
import { checkPermission } from "@kherad/core/permissions";
import { schema, type Database } from "@kherad/db";
import { createTool } from "@mastra/core/tools";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { createEmbedder } from "../../lib/embedder";
import { createSearchTools } from "../search-tools";

const decoder = new TextDecoder();

/**
 * Shared research / HITL tools used by both create-mode and edit-mode
 * specialist sessions (wiki browse, uploads, ask_question, search).
 */
export function createResearchTools(args: {
  db: Database;
  git: GitEngine;
  user: AuthedUser;
  sessionId: string;
}) {
  const { db, git, user, sessionId } = args;

  async function findViewableBundle(slug: string) {
    const bundle = await db.query.bundles.findFirst({
      where: and(eq(schema.bundles.slug, slug), isNull(schema.bundles.archivedAt)),
    });
    if (!bundle) return null;
    const allowed = await checkPermission(db, user, bundle, null, "view");
    return allowed ? bundle : null;
  }

  const listBundles = createTool({
    id: "list_bundles",
    description:
      "List wiki bundles (slug + title) the user can view. Start research here, then drill into a bundle with list_source_pages.",
    inputSchema: z.object({}),
    execute: async () => {
      const all = await db.query.bundles.findMany({
        where: isNull(schema.bundles.archivedAt),
        orderBy: schema.bundles.title,
      });
      const visible: Array<{ slug: string; title: string }> = [];
      for (const bundle of all) {
        if (await checkPermission(db, user, bundle, null, "view")) {
          visible.push({ slug: bundle.slug, title: bundle.title });
        }
      }
      return { bundles: visible };
    },
  });

  const listSourcePages = createTool({
    id: "list_source_pages",
    description:
      "List live wiki pages (path + title) in one bundle, by its slug from list_bundles.",
    inputSchema: z.object({
      bundleSlug: z.string().describe("Bundle slug, exactly as returned by list_bundles"),
    }),
    execute: async ({ bundleSlug }) => {
      const bundle = await findViewableBundle(bundleSlug);
      if (!bundle) return { error: `No viewable bundle with slug "${bundleSlug}"` };
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
    description:
      "Read the markdown content of one wiki page by bundle slug and page path (from list_source_pages).",
    inputSchema: z.object({
      bundleSlug: z.string().describe("Bundle slug, exactly as returned by list_bundles"),
      path: z.string().describe("The wiki page path, exactly as returned by list_source_pages"),
    }),
    execute: async ({ bundleSlug, path }) => {
      const bundle = await findViewableBundle(bundleSlug);
      if (!bundle) return { error: `No viewable bundle with slug "${bundleSlug}"` };
      const allowed = await checkPermission(db, user, bundle, path, "view");
      if (!allowed) return { error: "You do not have permission to view this page" };
      const bytes = await git.getLatestSourcePageAtRef(bundle.defaultBranch, bundle.slug, path);
      if (bytes === null) return { error: `No page at path "${path}"` };
      return { content: decoder.decode(bytes) };
    },
  });

  const listUploads = createTool({
    id: "list_uploads",
    description: "List files the user uploaded to this session.",
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
      "Present a structured question with selectable options (and optional free-text). You may call this multiple times in one turn for independent questions; the user answers them all at once. After your turn, wait for their reply.",
    inputSchema: z.object({
      id: z
        .string()
        .describe("Short unique id for this question, e.g. 'audience' — must be unique among questions in the same turn"),
      prompt: z.string().describe("The question shown to the user"),
      options: z
        .array(z.string())
        .min(1)
        .max(8)
        .describe("Selectable answer choices"),
      allowCustom: z
        .boolean()
        .default(true)
        .describe("Whether the user may type a custom answer"),
    }),
    execute: async ({ id, prompt, options, allowCustom }) => {
      return {
        status: "awaiting_answer" as const,
        id,
        prompt,
        options,
        allowCustom,
        instruction:
          "You may ask several structured questions in this same turn. After the turn ends, stop and wait — the user will reply with all answers in one message.",
      };
    },
  });

  const searchTools = createSearchTools({
    db,
    embedderFactory: () => createEmbedder(db),
    scope: { kind: "user", user },
  });

  return {
    list_bundles: listBundles,
    list_source_pages: listSourcePages,
    read_source_page: readSourcePage,
    list_uploads: listUploads,
    read_upload: readUpload,
    ask_question: askQuestion,
    ...searchTools,
  };
}

/**
 * Specialist tool surface for create-mode sessions: research tools plus the
 * final propose_document handoff that fills agentSessions.draftMarkdown.
 */
export function createSpecialistTools(args: {
  db: Database;
  git: GitEngine;
  user: AuthedUser;
  sessionId: string;
}) {
  const { db, sessionId } = args;

  const proposeDocument = createTool({
    id: "propose_document",
    description:
      "Propose the final markdown document for the user to review and import into the wiki (new page, or update of an existing path if they choose). Call once when the session has enough substance. Do not use this to silently replace an existing page the user only meant to edit — if they want in-place section edits, tell them to use Edit with agent on that page.",
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
          title: title.trim().slice(0, 120) || "Session draft",
          updatedAt: new Date(),
        })
        .where(eq(schema.agentSessions.id, sessionId));
      return { status: "draft_ready" as const, title: title.trim(), length: trimmed.length };
    },
  });

  return {
    ...createResearchTools(args),
    propose_document: proposeDocument,
  };
}
