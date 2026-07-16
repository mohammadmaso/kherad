# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Kherad is an internal, git-backed wiki. Non-technical authors edit pages through a Lexical
block editor that feels like Notion, but every save is a real git commit under the hood, and
every published change goes through a merge-request review/approve step. See `PRD.md` for the
full product/technical spec (roles, data model, workflows) — read it when a task touches
permissions, the git/branching model, or the review workflow, since this file only covers
what's needed to navigate and run the code.

## Commands

This is a pnpm + Turborepo monorepo (`pnpm@10.34.4`, Node >=20). Run from repo root unless noted.

```sh
pnpm dev            # turbo run dev — starts apps/api (tsx watch) and apps/web (next dev) together
pnpm build          # turbo run build
pnpm lint           # turbo run lint
pnpm check-types    # turbo run check-types (tsc --noEmit in every package)
pnpm test           # turbo run test (currently only packages/core has tests)
pnpm format         # prettier --write across the repo
```

Scope any of the above to one workspace with `pnpm --filter <name> <script>` (package names:
`api`, `web`, `@kherad/core`, `@kherad/db`, `@kherad/ui`).

**Tests** live only in `packages/core` (Vitest). Run them from that package:

```sh
cd packages/core
pnpm test                                   # vitest run — all tests
pnpm vitest run src/git/engine.test.ts      # single file
pnpm vitest run -t "some test name"         # single test by name
```

**Database** (`packages/db`), via `drizzle-kit`, run from `packages/db` after `cp .env.example .env`:

```sh
pnpm db:generate   # write a new migration from src/schema.ts
pnpm db:migrate    # apply pending migrations
pnpm db:push       # push schema directly, no migration file (prototyping only)
pnpm db:studio     # Drizzle Studio against DATABASE_URL
pnpm db:seed       # idempotent: one admin user + one public "welcome" bundle
```

**Local infra**: `docker-compose.yml` at the root brings up Postgres, the Python Docling
ingest service, and (if built) the api/web containers. For day-to-day dev, run
`docker-compose up postgres ingest` and run `api`/`web` with `pnpm dev`.

**Document ingest** (`apps/ingest`): FastAPI + Docling conversion microservice on port 4100.
Not part of the pnpm workspace. Locally:

```sh
cd apps/ingest
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 4100
```

Set `INGEST_SERVICE_URL=http://localhost:4100` in `apps/api/.env`. OCR uses dedicated admin
settings at `/admin/ocr` (OpenAI-compatible vision). Voice ingest uses `/admin/stt`
(OpenAI-compatible `/audio/transcriptions`). Both are separate from `/admin/ai`.

Each app/package needs its own `.env` (copy from the adjacent `.env.example`): `apps/api`,
`apps/web`, `packages/db`, `packages/core`. Key vars: `DATABASE_URL`, `GIT_REPO_PATH` (api
only — where the bare git repo lives on disk), `JWT_SECRET`, `NEXT_PUBLIC_API_URL` (web →
api base URL), `WEB_ORIGIN` (api CORS allowlist), `INGEST_SERVICE_URL` (api → Docling service).

## Architecture

### Two sources of truth

Page **content** (markdown + binaries) lives only in a single bare git repo on local disk,
read/written exclusively through `packages/core/src/git` (an `isomorphic-git` wrapper) —
never through Postgres. Everything else — users, sessions, permissions, bundles/pages
_metadata_, merge requests, comments, autosave drafts, presence — lives in Postgres via
`packages/db` (Drizzle ORM, schema in `packages/db/src/schema.ts`). A `pages` row's `path`
is the join key into the git tree: `apps/api/src/lib/wiki-paths.ts` maps
`(bundle.slug, page.path)` → `wiki/<bundle-slug>/<page.path>.md`.

### `packages/core` is the shared brain

Both `apps/api` and `apps/web` import `packages/core` directly (workspace package, not an
HTTP call) so there is exactly one implementation of "can this user do X" and "how do we read
a git ref." It has three independent entry points (see its `package.json` `exports`):

- `@kherad/core/git` — the git engine (`createGitEngine`, `packages/core/src/git/engine.ts`).
  All read functions (`getFileAtRef`, `listBranches`, `diffRefs`, …) hit the bare repo directly.
  All write functions (`createUserBranch`, `writeAndCommit`, `squashMerge`) are routed through
  `createWriteLock` (`git/lock.ts`), a two-layer lock: an in-process promise-chain mutex plus an
  OS-level exclusive-file-create lock (`O_EXCL`) on the repo directory, so it's safe even if a
  second process ever touches the same repo. Next.js SSR reads never take this lock; only
  `apps/api` writes go through it.
- `@kherad/core/auth` — `login`/`logout`/`getSession`/`requireRole` plus password hashing
  (`argon2`) and JWT signing (`jose`). **Note:** the current implementation is bearer-JWT
  (`Authorization: Bearer <token>`, stored client-side in `localStorage` under `kherad.token` —
  see `apps/web/src/lib/api-client.ts`), where the JWT's `jti` claim maps to a row in the
  Postgres `sessions` table so logout/expiry still revoke server-side. This differs from the
  httpOnly-cookie session design described in `PRD.md` §4 — treat the PRD as the target design
  and the JWT approach as the implemented state; don't assume they match.
- `@kherad/core/permissions` — one function, `checkPermission(db, user, bundle, path, action)`
  (`permissions/check-permission.ts`), called from every Fastify route handler that touches a
  bundle/page and from the Next.js autosave route. Rules worth knowing before touching
  permission logic: admins bypass everything; `"manage"` is admin-only (no per-bundle grant
  satisfies it); public bundles allow anonymous `"view"`; when a user has both a bundle-level
  grant (`pathPrefix: null`) and a path-prefix grant, the **most specific matching prefix wins
  outright** — it does not merge/union with the bundle-level grant.

### Branching model (git engine)

One long-lived branch per user, not per page: `user/<userId>` (`git/refs.ts`,
`userBranchName`). Editing autosaves to a Postgres draft row only; nothing touches git until an
explicit save, which calls `writeAndCommit` on the user's branch (created lazily via
`createUserBranch` on first write). Reading a page prefers the current user's branch if it
exists, falling back to `bundle.defaultBranch` (see `apps/api/src/routes/pages.ts` GET
handler) — so an author sees their own in-progress edits, everyone else sees the merged
version. `squashMerge` (`git/merge.ts`) computes a real 3-way merge tree via isomorphic-git's
`merge`, then writes it as a single-parent commit onto the target branch (linear history on
`main`; per-save history is discarded from `main` but still lives on the user branch/MR
record). Renames go through delete-old-path + write-new-path in one commit, plus a
soft-delete/tombstone row in Postgres pointing `redirectTo` at the new path
(`pages.ts` `/rename`).

### `apps/api` (Fastify) — the only writer

Registers a global `preHandler` (`plugins/auth.ts`) that decodes the bearer token into
`request.user` (nullable) on every request; routes then call `checkPermission` themselves
rather than relying on route-level middleware for anything but admin-only endpoints
(`requireAdmin()`). Routes are grouped by resource under `src/routes/`: `auth`, `admin`
(user provisioning — no self-registration), `bundles`, `pages` (content CRUD, the only routes
that touch the git engine), `permissions` (grant/revoke), `presence` (soft-lock heartbeat —
`active_edit_sessions` rows with a 30s freshness window, used for the "someone else is
editing" banner rather than a hard lock).

### `apps/web` (Next.js) — rendering, editor, and _some_ direct writes

Note the split: most writes proxy to `apps/api` via `src/lib/api-client.ts`, but the autosave
draft endpoint (`src/app/api/autosave/route.ts`) is a Next.js route handler that talks to
Postgres directly (own `getSessionUser`/`db` in `src/lib`) rather than calling `apps/api` —
it repeats its own `checkPermission` call rather than inheriting one from Fastify. Keep this
in mind when changing permission logic: it must stay in sync in both places since there's no
shared HTTP layer between them, only the shared `checkPermission` function itself.

The editor (`src/components/editor/`) is Lexical-based; markdown is the round-trip source of
truth (`$convertFromMarkdownString`/`$convertToMarkdownString`), extended with custom
transformers for GFM tables and Mermaid fenced blocks (`transformers/`) and a custom
`MermaidNode` with live in-editor preview. Mermaid itself renders client-side only (no
server-side headless-browser rendering).

### `packages/ui`

Shared shadcn/ui components (Tailwind v4, `@base-ui/react` primitives) consumed by `apps/web`
via subpath exports (`@kherad/ui/components/*`, `@kherad/ui/lib/*`, `@kherad/ui/globals.css`).
Design tokens (type scale, easing curves, reduced-motion/transparency/contrast handling) live
in `packages/ui/src/styles/globals.css` — that file is the source of truth for the visual
system, not per-component overrides.

## Frontend design

Before writing or reviewing any UI, layout, animation, or interaction code in `apps/web` or
`packages/ui`, invoke the `apple-design` skill first. It covers response/feedback timing,
interruptible motion, spring easing, materials/translucency, typography (tracking/leading per
size), spatial consistency for overlays, and reduced-motion/transparency/contrast handling —
apply it even to "static" CRUD screens, not just gesture-driven ones. This project has no
gesture-driven surfaces (no drag/swipe/sheets) yet, so prefer CSS transitions/animations
(`tw-animate-css`, custom easing tokens) over pulling in a JS spring library — only reach for
one if a real gesture-tracked interaction is added.

## Conventions

- All packages are ESM (`"type": "module"`), TypeScript throughout, `strict` +
  `noUncheckedIndexedAccess` enabled in `tsconfig.base.json` — every package's `tsconfig.json`
  extends this.
- ESLint flat config: root `eslint.config.js` exports a `baseConfig` (typescript-eslint
  recommended + prettier) that every package's own `eslint.config.js`/`.mjs` extends.
- Route handler pattern in `apps/api`: look up the bundle/page (404 if missing) → run
  `checkPermission` for the specific action (403 if disallowed) → mutate. Follow this order
  when adding new endpoints rather than checking permissions before existence.
