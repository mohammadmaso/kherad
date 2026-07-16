import { normalizePagePath, okfGitPathPrefix, type GitEngine } from "@kherad/core/git";
import { schema, type Database } from "@kherad/db";
import { createTool } from "@mastra/core/tools";
import { and, eq, isNull } from "drizzle-orm";
import matter from "gray-matter";
import { z } from "zod";

type Bundle = { id: string; slug: string; defaultBranch: string };

const decoder = new TextDecoder();

/** Reserved OKF filenames that skip the frontmatter-`type` requirement. */
const RESERVED_DOCS = new Set(["index.md", "log.md"]);

export function validateDocPath(rawPath: string): string | null {
  const withoutExt = rawPath.endsWith(".md") ? rawPath.slice(0, -".md".length) : null;
  if (!withoutExt) return null;
  const normalized = normalizePagePath(withoutExt);
  return normalized ? `${normalized}.md` : null;
}

/**
 * Source-page query shared by the tool and the kickoff-prompt builder:
 * live pages only — soft-deleted rows and rename tombstones are stale.
 */
export function listSourcePages(db: Database, bundleId: string) {
  return db.query.pages.findMany({
    where: and(
      eq(schema.pages.bundleId, bundleId),
      eq(schema.pages.source, "raw"),
      eq(schema.pages.isDeleted, false),
      isNull(schema.pages.redirectTo),
    ),
    columns: { path: true, title: true },
    orderBy: schema.pages.path,
  });
}

/**
 * The indexer's tool surface (modeled on the OKF reference agent). Reads hit
 * the merged default branch; writes accumulate in `pending` (doc path →
 * content, or null for deletion) and are committed once by the run
 * orchestrator — the agent never touches git directly.
 */
export function createIndexerTools(args: {
  db: Database;
  git: GitEngine;
  bundle: Bundle;
  pending: Map<string, string | null>;
}) {
  const { db, git, bundle, pending } = args;
  const okfPrefix = okfGitPathPrefix(bundle.slug);

  const listSourcePagesTool = createTool({
    id: "list_source_pages",
    description: "List the bundle's live wiki pages (path + title) to compile from.",
    inputSchema: z.object({}),
    execute: async () => {
      return { pages: await listSourcePages(db, bundle.id) };
    },
  });

  const readSourcePage = createTool({
    id: "read_source_page",
    description: "Read the markdown content of one source wiki page by its page path.",
    inputSchema: z.object({
      path: z.string().describe("The wiki page path, exactly as returned by list_source_pages"),
    }),
    execute: async ({ path }) => {
      const bytes = await git.getLatestSourcePageAtRef(
        bundle.defaultBranch,
        bundle.slug,
        path,
      );
      if (bytes === null) {
        return {
          error: `No page at path "${path}" on main or any author branch — save the document first, then recompile.`,
        };
      }
      return { content: decoder.decode(bytes) };
    },
  });

  const listExistingDocs = createTool({
    id: "list_existing_docs",
    description:
      "List the OKF documents that already exist in the published knowledge bundle, plus any you have written this run.",
    inputSchema: z.object({}),
    execute: async () => {
      const published = await git.listFilesAtRef(bundle.defaultBranch, okfPrefix);
      const docs = new Set(published.map((p) => p.slice(okfPrefix.length + 1)));
      for (const [path, content] of pending) {
        if (content === null) docs.delete(path);
        else docs.add(path);
      }
      return { docs: [...docs].sort() };
    },
  });

  const readExistingDoc = createTool({
    id: "read_existing_doc",
    description:
      "Read one existing OKF document (bundle-relative path, e.g. 'index.md' or 'concepts/payroll.md'). Reflects your pending writes.",
    inputSchema: z.object({ path: z.string() }),
    execute: async ({ path }) => {
      if (pending.has(path)) {
        const content = pending.get(path) ?? null;
        return content === null ? { error: `You deleted "${path}" this run` } : { content };
      }
      const bytes = await git.getFileAtRef(bundle.defaultBranch, `${okfPrefix}/${path}`);
      if (bytes === null) return { error: `No OKF document at "${path}"` };
      return { content: decoder.decode(bytes) };
    },
  });

  const writeConceptDoc = createTool({
    id: "write_concept_doc",
    description:
      "Write (create or replace) one OKF document. Path is bundle-relative and must end in .md. Concept documents must start with YAML frontmatter containing at least `type`. index.md and log.md have no frontmatter requirement.",
    inputSchema: z.object({
      path: z.string().describe("Bundle-relative path, e.g. 'concepts/payroll.md'"),
      content: z.string().describe("Full markdown content of the document"),
    }),
    execute: async ({ path, content }) => {
      const validPath = validateDocPath(path);
      if (!validPath) {
        return {
          error: `Invalid path "${path}": must be a relative path ending in .md with no empty, '.' or '..' segments`,
        };
      }

      if (!RESERVED_DOCS.has(validPath)) {
        let parsed: ReturnType<typeof matter>;
        try {
          parsed = matter(content);
        } catch (err) {
          return { error: `Frontmatter is not valid YAML: ${String(err)}. Fix it and retry.` };
        }
        const type = parsed.data?.type;
        if (typeof type !== "string" || !type.trim()) {
          return {
            error:
              "Missing required frontmatter field `type`. Every concept document needs a `---` YAML block with a non-empty `type`.",
          };
        }
      }

      pending.set(validPath, content);
      return { written: validPath };
    },
  });

  const deleteDoc = createTool({
    id: "delete_doc",
    description:
      "Delete one OKF document whose source material no longer exists (bundle-relative path).",
    inputSchema: z.object({ path: z.string() }),
    execute: async ({ path }) => {
      const validPath = validateDocPath(path);
      if (!validPath) return { error: `Invalid path "${path}"` };
      if (RESERVED_DOCS.has(validPath)) return { error: `"${validPath}" is reserved — rewrite it instead` };
      pending.set(validPath, null);
      return { deleted: validPath };
    },
  });

  return {
    list_source_pages: listSourcePagesTool,
    read_source_page: readSourcePage,
    list_existing_docs: listExistingDocs,
    read_existing_doc: readExistingDoc,
    write_concept_doc: writeConceptDoc,
    delete_doc: deleteDoc,
  };
}
