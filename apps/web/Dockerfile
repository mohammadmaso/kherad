# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.34.4 --activate

FROM base AS prepare
RUN npm install -g turbo@2.3.3
COPY . .
RUN turbo prune web --docker

FROM base AS builder
COPY --from=prepare /app/out/json/ .
RUN pnpm install --frozen-lockfile

COPY --from=prepare /app/out/full/ .
COPY --from=prepare /app/tsconfig.base.json .

# Build-time metadata / public env — kept after install so SHA/version
# changes do not invalidate the dependency layer.
ARG APP_VERSION=
ARG GIT_SHA=
ARG GIT_COMMIT_DATE=
ARG GIT_REPO_URL=https://github.com/mohammadmaso/kherad
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_APP_VERSION=$APP_VERSION \
    NEXT_PUBLIC_GIT_SHA=$GIT_SHA \
    NEXT_PUBLIC_GIT_COMMIT_DATE=$GIT_COMMIT_DATE \
    NEXT_PUBLIC_GIT_REPO_URL=$GIT_REPO_URL \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# Placeholders so `next build` can import route modules that read env at
# load time. Runtime values come from compose / orchestrator.
ENV DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/kherad \
    JWT_SECRET=build-time-placeholder \
    GIT_REPO_PATH=/tmp/git-repo

RUN pnpm turbo build --filter=web...

# Standalone output only — no pnpm, no full monorepo, no devDependencies.
FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
