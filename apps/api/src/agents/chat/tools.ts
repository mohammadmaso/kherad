import { okfGitPathPrefix, type GitEngine } from "@kherad/core/git";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { validateDocPath } from "../indexer/tools";

type Bundle = { slug: string; defaultBranch: string };

const decoder = new TextDecoder();

/**
 * Read-only progressive-disclosure tools over the *merged* OKF bundle —
 * the chat agent only ever sees human-approved knowledge.
 */
export function createChatTools(args: { git: GitEngine; bundle: Bundle }) {
  const { git, bundle } = args;
  const okfPrefix = okfGitPathPrefix(bundle.slug);

  const readIndex = createTool({
    id: "read_index",
    description:
      "Read the knowledge base's root index.md — the directory of everything it covers. Always start here.",
    inputSchema: z.object({}),
    execute: async () => {
      const bytes = await git.getFileAtRef(bundle.defaultBranch, `${okfPrefix}/index.md`);
      if (bytes === null) return { error: "The knowledge base has no index yet" };
      return { content: decoder.decode(bytes) };
    },
  });

  const listDocs = createTool({
    id: "list_docs",
    description: "List every document path in the knowledge base.",
    inputSchema: z.object({}),
    execute: async () => {
      const paths = await git.listFilesAtRef(bundle.defaultBranch, okfPrefix);
      return { docs: paths.map((p) => p.slice(okfPrefix.length + 1)).sort() };
    },
  });

  const readDoc = createTool({
    id: "read_doc",
    description:
      "Read one knowledge-base document by its bundle-relative path (e.g. 'concepts/payroll.md'). Cross-links like '/concepts/payroll.md' resolve here without the leading slash.",
    inputSchema: z.object({ path: z.string() }),
    execute: async ({ path }) => {
      const validPath = validateDocPath(path.replace(/^\//, ""));
      if (!validPath) return { error: `Invalid document path "${path}"` };
      const bytes = await git.getFileAtRef(bundle.defaultBranch, `${okfPrefix}/${validPath}`);
      if (bytes === null) return { error: `No document at "${validPath}"` };
      return { content: decoder.decode(bytes) };
    },
  });

  return { read_index: readIndex, list_docs: listDocs, read_doc: readDoc };
}
