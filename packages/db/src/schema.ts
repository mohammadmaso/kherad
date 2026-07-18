import { relations } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

/** Untyped pgvector column — dimension varies with the admin-configured embedding model. */
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: unknown): number[] {
    if (typeof value === "string") {
      const inner = value.startsWith("[") ? value.slice(1, -1) : value;
      return inner.split(",").map(Number);
    }
    if (Array.isArray(value)) return value as number[];
    return [];
  },
});

export const permissionRoleEnum = pgEnum("permission_role", ["manager", "author", "viewer"]);
export const mergeRequestStatusEnum = pgEnum("merge_request_status", [
  "draft",
  "open",
  "conflict",
  "merged",
  "rejected",
]);
export const reviewDecisionEnum = pgEnum("review_decision", ["pending", "approved", "rejected"]);
// Extend as more event types start notifying users; keep each type's `body`
// self-contained (plain text) rather than templating client-side, so old
// notifications keep reading sensibly even if the UI copy changes later.
export const notificationTypeEnum = pgEnum("notification_type", ["mr_submitted"]);
// "raw": plain human-authored wiki. "llm_compiled": the indexer agent also
// maintains an OKF knowledge bundle under `okf/<slug>` and the Q&A chat is enabled.
export const bundleModeEnum = pgEnum("bundle_mode", ["raw", "llm_compiled"]);
// Which git subtree an MR touches: `wiki/<slug>` (human edits) or `okf/<slug>`
// (indexer-agent output). Drives the diff/merge path prefix.
export const mrScopeEnum = pgEnum("mr_scope", ["wiki", "okf"]);
// Which git subtree a `pages` row is sourced from — mirrors `mrScopeEnum`.
// "raw" pages are author-edited (`raw/<slug>`, own `page-edit` flow); "okf"
// rows are synced read-only from the indexer agent's compiled tree so they
// can join the same `search_index` pipeline (refresh.ts). Needed alongside
// `path` in the uniqueness constraint since an OKF site path (e.g.
// `concepts/foo`) may coincidentally collide with an author-chosen raw path.
export const pageSourceEnum = pgEnum("page_source", ["raw", "okf"]);
export const aiProviderEnum = pgEnum("ai_provider", ["anthropic", "openai_compatible"]);
export const indexerRunStatusEnum = pgEnum("indexer_run_status", [
  "running",
  "succeeded",
  "failed",
]);
export const agentSessionStatusEnum = pgEnum("agent_session_status", [
  "active",
  "draft_ready",
  "imported",
  "archived",
]);
/** create = brand-new page draft; edit = section edits on an existing page. */
export const agentSessionModeEnum = pgEnum("agent_session_mode", ["create", "edit"]);
export const agentSectionEditStatusEnum = pgEnum("agent_section_edit_status", [
  "proposed",
  "accepted",
  "rejected",
  "superseded",
]);
// How eagerly the specialist agent asks clarifying questions before drafting.
export const agentAggressivenessEnum = pgEnum("agent_aggressiveness", [
  "relaxed",
  "balanced",
  "aggressive",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    isAdmin: boolean("is_admin").notNull().default(false),
    // Machine accounts (e.g. the OKF indexer agent that authors compile MRs).
    // System users can never log in — `login()` rejects them regardless of password.
    isSystem: boolean("is_system").notNull().default(false),
    // UI language preference ("en" | "fa") — drives translations and RTL layout in apps/web.
    locale: text("locale").notNull().default("en"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_email_idx").on(table.email)],
);

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bundles = pgTable(
  "bundles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    isPublic: boolean("is_public").notNull().default(false),
    mode: bundleModeEnum("mode").notNull().default("raw"),
    defaultBranch: text("default_branch").notNull().default("main"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("bundles_slug_idx").on(table.slug)],
);

export const permissions = pgTable(
  "permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bundleId: uuid("bundle_id")
      .notNull()
      .references(() => bundles.id, { onDelete: "cascade" }),
    pathPrefix: text("path_prefix"),
    role: permissionRoleEnum("role").notNull(),
  },
  (table) => [index("permissions_user_bundle_idx").on(table.userId, table.bundleId)],
);

export const pages = pgTable(
  "pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bundleId: uuid("bundle_id")
      .notNull()
      .references(() => bundles.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    title: text("title").notNull(),
    isDeleted: boolean("is_deleted").notNull().default(false),
    redirectTo: text("redirect_to"),
    // "raw" (default) for author-edited pages; "okf" for rows synced from a
    // bundle's compiled knowledge base purely so those docs are searchable.
    source: pageSourceEnum("source").notNull().default("raw"),
  },
  (table) => [uniqueIndex("pages_bundle_source_path_idx").on(table.bundleId, table.source, table.path)],
);

export const autosaveDrafts = pgTable(
  "autosave_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    contentJson: jsonb("content_json").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("autosave_drafts_user_page_idx").on(table.userId, table.pageId)],
);

export const activeEditSessions = pgTable(
  "active_edit_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("active_edit_sessions_user_page_idx").on(table.userId, table.pageId)],
);

export const mergeRequests = pgTable("merge_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  bundleId: uuid("bundle_id")
    .notNull()
    .references(() => bundles.id, { onDelete: "cascade" }),
  authorId: uuid("author_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  branchName: text("branch_name").notNull(),
  scope: mrScopeEnum("scope").notNull().default("wiki"),
  status: mergeRequestStatusEnum("status").notNull().default("draft"),
  baseCommit: text("base_commit").notNull(),
  headCommit: text("head_commit").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Bumped on every status transition (submit/approve/reject/resolve) so the
  // admin audit view can show "most recently merged" rather than "first opened".
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const mrComments = pgTable("mr_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  mrId: uuid("mr_id")
    .notNull()
    .references(() => mergeRequests.id, { onDelete: "cascade" }),
  authorId: uuid("author_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  path: text("path"),
  line: integer("line"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const mrReviewers = pgTable(
  "mr_reviewers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mrId: uuid("mr_id")
      .notNull()
      .references(() => mergeRequests.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    decision: reviewDecisionEnum("decision").notNull().default("pending"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("mr_reviewers_mr_user_idx").on(table.mrId, table.userId)],
);

/**
 * Raw conflict-marker text per path, populated when an approve attempt hits
 * `MergeConflictDetectedError` (PRD §3) and cleared once the manager resolves
 * it. Only ever read/written by the manager-only conflict resolution screen.
 */
export const mrConflicts = pgTable(
  "mr_conflicts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mrId: uuid("mr_id")
      .notNull()
      .references(() => mergeRequests.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    markerText: text("marker_text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("mr_conflicts_mr_path_idx").on(table.mrId, table.path)],
);

/**
 * In-app notifications (no email/external delivery). `mrId` is nullable so a
 * notification survives independently of its `onDelete: "cascade"` neighbor
 * conventions elsewhere — deleting the MR would otherwise silently wipe the
 * user's notification history for it; instead the FK cascades to null.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    bundleId: uuid("bundle_id")
      .notNull()
      .references(() => bundles.id, { onDelete: "cascade" }),
    mrId: uuid("mr_id").references(() => mergeRequests.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("notifications_user_created_idx").on(table.userId, table.createdAt)],
);

export const searchIndex = pgTable(
  "search_index",
  {
    pageId: uuid("page_id")
      .primaryKey()
      .references(() => pages.id, { onDelete: "cascade" }),
    tsv: tsvector("tsv"),
    /** Plain-text projection for ts_headline snippets; capped ~50k chars at write time. */
    content: text("content"),
    /** Frontmatter projection for OKF docs; null for raw pages. */
    metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
  },
  (table) => [
    index("search_index_tsv_idx").using("gin", table.tsv),
    index("search_index_metadata_idx").using("gin", table.metadata),
  ],
);

/**
 * Per-page embedding chunks for semantic search. Untyped `vector` column
 * because the embedding model (and thus dimension) is admin-configurable;
 * filter by `model` at query time and use exact `<=>` scans.
 */
export const pageEmbeddingChunks = pgTable(
  "page_embedding_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding").notNull(),
    model: text("model").notNull(),
    dim: integer("dim").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("page_embedding_chunks_page_chunk_idx").on(table.pageId, table.chunkIndex),
    index("page_embedding_chunks_page_id_idx").on(table.pageId),
  ],
);

/**
 * Singleton row (id = "default") for the OpenAI-compatible embedding endpoint
 * used by semantic/hybrid search. `apiKeyEnc` is AES-256-GCM ciphertext
 * (same `GIT_REMOTE_SECRET_KEY` box as OCR/STT).
 */
export const embeddingSettings = pgTable("embedding_settings", {
  id: text("id").primaryKey().default("default"),
  baseUrl: text("base_url"),
  apiKeyEnc: text("api_key_enc"),
  model: text("model").notNull().default("text-embedding-3-small"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Singleton row (id = "default") holding the LLM provider configuration used
 * by both the OKF indexer agent and the Q&A chat agent. The API key is stored
 * as AES-256-GCM ciphertext (same `GIT_REMOTE_SECRET_KEY` box as
 * `document_remote_settings.tokenEnc`) and is never returned to clients.
 */
export const aiSettings = pgTable("ai_settings", {
  id: text("id").primaryKey().default("default"),
  provider: aiProviderEnum("provider").notNull().default("anthropic"),
  baseUrl: text("base_url"),
  apiKeyEnc: text("api_key_enc"),
  indexerModel: text("indexer_model").notNull().default("claude-opus-4-8"),
  chatModel: text("chat_model").notNull().default("claude-sonnet-5"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Singleton row (id = "default") for dedicated VLM OCR used by document ingest.
 * OpenAI-compatible vision endpoint only — separate from chat/indexer AI settings.
 * `apiKeyEnc` is AES-256-GCM ciphertext (same `GIT_REMOTE_SECRET_KEY` box).
 */
export const ocrSettings = pgTable("ocr_settings", {
  id: text("id").primaryKey().default("default"),
  baseUrl: text("base_url"),
  apiKeyEnc: text("api_key_enc"),
  model: text("model").notNull().default("gpt-4o"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Singleton row (id = "default") for dedicated speech-to-text used by voice ingest.
 * OpenAI-compatible `/audio/transcriptions` endpoint — separate from OCR / chat AI.
 * `apiKeyEnc` is AES-256-GCM ciphertext (same `GIT_REMOTE_SECRET_KEY` box).
 */
export const sttSettings = pgTable("stt_settings", {
  id: text("id").primaryKey().default("default"),
  baseUrl: text("base_url"),
  apiKeyEnc: text("api_key_enc"),
  model: text("model").notNull().default("whisper-1"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Singleton row (id = "default") for the global document remote: all compiled
 * OKF documents (`okf/<slug>/…`) are mirrored to one external git repository.
 * Raw source pages (`raw/`, legacy `wiki/`) are never pushed.
 */
export const documentRemoteSettings = pgTable("document_remote_settings", {
  id: text("id").primaryKey().default("default"),
  url: text("url"),
  branch: text("branch"),
  tokenEnc: text("token_enc"),
  lastPushedAt: timestamp("last_pushed_at", { withTimezone: true }),
  lastPushedOid: text("last_pushed_oid"),
  lastPulledAt: timestamp("last_pulled_at", { withTimezone: true }),
  lastPulledOid: text("last_pulled_oid"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * At most one row per bundle: an external git repository the bundle's source
 * pages (`raw/<slug>`, legacy `wiki/<slug>`) can be pushed to and pulled from.
 * Push force-updates the remote branch with a regenerated subtree mirror;
 * pull replaces the local subtree with the remote tree (admin-only, bypasses
 * MR review). `tokenEnc` is nullable so public repos can be pulled anonymously.
 */
export const bundleRemoteSettings = pgTable(
  "bundle_remote_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bundleId: uuid("bundle_id")
      .notNull()
      .references(() => bundles.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    branch: text("branch").notNull().default("main"),
    tokenEnc: text("token_enc"),
    lastPushedAt: timestamp("last_pushed_at", { withTimezone: true }),
    lastPushedOid: text("last_pushed_oid"),
    lastPulledAt: timestamp("last_pulled_at", { withTimezone: true }),
    lastPulledOid: text("last_pulled_oid"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("bundle_remote_settings_bundle_idx").on(table.bundleId)],
);

/**
 * One row per indexer-agent compile run (fire-and-forget background task).
 * The run row is the failure-reporting surface: the web UI polls it.
 */
export const indexerRuns = pgTable(
  "indexer_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bundleId: uuid("bundle_id")
      .notNull()
      .references(() => bundles.id, { onDelete: "cascade" }),
    triggeredById: uuid("triggered_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: indexerRunStatusEnum("status").notNull().default("running"),
    error: text("error"),
    // Null when the run succeeded but produced no changes (no MR opened).
    mrId: uuid("mr_id").references(() => mergeRequests.id, { onDelete: "set null" }),
    stats: jsonb("stats"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [index("indexer_runs_bundle_idx").on(table.bundleId, table.startedAt)],
);

export const chatThreads = pgTable(
  "chat_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bundleId: uuid("bundle_id")
      .notNull()
      .references(() => bundles.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("chat_threads_bundle_user_idx").on(table.bundleId, table.userId, table.updatedAt)],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => chatThreads.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    // AI SDK UIMessage.parts stored verbatim so history replays losslessly into useChat.
    parts: jsonb("parts").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("chat_messages_thread_idx").on(table.threadId, table.createdAt)],
);

/**
 * Cross-bundle specialist agent workspace. A session is not tied to a single
 * bundle until the manager picks one for wiki context / import. `role` is
 * optional free text — an empty role makes the agent behave as a generalist
 * interviewer (goal-driven, no persona).
 */
export const agentSessions = pgTable(
  "agent_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    goal: text("goal"),
    /** Company role the agent acts as (e.g. "Product manager"); null = generalist interviewer. */
    role: text("role"),
    /** How eagerly the agent asks clarifying questions before drafting. */
    aggressiveness: agentAggressivenessEnum("aggressiveness").notNull().default("balanced"),
    bundleId: uuid("bundle_id").references(() => bundles.id, { onDelete: "set null" }),
    draftMarkdown: text("draft_markdown"),
    status: agentSessionStatusEnum("status").notNull().default("active"),
    mode: agentSessionModeEnum("mode").notNull().default("create"),
    /** Target page for edit-mode sessions (null in create mode). */
    targetPageId: uuid("target_page_id").references(() => pages.id, { onDelete: "set null" }),
    /** Git ref the snapshot was taken from (user branch or bundle default). */
    targetBranch: text("target_branch"),
    /** Immutable body markdown at session start (edit mode). */
    targetSnapshotMarkdown: text("target_snapshot_markdown"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("agent_sessions_user_idx").on(table.userId, table.updatedAt)],
);

/**
 * Per-section edit proposals for edit-mode agent sessions. HTML is rendered
 * server-side at proposal time so the client never runs the markdown pipeline.
 */
export const agentSectionEdits = pgTable(
  "agent_section_edits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    sectionId: text("section_id").notNull(),
    headingText: text("heading_text").notNull(),
    headingLevel: integer("heading_level").notNull(),
    orderIndex: integer("order_index").notNull(),
    baseMarkdown: text("base_markdown").notNull(),
    proposedMarkdown: text("proposed_markdown").notNull(),
    baseHtml: text("base_html").notNull(),
    proposedHtml: text("proposed_html").notNull(),
    status: agentSectionEditStatusEnum("status").notNull().default("proposed"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (table) => [
    index("agent_section_edits_session_idx").on(
      table.sessionId,
      table.sectionId,
      table.createdAt,
    ),
  ],
);

export const agentMessages = pgTable(
  "agent_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    parts: jsonb("parts").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("agent_messages_session_idx").on(table.sessionId, table.createdAt)],
);

export const agentUploads = pgTable(
  "agent_uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull().default("text/plain"),
    byteSize: integer("byte_size").notNull(),
    textContent: text("text_content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("agent_uploads_session_idx").on(table.sessionId, table.createdAt)],
);

/**
 * Admin-managed library of markdown "skills" appended to the specialist
 * agent's instructions. `skillRoleDefaults` tags which preset company roles
 * (see the web-side role catalog) a skill is pre-selected for by default;
 * `agentSessionSkills` records what a given session actually has attached,
 * regardless of role defaults.
 */
export const skills = pgTable("skills", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  content: text("content").notNull(),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const skillRoleDefaults = pgTable(
  "skill_role_defaults",
  {
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    // Matches a key in the web-side preset role catalog, e.g. "product_manager".
    roleKey: text("role_key").notNull(),
  },
  (table) => [primaryKey({ columns: [table.skillId, table.roleKey] })],
);

export const agentSessionSkills = pgTable(
  "agent_session_skills",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.skillId] })],
);

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  permissions: many(permissions),
  mergeRequests: many(mergeRequests),
  mrComments: many(mrComments),
  mrReviewers: many(mrReviewers),
  autosaveDrafts: many(autosaveDrafts),
  activeEditSessions: many(activeEditSessions),
  chatThreads: many(chatThreads),
  indexerRuns: many(indexerRuns),
  agentSessions: many(agentSessions),
  notifications: many(notifications),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const bundlesRelations = relations(bundles, ({ one, many }) => ({
  pages: many(pages),
  permissions: many(permissions),
  mergeRequests: many(mergeRequests),
  chatThreads: many(chatThreads),
  indexerRuns: many(indexerRuns),
  agentSessions: many(agentSessions),
  notifications: many(notifications),
  remoteSettings: one(bundleRemoteSettings, {
    fields: [bundles.id],
    references: [bundleRemoteSettings.bundleId],
  }),
}));

export const bundleRemoteSettingsRelations = relations(bundleRemoteSettings, ({ one }) => ({
  bundle: one(bundles, { fields: [bundleRemoteSettings.bundleId], references: [bundles.id] }),
}));

export const permissionsRelations = relations(permissions, ({ one }) => ({
  user: one(users, { fields: [permissions.userId], references: [users.id] }),
  bundle: one(bundles, { fields: [permissions.bundleId], references: [bundles.id] }),
}));

export const pagesRelations = relations(pages, ({ one, many }) => ({
  bundle: one(bundles, { fields: [pages.bundleId], references: [bundles.id] }),
  autosaveDrafts: many(autosaveDrafts),
  activeEditSessions: many(activeEditSessions),
  searchIndex: one(searchIndex, { fields: [pages.id], references: [searchIndex.pageId] }),
  embeddingChunks: many(pageEmbeddingChunks),
}));

export const pageEmbeddingChunksRelations = relations(pageEmbeddingChunks, ({ one }) => ({
  page: one(pages, { fields: [pageEmbeddingChunks.pageId], references: [pages.id] }),
}));

export const autosaveDraftsRelations = relations(autosaveDrafts, ({ one }) => ({
  user: one(users, { fields: [autosaveDrafts.userId], references: [users.id] }),
  page: one(pages, { fields: [autosaveDrafts.pageId], references: [pages.id] }),
}));

export const activeEditSessionsRelations = relations(activeEditSessions, ({ one }) => ({
  user: one(users, { fields: [activeEditSessions.userId], references: [users.id] }),
  page: one(pages, { fields: [activeEditSessions.pageId], references: [pages.id] }),
}));

export const mergeRequestsRelations = relations(mergeRequests, ({ one, many }) => ({
  bundle: one(bundles, { fields: [mergeRequests.bundleId], references: [bundles.id] }),
  author: one(users, { fields: [mergeRequests.authorId], references: [users.id] }),
  comments: many(mrComments),
  reviewers: many(mrReviewers),
  conflicts: many(mrConflicts),
}));

export const mrConflictsRelations = relations(mrConflicts, ({ one }) => ({
  mergeRequest: one(mergeRequests, { fields: [mrConflicts.mrId], references: [mergeRequests.id] }),
}));

export const mrCommentsRelations = relations(mrComments, ({ one }) => ({
  mergeRequest: one(mergeRequests, { fields: [mrComments.mrId], references: [mergeRequests.id] }),
  author: one(users, { fields: [mrComments.authorId], references: [users.id] }),
}));

export const mrReviewersRelations = relations(mrReviewers, ({ one }) => ({
  mergeRequest: one(mergeRequests, {
    fields: [mrReviewers.mrId],
    references: [mergeRequests.id],
  }),
  user: one(users, { fields: [mrReviewers.userId], references: [users.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
  bundle: one(bundles, { fields: [notifications.bundleId], references: [bundles.id] }),
  mergeRequest: one(mergeRequests, {
    fields: [notifications.mrId],
    references: [mergeRequests.id],
  }),
}));

export const searchIndexRelations = relations(searchIndex, ({ one }) => ({
  page: one(pages, { fields: [searchIndex.pageId], references: [pages.id] }),
}));

export const indexerRunsRelations = relations(indexerRuns, ({ one }) => ({
  bundle: one(bundles, { fields: [indexerRuns.bundleId], references: [bundles.id] }),
  triggeredBy: one(users, { fields: [indexerRuns.triggeredById], references: [users.id] }),
  mergeRequest: one(mergeRequests, {
    fields: [indexerRuns.mrId],
    references: [mergeRequests.id],
  }),
}));

export const chatThreadsRelations = relations(chatThreads, ({ one, many }) => ({
  bundle: one(bundles, { fields: [chatThreads.bundleId], references: [bundles.id] }),
  user: one(users, { fields: [chatThreads.userId], references: [users.id] }),
  messages: many(chatMessages),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  thread: one(chatThreads, { fields: [chatMessages.threadId], references: [chatThreads.id] }),
}));

export const agentSessionsRelations = relations(agentSessions, ({ one, many }) => ({
  user: one(users, { fields: [agentSessions.userId], references: [users.id] }),
  bundle: one(bundles, { fields: [agentSessions.bundleId], references: [bundles.id] }),
  targetPage: one(pages, {
    fields: [agentSessions.targetPageId],
    references: [pages.id],
  }),
  messages: many(agentMessages),
  uploads: many(agentUploads),
  sessionSkills: many(agentSessionSkills),
  sectionEdits: many(agentSectionEdits),
}));

export const agentMessagesRelations = relations(agentMessages, ({ one }) => ({
  session: one(agentSessions, {
    fields: [agentMessages.sessionId],
    references: [agentSessions.id],
  }),
}));

export const agentSectionEditsRelations = relations(agentSectionEdits, ({ one }) => ({
  session: one(agentSessions, {
    fields: [agentSectionEdits.sessionId],
    references: [agentSessions.id],
  }),
}));

export const agentUploadsRelations = relations(agentUploads, ({ one }) => ({
  session: one(agentSessions, {
    fields: [agentUploads.sessionId],
    references: [agentSessions.id],
  }),
}));

export const skillsRelations = relations(skills, ({ one, many }) => ({
  createdBy: one(users, { fields: [skills.createdById], references: [users.id] }),
  roleDefaults: many(skillRoleDefaults),
  sessionSkills: many(agentSessionSkills),
}));

export const skillRoleDefaultsRelations = relations(skillRoleDefaults, ({ one }) => ({
  skill: one(skills, { fields: [skillRoleDefaults.skillId], references: [skills.id] }),
}));

export const agentSessionSkillsRelations = relations(agentSessionSkills, ({ one }) => ({
  session: one(agentSessions, {
    fields: [agentSessionSkills.sessionId],
    references: [agentSessions.id],
  }),
  skill: one(skills, { fields: [agentSessionSkills.skillId], references: [skills.id] }),
}));
