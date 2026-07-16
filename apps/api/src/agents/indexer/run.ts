import {
  okfDocGitPath,
  okfGitPathPrefix,
  type FileWrite,
  type GitEngine,
} from "@kherad/core/git";
import { SYSTEM_INDEXER_DISPLAY_NAME, SYSTEM_INDEXER_EMAIL, schema, type Database } from "@kherad/db";
import { Agent } from "@mastra/core/agent";
import { and, desc, eq, gt, inArray, lt } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";

import { buildModel, type ResolvedAiSettings } from "../settings";
import { getOrCreateSystemUser } from "../system-user";
import { indexerInstructions, indexerKickoffPrompt } from "./prompt";
import {
  applyResourceUrlsToPending,
  buildSourceMirrorWrites,
  diffSourcesAgainstMirror,
  listDocsLinkedToSources,
} from "./source-mirror";
import { createIndexerTools, listSourcePages } from "./tools";

type Bundle = { id: string; slug: string; title: string; defaultBranch: string };

/** One long-lived agent branch per bundle, mirroring the one-branch-per-user model. */
export function agentOkfBranchName(bundleId: string): string {
  return `agent/okf-${bundleId}`;
}

/**
 * A `running` row older than this no longer blocks new runs — the recovery
 * story for a process that died mid-run (there is no queue to reconcile).
 */
const STALE_RUN_MS = 30 * 60 * 1000;
const MAX_AGENT_STEPS = 64;

export type StartRunResult = { ok: true; runId: string } | { ok: false; reason: "already_running" };

/**
 * Inserts the run row and fires the compile in the background. The row is the
 * failure-reporting surface — the web UI polls it; errors never propagate out
 * of this function after it returns.
 */
export async function startIndexerRun(args: {
  db: Database;
  git: GitEngine;
  bundle: Bundle;
  settings: ResolvedAiSettings;
  triggeredById: string;
  log: FastifyBaseLogger;
}): Promise<StartRunResult> {
  const { db, bundle } = args;
  const staleBefore = new Date(Date.now() - STALE_RUN_MS);

  const active = await db.query.indexerRuns.findFirst({
    where: and(
      eq(schema.indexerRuns.bundleId, bundle.id),
      eq(schema.indexerRuns.status, "running"),
      gt(schema.indexerRuns.startedAt, staleBefore),
    ),
  });
  if (active) return { ok: false, reason: "already_running" };

  await db
    .update(schema.indexerRuns)
    .set({ status: "failed", error: "Run abandoned (process restarted)", finishedAt: new Date() })
    .where(
      and(
        eq(schema.indexerRuns.bundleId, bundle.id),
        eq(schema.indexerRuns.status, "running"),
        lt(schema.indexerRuns.startedAt, staleBefore),
      ),
    );

  const [run] = await db
    .insert(schema.indexerRuns)
    .values({ bundleId: bundle.id, triggeredById: args.triggeredById, status: "running" })
    .returning();
  if (!run) throw new Error("Failed to create indexer run row");

  void runIndexer({ ...args, runId: run.id })
    .then(async (outcome) => {
      await db
        .update(schema.indexerRuns)
        .set({
          status: "succeeded",
          mrId: outcome.mrId,
          stats: outcome.stats,
          finishedAt: new Date(),
        })
        .where(eq(schema.indexerRuns.id, run.id));
    })
    .catch(async (err) => {
      args.log.error({ err, runId: run.id, bundleId: bundle.id }, "indexer run failed");
      await db
        .update(schema.indexerRuns)
        .set({
          status: "failed",
          error: String(err instanceof Error ? err.message : err).slice(0, 2000),
          finishedAt: new Date(),
        })
        .where(eq(schema.indexerRuns.id, run.id))
        .catch((updateErr) =>
          args.log.error({ err: updateErr, runId: run.id }, "failed to record indexer failure"),
        );
    });

  return { ok: true, runId: run.id };
}

type RunOutcome = {
  mrId: string | null;
  stats: {
    sourcePages: number;
    docsWritten: number;
    docsDeleted: number;
    changedFiles: number;
    skippedUnchanged: number;
  };
};

async function runIndexer(args: {
  db: Database;
  git: GitEngine;
  bundle: Bundle;
  settings: ResolvedAiSettings;
  runId: string;
}): Promise<RunOutcome> {
  const { db, git, bundle, settings, runId } = args;
  const prefix = okfGitPathPrefix(bundle.slug);
  const branch = agentOkfBranchName(bundle.id);

  const systemUser = await getOrCreateSystemUser(db);
  const sourcePages = await listSourcePages(db, bundle.id);
  const existingDocs = (await git.listFilesAtRef(bundle.defaultBranch, prefix)).map((p) =>
    p.slice(prefix.length + 1),
  );

  const diff = await diffSourcesAgainstMirror({
    git,
    bundleSlug: bundle.slug,
    defaultBranch: bundle.defaultBranch,
    sourcePages,
  });

  const dirtySources = [...diff.added, ...diff.changed];
  const nothingToDo =
    !diff.isFirstCompile && dirtySources.length === 0 && diff.deleted.length === 0;

  if (nothingToDo) {
    return {
      mrId: null,
      stats: {
        sourcePages: sourcePages.length,
        docsWritten: 0,
        docsDeleted: 0,
        changedFiles: 0,
        skippedUnchanged: diff.unchanged.length,
      },
    };
  }

  const linkedDocs = diff.isFirstCompile
    ? []
    : await listDocsLinkedToSources({
        git,
        bundleSlug: bundle.slug,
        defaultBranch: bundle.defaultBranch,
        sourcePaths: [...dirtySources.map((p) => p.path), ...diff.deleted],
      });

  const pending = new Map<string, string | null>();

  const agent = new Agent({
    id: "okf-indexer",
    name: "OKF Indexer",
    instructions: indexerInstructions(bundle),
    model: buildModel(settings, "indexer"),
    tools: createIndexerTools({ db, git, bundle, pending }),
  });

  await agent.generate(
    indexerKickoffPrompt({
      bundle,
      sourcePages,
      existingDocs,
      incremental: diff.isFirstCompile
        ? undefined
        : {
            added: diff.added,
            changed: diff.changed,
            deleted: diff.deleted,
            linkedDocs,
          },
    }),
    { maxSteps: MAX_AGENT_STEPS },
  );

  if (pending.size === 0) {
    throw new Error("The indexer agent finished without writing any documents");
  }

  if (!pending.get("index.md")) {
    if (!diff.isFirstCompile) {
      const existingIndex = await git.getFileAtRef(bundle.defaultBranch, `${prefix}/index.md`);
      if (existingIndex) {
        pending.set("index.md", decoder.decode(existingIndex));
      } else {
        throw new Error("The indexer agent did not produce a root index.md");
      }
    } else {
      throw new Error("The indexer agent did not produce a root index.md");
    }
  }
  if (!pending.has("log.md")) {
    pending.set("log.md", await synthesizeLogEntry(git, bundle, prefix, runId, diff));
  }

  applyResourceUrlsToPending(
    pending,
    bundle.slug,
    dirtySources.length > 0 ? dirtySources : sourcePages,
  );

  await git.ensureBranchOff(branch, bundle.defaultBranch);

  const files: FileWrite[] = [...pending].map(([docPath, content]) => ({
    path: okfDocGitPath(bundle.slug, docPath),
    content,
  }));

  const mirrorWrites = await buildSourceMirrorWrites({
    git,
    bundleSlug: bundle.slug,
    defaultBranch: bundle.defaultBranch,
    sourcePages,
    onlyPaths: diff.isFirstCompile ? undefined : new Set(dirtySources.map((p) => p.path)),
    deletedPaths: diff.deleted,
  });
  const pendingGitPaths = new Set(files.map((f) => f.path));
  for (const write of mirrorWrites) {
    pendingGitPaths.add(write.path);
    files.push(write);
  }

  // The agent branch may still tip at an unmerged prior compile. Overlay every
  // untouched OKF path from main so this commit is "main + this run's delta".
  const [branchFiles, mainFiles] = await Promise.all([
    git.listFilesAtRef(branch, prefix),
    git.listFilesAtRef(bundle.defaultBranch, prefix),
  ]);
  for (const gitPath of new Set([...branchFiles, ...mainFiles])) {
    if (pendingGitPaths.has(gitPath)) continue;
    const mainBytes = await git.getFileAtRef(bundle.defaultBranch, gitPath);
    files.push({ path: gitPath, content: mainBytes });
  }

  await git.writeAndCommit(branch, files, `Compile OKF knowledge base (run ${runId})`, {
    name: SYSTEM_INDEXER_DISPLAY_NAME,
    email: SYSTEM_INDEXER_EMAIL,
  });

  const docsWritten = [...pending].filter(([, c]) => c !== null).length;
  const docsDeleted = [...pending].filter(([, c]) => c === null).length;
  const stats = {
    sourcePages: sourcePages.length,
    docsWritten,
    docsDeleted,
    changedFiles: 0,
    skippedUnchanged: diff.unchanged.length,
  };

  const fileDiff = await git.diffRefs(bundle.defaultBranch, branch, prefix);
  stats.changedFiles = fileDiff.length;
  if (fileDiff.length === 0) {
    return { mrId: null, stats };
  }

  return finalizeMr({
    db,
    git,
    bundle,
    systemUserId: systemUser.id,
    branch,
    stats,
  });
}

const decoder = new TextDecoder();

async function finalizeMr(args: {
  db: Database;
  git: GitEngine;
  bundle: Bundle;
  systemUserId: string;
  branch: string;
  stats: RunOutcome["stats"];
}): Promise<RunOutcome> {
  const { db, git, bundle, systemUserId, branch, stats } = args;
  const [headCommit, baseCommit] = await Promise.all([
    git.getRefOid(branch),
    git.getRefOid(bundle.defaultBranch),
  ]);
  if (!headCommit || !baseCommit) {
    throw new Error("Could not resolve branch state after committing");
  }

  const openStatuses = ["draft", "open", "conflict"] as const;
  const existing = await db.query.mergeRequests.findFirst({
    where: and(
      eq(schema.mergeRequests.bundleId, bundle.id),
      eq(schema.mergeRequests.branchName, branch),
      inArray(schema.mergeRequests.status, [...openStatuses]),
    ),
    orderBy: desc(schema.mergeRequests.createdAt),
  });

  if (existing) {
    if (existing.status === "conflict") {
      await db.delete(schema.mrConflicts).where(eq(schema.mrConflicts.mrId, existing.id));
    }
    await db
      .update(schema.mergeRequests)
      .set({ status: "open", baseCommit, headCommit, updatedAt: new Date() })
      .where(eq(schema.mergeRequests.id, existing.id));
    return { mrId: existing.id, stats };
  }

  const [created] = await db
    .insert(schema.mergeRequests)
    .values({
      bundleId: bundle.id,
      authorId: systemUserId,
      branchName: branch,
      scope: "okf",
      status: "open",
      baseCommit,
      headCommit,
    })
    .returning();
  if (!created) throw new Error("Failed to create merge request");

  return { mrId: created.id, stats };
}

/** Fallback log.md when the agent forgot to write one — the log must never lose history. */
async function synthesizeLogEntry(
  git: GitEngine,
  bundle: Bundle,
  okfPrefix: string,
  runId: string,
  diff: {
    isFirstCompile: boolean;
    added: { path: string }[];
    changed: { path: string }[];
    deleted: string[];
  },
): Promise<string> {
  const date = new Date().toISOString().slice(0, 10);
  let detail = `Knowledge bundle recompiled by indexer run ${runId}.`;
  if (!diff.isFirstCompile) {
    const parts: string[] = [];
    if (diff.added.length) parts.push(`added ${diff.added.map((p) => p.path).join(", ")}`);
    if (diff.changed.length) parts.push(`updated ${diff.changed.map((p) => p.path).join(", ")}`);
    if (diff.deleted.length) parts.push(`removed ${diff.deleted.join(", ")}`);
    if (parts.length) detail = `Incremental compile (${parts.join("; ")}). Run ${runId}.`;
  }
  const entry = `## ${date}\n* **Update**: ${detail}\n`;

  const existingBytes = await git.getFileAtRef(bundle.defaultBranch, `${okfPrefix}/log.md`);
  if (!existingBytes) {
    return `# Update Log\n\n${entry}`;
  }

  const existing = decoder.decode(existingBytes);
  const lines = existing.split("\n");
  if (lines[0]?.startsWith("# ")) {
    return [lines[0], "", entry.trimEnd(), ...lines.slice(1)].join("\n");
  }
  return `${entry}\n${existing}`;
}
