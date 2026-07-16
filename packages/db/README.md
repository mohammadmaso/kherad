# @kherad/db

Drizzle ORM schema, migrations, and Postgres client for the wiki's non-content data (users,
permissions, merge requests, etc. — see `PRD.md` §4). Page content itself lives in the git
repo, not here.

## Setup

Copy the env file and point it at your Postgres instance (the root `docker-compose.yml` exposes
one on `localhost:5432`):

```sh
cp .env.example .env
```

## Migrations

Schema lives in `src/schema.ts`. After changing it:

```sh
pnpm db:generate   # writes a new SQL file to drizzle/
pnpm db:migrate    # applies pending migrations to DATABASE_URL
```

Other commands:

```sh
pnpm db:push       # push schema directly without a migration file (prototyping only)
pnpm db:studio     # open Drizzle Studio against DATABASE_URL
pnpm db:seed       # insert one admin user + one public "welcome" bundle
```

`db:seed` reads `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from `.env` (defaults to
`admin@kherad.local` / `changeme123`) and is idempotent — re-running it skips rows that already
exist (matched by `users.email` / `bundles.slug`).

## Usage from other packages

```ts
import { createDb, schema } from "@kherad/db";

const db = createDb(process.env.DATABASE_URL!);
const allUsers = await db.select().from(schema.users);
```
