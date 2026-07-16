import { type GitEngine } from "@kherad/core/git";
import { checkPermission } from "@kherad/core/permissions";
import { schema, type Database } from "@kherad/db";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { startIndexerRun } from "../agents/indexer/run";
import { loadAiSettings } from "../agents/settings";
import { getBundleOrNull } from "../lib/get-bundle";

function toRunResponse(
  run: typeof schema.indexerRuns.$inferSelect & {
    triggeredBy?: { displayName: string } | null;
  },
) {
  return {
    id: run.id,
    status: run.status,
    error: run.error,
    mrId: run.mrId,
    stats: run.stats,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    triggeredBy: run.triggeredBy ? { displayName: run.triggeredBy.displayName } : null,
  };
}

export async function indexerRoutes(server: FastifyInstance, db: Database, git: GitEngine) {
  // Kick off a compile. Requires "review" (manager/admin) — the same people
  // who can approve the MR the run produces.
  server.post<{ Params: { bundleId: string } }>(
    "/bundles/:bundleId/compile",
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }
      const allowed = await checkPermission(db, request.user, bundle, null, "review");
      if (!allowed) {
        return reply.code(403).send({ error: "Forbidden" });
      }
      if (bundle.mode !== "llm_compiled") {
        return reply.code(409).send({ error: "Bundle is not in LLM-compiled mode" });
      }

      const settings = await loadAiSettings(db);
      if (!settings) {
        return reply
          .code(503)
          .send({ error: "AI settings are not configured — ask an admin to set them up" });
      }

      const result = await startIndexerRun({
        db,
        git,
        bundle,
        settings,
        triggeredById: request.user!.id,
        log: server.log,
      });
      if (!result.ok) {
        return reply.code(409).send({ error: "A compile run is already in progress" });
      }

      reply.code(202);
      return { runId: result.runId };
    },
  );

  server.get<{ Params: { bundleId: string }; Querystring: { limit?: string } }>(
    "/bundles/:bundleId/compile/runs",
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }
      const allowed = await checkPermission(db, request.user, bundle, null, "review");
      if (!allowed) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const limit = Math.min(Number(request.query.limit) || 10, 50);
      const runs = await db.query.indexerRuns.findMany({
        where: eq(schema.indexerRuns.bundleId, bundle.id),
        orderBy: desc(schema.indexerRuns.startedAt),
        limit,
        with: { triggeredBy: { columns: { displayName: true } } },
      });
      return runs.map(toRunResponse);
    },
  );

  server.get<{ Params: { bundleId: string; runId: string } }>(
    "/bundles/:bundleId/compile/runs/:runId",
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }
      const allowed = await checkPermission(db, request.user, bundle, null, "review");
      if (!allowed) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const run = await db.query.indexerRuns.findFirst({
        where: and(
          eq(schema.indexerRuns.id, request.params.runId),
          eq(schema.indexerRuns.bundleId, bundle.id),
        ),
        with: { triggeredBy: { columns: { displayName: true } } },
      });
      if (!run) {
        return reply.code(404).send({ error: "Run not found" });
      }
      return toRunResponse(run);
    },
  );
}
