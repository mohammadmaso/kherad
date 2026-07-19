# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.34.4 --activate

# Prune the monorepo to this workspace + its deps (json/ vs full/ for cache).
FROM base AS prepare
RUN npm install -g turbo@2.3.3
COPY . .
RUN turbo prune api --docker

FROM base AS builder
# Install deps from the pruned lockfile first — only re-runs when package.json / lock change.
COPY --from=prepare /app/out/json/ .
RUN pnpm install --frozen-lockfile

COPY --from=prepare /app/out/full/ .
COPY --from=prepare /app/tsconfig.base.json .
RUN pnpm turbo build --filter=api... \
  && pnpm --filter=api deploy --prod --legacy /deploy \
  && rm -rf /deploy/src /deploy/data \
        /deploy/Dockerfile /deploy/docker-entrypoint.sh \
        /deploy/eslint.config.js /deploy/tsconfig.json \
        /deploy/tsup.config.ts

# Minimal runtime: production deploy tree + entrypoint (no pnpm/turbo/devDeps).
FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache su-exec \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 fastify \
  && mkdir -p /data/git-repo

COPY apps/api/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

COPY --from=builder --chown=fastify:nodejs /deploy /app

# Start as root so the entrypoint can chown the bind-mounted/named-volume
# gitdir (root-owned on Linux servers), then drop to fastify via su-exec.
ENTRYPOINT ["/docker-entrypoint.sh"]
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "dist/index.js"]
