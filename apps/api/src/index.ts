import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { createGitEngine } from "@kherad/core/git";
import { createDb } from "@kherad/db";
import Fastify from "fastify";

import { registerAuth } from "./plugins/auth";
import { adminRoutes } from "./routes/admin";
import { aiSettingsRoutes } from "./routes/ai-settings";
import { assetRoutes } from "./routes/assets";
import { authRoutes } from "./routes/auth";
import { graphRoutes } from "./routes/graph";
import { documentRemoteRoutes } from "./routes/document-remote";
import { bundleRemoteRoutes } from "./routes/bundle-remote";
import { bundleRoutes } from "./routes/bundles";
import { chatRoutes } from "./routes/chat";
import { indexerRoutes } from "./routes/indexer";
import { ingestRoutes } from "./routes/ingest";
import { agentSessionRoutes } from "./routes/agent-sessions";
import { mergeRequestRoutes } from "./routes/merge-requests";
import { notificationRoutes } from "./routes/notifications";
import { ocrSettingsRoutes } from "./routes/ocr-settings";
import { embeddingSettingsRoutes } from "./routes/embedding-settings";
import { okfDocRoutes } from "./routes/okf-docs";
import { pageRoutes } from "./routes/pages";
import { permissionRoutes } from "./routes/permissions";
import { presenceRoutes } from "./routes/presence";
import { searchRoutes } from "./routes/search";
import { skillsRoutes } from "./routes/skills";
import { sttSettingsRoutes } from "./routes/stt-settings";
import { wikiVersionRoutes } from "./routes/wiki-versions";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const gitRepoPath = process.env.GIT_REPO_PATH;
if (!gitRepoPath) {
  throw new Error("GIT_REPO_PATH is not set");
}

const db = createDb(connectionString);
const git = createGitEngine(gitRepoPath);
await git.initRepo();

const server = Fastify({
  logger: true,
});

await server.register(cors, {
  origin: process.env.WEB_ORIGIN?.split(",") ?? ["http://localhost:3000"],
  // @fastify/cors only allows GET/HEAD/POST by default, which breaks the
  // PUT/PATCH/DELETE routes (page save, rename, delete) from the browser.
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  // Lets the chat client read the thread id assigned on the first message.
  exposedHeaders: ["x-chat-thread-id"],
});

// Shared by ingest + interviewer uploads (ingest allows up to 25 MB).
await server.register(multipart, {
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});

registerAuth(server, db);

server.get("/health", async () => {
  return { status: "ok" };
});

await authRoutes(server, db);
await adminRoutes(server, db);
await aiSettingsRoutes(server, db);
await ocrSettingsRoutes(server, db);
await sttSettingsRoutes(server, db);
await embeddingSettingsRoutes(server, db, git);
await bundleRoutes(server, db);
await bundleRemoteRoutes(server, db, git);
await documentRemoteRoutes(server, db, git);
await wikiVersionRoutes(server, db, git);
await pageRoutes(server, db, git);
await okfDocRoutes(server, db, git);
await ingestRoutes(server, db, git);
await assetRoutes(server, db, git);
await graphRoutes(server, db, git);
await permissionRoutes(server, db);
await presenceRoutes(server, db);
await mergeRequestRoutes(server, db, git);
await notificationRoutes(server, db);
await searchRoutes(server, db);
await indexerRoutes(server, db, git);
await chatRoutes(server, db, git);
await agentSessionRoutes(server, db, git);
await skillsRoutes(server, db);

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

server.listen({ port, host }).catch((err) => {
  server.log.error(err);
  process.exit(1);
});
