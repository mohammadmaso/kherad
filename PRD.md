# Document 1: PRD & Technical Spec (v1)

---

## 0. Project Overview

**What this is:** An internal, git-backed knowledge management system (wiki) for a single organization. Content is organized into **bundles** — logical groupings of related pages (e.g., by team, product, or department) — all stored as Markdown files inside one git repository. Every edit is a git commit under the hood, every published change went through a review-and-approve step, and the entire history is preserved — but none of that git machinery is ever visible to the people actually writing content.

**Who uses it:**

- **Authors** — non-technical staff who write and edit pages through a familiar block-based editor (Lexical). They never see the words "branch," "commit," or "merge" — to them, editing feels like using Google Docs or Notion: open a page, type, hit Save, click "Submit for review."
- **Managers / Reviewers** — review pending changes via a diff view, leave comments, and approve or reject before anything goes live. They're the only role that ever touches lower-level git concepts (e.g., resolving a rare merge conflict).
- **Admins** — provision user accounts, create and archive bundles, and assign who can view/edit/review what.
- **Viewers** — read the published site; some bundles may be fully public and readable without logging in.

**Core workflow, end to end:**

1. An author opens a page (or creates a new one) inside a bundle they have access to. They're silently working on their own personal git branch.
2. They edit in the Lexical editor; work autosaves continuously for crash recovery, but nothing is committed to git until they explicitly hit **Save**.
3. When ready, they click **Submit for review**, which opens a merge request against the bundle.
4. A reviewer sees a clean diff of exactly what changed, comments if needed, and approves or sends it back.
5. On approval, the change is squash-merged into the bundle's live branch and is immediately visible on the rendered site, subject to that bundle's access permissions.

**How it's built:** A single Next.js application renders the wiki on demand (not as a static build, since access control has to be enforced per request) and also hosts the editor and admin UI. A Fastify service handles authentication and every write operation — saving, submitting, reviewing, merging — and is the only process that touches the underlying git repository, using an embedded JS git library (isomorphic-git) rather than an external git host like GitHub. Everything that isn't page content — users, roles, permissions, merge request status, review comments, autosave drafts — lives in Postgres. The whole system runs as a single instance for v1, favoring simplicity appropriate to an internal tool over premature scale.

**In one sentence:** _A Notion-like editing experience for non-technical writers, backed by a real git repository and a lightweight review/approval workflow, for a single organization's internal documentation._

## 1. Roles

| Role                   | Scope                         | Can do                                                                  |
| ---------------------- | ----------------------------- | ----------------------------------------------------------------------- |
| **Admin**              | Global                        | Create users, create/archive bundles, assign roles, view everything     |
| **Manager / Reviewer** | Per-bundle (or per-folder)    | Review merge requests, view raw diffs, resolve conflicts, approve/merge |
| **Author**             | Per-bundle (or per-folder)    | Create/edit pages on their personal branch, submit for review           |
| **Viewer**             | Per-bundle (or per-page)      | Read-only access to the rendered site                                   |
| **Anonymous**          | Only on bundles marked public | Read-only, no login                                                     |

Role assignment is per-bundle by default, with an optional per-folder/per-page override that takes precedence when present.

## 2. Architecture Summary

- **Monorepo** (Turborepo), TypeScript throughout.
  - `apps/web` — Next.js: on-demand SSR wiki rendering + editor + admin panel UI (shadcn/ui + Tailwind).
  - `apps/api` — Fastify: auth + all write operations (save, submit, review, merge, admin CRUD). The only process that mutates the git repo.
  - `packages/core` — shared library: git engine wrapper, permission checks, markdown pipeline. Imported directly by both apps (no internal HTTP hop for reads) so there's one implementation of "can this user see this" and "how do we read this ref."
  - `packages/db` — Drizzle ORM schema + migrations + Postgres client.
  - `packages/ui` — shared shadcn/ui components.
- **Single Linux instance**, Docker Compose (web / api / postgres containers) — not Kubernetes. Horizontal scaling explicitly out of scope for v1 (the local-disk + `flock` git model doesn't survive multiple instances without extra work).
- **Single git repository** on local disk, all bundles as top-level folders. No external git host — the bare repo _is_ the source of truth, read/written via **isomorphic-git**.
- **Postgres** for everything that isn't file content: users, roles, permissions, MR metadata + comments, autosave drafts, sessions, soft edit-locks, search index.

## 3. Repo & Branching Model

- Layout: `/wiki/<bundle-slug>/<folder>/.../<page>.md`, plus `/wiki/<bundle-slug>/_assets/...` for binaries.
- **Branching:** one long-lived branch per user (not per-page). All of Alice's edits across any bundle land on `user/alice`.
- **Save vs. autosave** (resolves the earlier ambiguity — flag if you disagree):
  - **Autosave** (~every 5–10s) → writes to a Postgres draft row, _not_ git. Crash-recovery only.
  - **Explicit "Save"** click → the only action that produces a git commit. Avoids keystroke-level commit flooding while still protecting against data loss.
- **"Submit for review"** packages the branch's current state into an MR. Continuing to edit after submitting updates the same open MR (reviewer sees "new changes since last review").
- **Merge strategy:** squash-merge into the bundle's default branch on approval — clean history on `main`, messy save-by-save history discarded (still recoverable from the MR record if needed).
- **Conflicts:** manager/reviewer resolves them, via a conflict-marker editor (Monaco/CodeMirror, raw `<<<<<<<`/`=======`/`>>>>>>>`). This is the one place raw git vocabulary is acceptable — scoped to the manager role, not authors.
- **"Someone else is editing" — recommended resolution:** since one-branch-per-user already prevents true collision, a _hard_ block would just reintroduce a single-editor bottleneck for no real safety gain. Default: **soft/informational lock** — "Bob is also editing this page" banner, polled every 10–15s, non-blocking. **Flag this if you actually wanted a hard block** — that's a different, more restrictive feature.
- **Rename/move:** `git mv` server-side (preserves history); old path gets a redirect/tombstone in Postgres.
- **Delete:** soft-delete with a tombstone record — old URLs show "this page was removed" instead of a hard 404.

## 4. Data Model (Postgres, Drizzle ORM)

```
users               (id, email, password_hash, display_name, is_admin, created_at)
sessions            (id, user_id, expires_at, created_at)          -- session-based, not JWT
bundles             (id, slug, title, is_public, default_branch, created_at)
permissions         (id, user_id, bundle_id, path_prefix NULL, role) -- NULL prefix = bundle-level
pages               (id, bundle_id, path, title, is_deleted, redirect_to NULL)
autosave_drafts     (id, user_id, page_id, content_json, updated_at)
active_edit_sessions(id, user_id, page_id, last_seen_at)            -- soft lock
merge_requests      (id, bundle_id, author_id, branch_name, status, base_commit, head_commit, created_at)
mr_comments         (id, mr_id, author_id, body, path NULL, line NULL, created_at)
mr_reviewers        (id, mr_id, user_id, decision, decided_at)
search_index        (page_id, tsv)
```

- **Auth:** email + password, `argon2` hashing, **server-side sessions in Postgres** with an httpOnly cookie (not JWT) — instant revocation matters more than stateless scaling here. Wrapped behind a small `packages/core/auth` interface (`login`, `logout`, `getSession`, `requireRole`) so a future SSO swap doesn't touch call sites.
- **Provisioning:** admin-created accounts only — no self-registration. A minimal forgot-password email-token flow is worth including anyway (manual resets don't scale past a handful of users).

## 5. Editor & Content Pipeline

- **Source of truth: Markdown.** Lexical is the editing surface; its markdown transform is the round-trip boundary.
- Content types required for v1: headings, nested lists, tables, **code blocks with language tag** (Shiki), **Mermaid blocks** (fenced ` ```mermaid ` blocks).
- Custom Lexical nodes: `CodeBlockNode` (language-aware), `MermaidNode` (live preview in-editor, serializes to fenced code block).
- Images: uploaded via editor, committed as binaries in `_assets/` on the user's branch, referenced by relative path. No external object storage in v1.
- Editing strictly serial per branch — no Yjs real-time co-editing.

## 6. Rendering & Caching

- **On-demand SSR**, not static — required for per-bundle/per-page access control to actually work (a static build would leak content to anyone with the URL).
- Pipeline: `unified`/`remark`/`rehype`. **Shiki** for server-side syntax highlighting. **Mermaid rendered client-side** (avoids a headless browser on the server for v1).
- **Preview mode:** same renderer, parameterized by branch — lets an author/reviewer see an unmerged branch as it will look live, gated by permission check.
- **Caching:** in-memory LRU keyed by `(bundle, path, branch, commit hash)` — fine for single-instance; no Redis needed.
- Reads never need the write lock (git ref updates are atomic) — only writes go through the lock (§8).

## 7. Merge Request & Review Workflow

- Reviewer assignment per-bundle by default, optional per-folder override.
- **Single approval** required → triggers squash-merge.
- **Diff view:** raw line-based markdown diff (`jsdiff`), not rendered-HTML diff — much simpler to build correctly, and the reviewer role can handle markdown syntax even though authors never see it.
- Image/binary diffs: side-by-side before/after preview.
- Rejected MR → returns to draft on the same branch for rework (not closed permanently).
- Notifications: in-app only for v1.

## 8. Git Engine Internals

- **isomorphic-git**, single bare repo, local disk.
- **Write concurrency, two layers:** (1) in-process async queue/mutex inside Fastify, (2) OS-level `flock` on the repo directory as a second layer (protects against any future second writer process).
- Next.js SSR never takes the write lock — read-only via isomorphic-git.
- **Repo size:** set an explicit soft ceiling to monitor (isomorphic-git degrades more than native git on very large packfiles). Mitigation path if exceeded: externalize large binaries to object storage, or switch to shelling out to real `git`. Not needed now.

## 9. Access Control

- One shared `checkPermission(user, bundle, path, action)` in `packages/core`, called from both Fastify (before writes) and Next.js (before renders).
- Public bundles: anonymous read access goes through the same SSR path, permission check simply passes.

## 10. Search

- **Postgres full-text search** (`tsvector`/`tsquery`), refreshed on merge. No dedicated search engine for v1. Result filtering by permission = join against `permissions` at query time.

## 11. Non-Functional / Ops

- **Backup:** nightly `git bundle create` + `pg_dump`, shipped to object storage.
- **Scaling:** single-instance only for v1 — explicitly deferred, since local-disk + `flock` doesn't survive multiple app instances.
- **Deployment:** Docker Compose, one VM, no Kubernetes.

## 12. Explicit v1 Scope Boundaries

**Out of scope:** real-time multi-cursor editing, N-of-M reviewers, cross-bundle auto-link-repair, bundle version tags/pins, SSO/self-registration/email verification, horizontal scaling, email/Slack notifications, server-side Mermaid rendering.

## 13. Items Still Worth Your Sign-Off

1. Soft lock vs. hard lock (§3) — confirm the soft/informational default.
2. MR = whole branch vs. MR = single page — confirm the "whole branch" default.
3. Forgot-password email flow — confirm you want it in v1 vs. purely admin-driven resets.
