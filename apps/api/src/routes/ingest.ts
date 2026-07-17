import { resolvePagePath, type GitEngine } from "@kherad/core/git";
import { checkPermission } from "@kherad/core/permissions";
import { schema, type Database } from "@kherad/db";
import { generateText } from "ai";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { loadOcrSettings } from "../agents/ocr-settings";
import { buildModel, loadAiSettings } from "../agents/settings";
import { loadSttSettings } from "../agents/stt-settings";
import { getBundleOrNull } from "../lib/get-bundle";
import { allocatePagePath, upsertRawPage } from "../lib/page-alloc";
import { rewriteEmbeddedImages } from "../lib/ingest-images";
import {
  createIngestJob,
  getIngestJob,
  updateIngestJobMarkdown,
  type IngestPageImage,
} from "../lib/ingest-jobs";
import { pageGitPath } from "../lib/wiki-paths";
import { requireAuth } from "../plugins/auth";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const OCR_PAGES_PER_BATCH = 4;

const AUDIO_MIME_PREFIXES = ["audio/", "video/webm", "video/mp4"];
const AUDIO_EXTENSIONS = new Set([
  "mp3",
  "wav",
  "m4a",
  "ogg",
  "oga",
  "opus",
  "flac",
  "webm",
  "aac",
  "mp4",
  "mpeg",
  "mpga",
]);

function isAudioUpload(filename: string, mimetype: string): boolean {
  const mime = mimetype.toLowerCase();
  if (AUDIO_MIME_PREFIXES.some((p) => mime.startsWith(p) || mime === p)) return true;
  const ext = filename.includes(".") ? filename.split(".").pop()?.toLowerCase() : "";
  return Boolean(ext && AUDIO_EXTENSIONS.has(ext));
}

function titleFromFilename(filename: string): string {
  return (
    filename
      .replace(/\.[^.]+$/, "")
      .replace(/[_-]+/g, " ")
      .trim() || "Voice note"
  );
}

function transcriptToMarkdown(title: string, text: string): string {
  const body = text.trim();
  return `# ${title}\n\n${body}\n`;
}

async function callSttTranscription(
  settings: { baseUrl: string; apiKey: string; model: string },
  file: { buffer: Buffer; filename: string; mimetype: string },
): Promise<string> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(file.buffer)], {
      type: file.mimetype || "application/octet-stream",
    }),
    file.filename,
  );
  form.append("model", settings.model);
  form.append("response_format", "json");

  const url = `${settings.baseUrl}/audio/transcriptions`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${settings.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`STT endpoint returned ${res.status}: ${body.slice(0, 400)}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = (await res.json()) as { text?: string };
    if (typeof json.text === "string" && json.text.trim()) return json.text.trim();
    throw new Error("STT response missing text");
  }

  const text = (await res.text()).trim();
  if (!text) throw new Error("STT response was empty");
  return text;
}

async function callOcrBatch(
  settings: { baseUrl: string; apiKey: string; model: string },
  pages: IngestPageImage[],
): Promise<string> {
  const content: Array<
    { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
  > = [
    {
      type: "text",
      text: "Transcribe these document page images into clean GitHub-flavored markdown. Preserve headings, lists, tables, and code when visible. Do not wrap the whole response in a code fence. Output only the markdown.",
    },
  ];
  for (const page of pages) {
    content.push({
      type: "text",
      text: `--- Page ${page.page} ---`,
    });
    content.push({
      type: "image_url",
      image_url: { url: `data:${page.mime};base64,${page.base64}` },
    });
  }

  const url = `${settings.baseUrl}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: settings.model,
      messages: [
        {
          role: "system",
          content:
            "You are a document OCR assistant. Convert page images to accurate, well-structured markdown.",
        },
        { role: "user", content },
      ],
      temperature: 0.1,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OCR endpoint returned ${res.status}: ${body.slice(0, 400)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
  };
  const message = json.choices?.[0]?.message?.content;
  if (typeof message === "string") return message.trim();
  if (Array.isArray(message)) {
    return message
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }
  throw new Error("OCR response missing message content");
}

export async function ingestRoutes(server: FastifyInstance, db: Database, git: GitEngine) {
  // @fastify/multipart is registered once in index.ts.

  server.post<{ Params: { bundleId: string } }>(
    "/bundles/:bundleId/ingest/convert",
    { preHandler: requireAuth() },
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) return reply.code(404).send({ error: "Bundle not found" });

      const allowed = await checkPermission(db, request.user, bundle, null, "edit");
      if (!allowed) return reply.code(403).send({ error: "Forbidden" });

      const ingestUrl = process.env.INGEST_SERVICE_URL?.replace(/\/+$/, "");
      if (!ingestUrl) {
        return reply
          .code(503)
          .send({ error: "Ingest service is not configured (INGEST_SERVICE_URL)" });
      }

      const file = await request.file();
      if (!file) return reply.code(400).send({ error: "file is required" });

      const buffer = await file.toBuffer();
      if (buffer.byteLength === 0) return reply.code(400).send({ error: "Empty file" });
      if (buffer.byteLength > MAX_UPLOAD_BYTES) {
        return reply.code(413).send({ error: "File too large (max 25 MB)" });
      }

      const form = new FormData();
      form.append(
        "file",
        new Blob([new Uint8Array(buffer)], {
          type: file.mimetype || "application/octet-stream",
        }),
        file.filename || "document.bin",
      );

      let upstream: Response;
      try {
        upstream = await fetch(`${ingestUrl}/convert`, {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(5 * 60 * 1000),
        });
      } catch (err) {
        request.log.error({ err }, "ingest convert upstream failed");
        return reply.code(502).send({ error: "Ingest service unreachable" });
      }

      if (!upstream.ok) {
        const detail = await upstream.text().catch(() => "");
        return reply
          .code(upstream.status === 413 || upstream.status === 422 ? upstream.status : 502)
          .send({
            error: detail.slice(0, 500) || `Ingest service error (${upstream.status})`,
          });
      }

      const payload = (await upstream.json()) as {
        markdown: string;
        pageImages: IngestPageImage[];
        titleHint: string;
        format: string;
        filename: string;
      };

      const job = createIngestJob({
        bundleId: bundle.id,
        userId: request.user!.id,
        markdown: payload.markdown ?? "",
        pageImages: Array.isArray(payload.pageImages) ? payload.pageImages : [],
        titleHint: payload.titleHint ?? "Untitled",
        format: payload.format ?? "unknown",
        filename: payload.filename ?? file.filename ?? "document",
      });

      return {
        jobId: job.id,
        markdown: job.markdown,
        pageImages: job.pageImages,
        titleHint: job.titleHint,
        format: job.format,
        filename: job.filename,
      };
    },
  );

  server.post<{ Params: { bundleId: string } }>(
    "/bundles/:bundleId/ingest/transcribe",
    { preHandler: requireAuth() },
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) return reply.code(404).send({ error: "Bundle not found" });

      const allowed = await checkPermission(db, request.user, bundle, null, "edit");
      if (!allowed) return reply.code(403).send({ error: "Forbidden" });

      const settings = await loadSttSettings(db);
      if (!settings) {
        return reply
          .code(503)
          .send({ error: "Speech-to-text is not configured. Ask an admin to set STT settings." });
      }

      const file = await request.file();
      if (!file) return reply.code(400).send({ error: "file is required" });

      const filename = file.filename || "audio.mp3";
      const mimetype = file.mimetype || "application/octet-stream";
      if (!isAudioUpload(filename, mimetype)) {
        return reply.code(400).send({
          error: "Unsupported audio type. Use mp3, wav, m4a, ogg, flac, webm, or aac.",
        });
      }

      const buffer = await file.toBuffer();
      if (buffer.byteLength === 0) return reply.code(400).send({ error: "Empty file" });
      if (buffer.byteLength > MAX_UPLOAD_BYTES) {
        return reply.code(413).send({ error: "File too large (max 25 MB)" });
      }

      const titleHint = titleFromFilename(filename);
      try {
        const text = await callSttTranscription(settings, {
          buffer,
          filename,
          mimetype,
        });
        const markdown = transcriptToMarkdown(titleHint, text);
        const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "audio";
        const job = createIngestJob({
          bundleId: bundle.id,
          userId: request.user!.id,
          markdown,
          pageImages: [],
          titleHint,
          format: ext,
          filename,
        });
        return {
          jobId: job.id,
          markdown: job.markdown,
          pageImages: [],
          titleHint: job.titleHint,
          format: job.format,
          filename: job.filename,
          kind: "audio" as const,
        };
      } catch (err) {
        request.log.error({ err }, "STT transcription failed");
        return reply.code(502).send({
          error: err instanceof Error ? err.message : "Transcription failed",
        });
      }
    },
  );

  server.post<{
    Params: { bundleId: string };
    Body: { jobId: string };
  }>("/bundles/:bundleId/ingest/ocr", { preHandler: requireAuth() }, async (request, reply) => {
    const bundle = await getBundleOrNull(db, request.params.bundleId);
    if (!bundle) return reply.code(404).send({ error: "Bundle not found" });

    const allowed = await checkPermission(db, request.user, bundle, null, "edit");
    if (!allowed) return reply.code(403).send({ error: "Forbidden" });

    const jobId = request.body?.jobId;
    if (!jobId) return reply.code(400).send({ error: "jobId is required" });

    const job = getIngestJob(jobId);
    if (!job || job.bundleId !== bundle.id || job.userId !== request.user!.id) {
      return reply.code(404).send({ error: "Ingest job not found or expired" });
    }
    if (job.pageImages.length === 0) {
      return reply.code(400).send({
        error: "No page images available for OCR (library conversion markdown is still available)",
      });
    }

    const settings = await loadOcrSettings(db);
    if (!settings) {
      return reply
        .code(503)
        .send({ error: "OCR is not configured. Ask an admin to set OCR settings." });
    }

    try {
      const parts: string[] = [];
      for (let i = 0; i < job.pageImages.length; i += OCR_PAGES_PER_BATCH) {
        const batch = job.pageImages.slice(i, i + OCR_PAGES_PER_BATCH);
        parts.push(await callOcrBatch(settings, batch));
      }
      const markdown = parts.filter(Boolean).join("\n\n");
      updateIngestJobMarkdown(job.id, markdown);
      return { jobId: job.id, markdown };
    } catch (err) {
      request.log.error({ err }, "OCR failed");
      return reply.code(502).send({
        error: err instanceof Error ? err.message : "OCR failed",
      });
    }
  });

  server.post<{
    Params: { bundleId: string };
    Body: { markdown: string; filename?: string };
  }>(
    "/bundles/:bundleId/ingest/suggest-placement",
    { preHandler: requireAuth() },
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) return reply.code(404).send({ error: "Bundle not found" });

      const allowed = await checkPermission(db, request.user, bundle, null, "edit");
      if (!allowed) return reply.code(403).send({ error: "Forbidden" });

      if (bundle.mode !== "llm_compiled") {
        return reply.code(400).send({
          error: "AI placement suggestions are only available for AI-compiled bundles",
        });
      }

      const markdown = request.body?.markdown?.trim() ?? "";
      if (!markdown) return reply.code(400).send({ error: "markdown is required" });

      const settings = await loadAiSettings(db);
      if (!settings) {
        return reply.code(503).send({ error: "AI is not configured" });
      }

      const existing = await db.query.pages.findMany({
        where: and(
          eq(schema.pages.bundleId, bundle.id),
          eq(schema.pages.source, "raw"),
          eq(schema.pages.isDeleted, false),
        ),
        columns: { path: true, title: true },
        orderBy: (p, { asc }) => asc(p.path),
        limit: 80,
      });

      const excerpt = markdown.slice(0, 6000);
      const existingList =
        existing.length === 0
          ? "(none yet)"
          : existing.map((p) => `- ${p.path} — ${p.title}`).join("\n");

      const model = buildModel(settings, "chat");
      const prompt = `You place a newly ingested source document into a wiki bundle's source tree.

Bundle: ${bundle.title} (slug: ${bundle.slug})
Filename hint: ${request.body?.filename ?? "unknown"}

Existing source pages:
${existingList}

Document excerpt:
---
${excerpt}
---

Suggest a short human title and a URL-safe path (lowercase, hyphens, optional folders with /). Path must not collide with existing pages. Respond with JSON only: {"title":"...","path":"..."}`;

      try {
        const { text } = await generateText({ model, prompt });
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          return reply.code(502).send({ error: "AI returned no placement JSON" });
        }
        const parsed = z
          .object({
            title: z.string().min(1),
            path: z.string().min(1),
          })
          .safeParse(JSON.parse(jsonMatch[0]!));
        if (!parsed.success) {
          return reply.code(502).send({ error: "AI placement JSON was invalid" });
        }

        const basePath = resolvePagePath({ path: parsed.data.path, title: parsed.data.title });
        if (basePath === null) {
          return reply.code(502).send({ error: "AI suggested an invalid path" });
        }
        const path = await allocatePagePath(db, bundle.id, basePath);
        return { title: parsed.data.title.trim(), path };
      } catch (err) {
        request.log.error({ err }, "suggest-placement failed");
        return reply.code(502).send({
          error: err instanceof Error ? err.message : "Failed to suggest placement",
        });
      }
    },
  );

  server.post<{
    Params: { bundleId: string };
    Body: { title: string; path: string; markdown: string; jobId?: string };
  }>("/bundles/:bundleId/ingest/commit", { preHandler: requireAuth() }, async (request, reply) => {
    const bundle = await getBundleOrNull(db, request.params.bundleId);
    if (!bundle) return reply.code(404).send({ error: "Bundle not found" });

    const { title, markdown = "" } = request.body ?? {};
    if (!title?.trim()) return reply.code(400).send({ error: "Title is required" });
    if (typeof markdown !== "string") {
      return reply.code(400).send({ error: "markdown is required" });
    }

    const basePath = resolvePagePath({ path: request.body.path, title });
    if (basePath === null) return reply.code(400).send({ error: "Invalid path" });
    const path = await allocatePagePath(db, bundle.id, basePath);

    const allowed = await checkPermission(db, request.user, bundle, path, "edit");
    if (!allowed) return reply.code(403).send({ error: "Forbidden" });
    const user = request.user!;

    const branch = await git.createUserBranch(user.id);
    const author = { name: user.displayName, email: user.email };
    let content = markdown;
    try {
      content = await rewriteEmbeddedImages(git, {
        bundleSlug: bundle.slug,
        branch,
        markdown,
        author,
      });
    } catch (err) {
      request.log.error({ err }, "ingest image rewrite failed");
      return reply.code(500).send({ error: "Failed to upload embedded images" });
    }

    await git.writeAndCommit(
      branch,
      [{ path: pageGitPath(bundle.slug, path), content }],
      `Ingest document: ${path}`,
      author,
    );

    const page = await upsertRawPage(db, bundle.id, path, title.trim());

    // Drop job from memory if provided (best-effort).
    if (request.body.jobId) {
      const job = getIngestJob(request.body.jobId);
      if (job && job.userId === user.id) {
        updateIngestJobMarkdown(job.id, content);
      }
    }

    reply.code(201);
    return page;
  });
}
