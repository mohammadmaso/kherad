FROM node:20-alpine AS base

FROM base AS builder
RUN apk update && apk add --no-cache libc6-compat
WORKDIR /app
RUN npm install -g turbo
COPY . .
RUN turbo prune api --docker

FROM base AS installer
RUN apk update && apk add --no-cache libc6-compat
WORKDIR /app
RUN npm install -g pnpm

COPY --from=builder /app/out/json/ .
RUN pnpm install --frozen-lockfile

COPY --from=builder /app/out/full/ .
COPY --from=builder /app/tsconfig.base.json .
RUN pnpm turbo build --filter=api...

FROM base AS runner
WORKDIR /app
RUN apk add --no-cache su-exec \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 fastify

COPY --from=installer /app .
COPY apps/api/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh \
  && mkdir -p /data/git-repo \
  && chown -R fastify:nodejs /data/git-repo

# Start as root so the entrypoint can chown the bind-mounted/named-volume
# gitdir (root-owned on Linux servers), then drop to fastify via su-exec.
ENTRYPOINT ["/docker-entrypoint.sh"]
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "apps/api/dist/index.js"]
