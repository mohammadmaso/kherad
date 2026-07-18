FROM node:20-alpine AS base

FROM base AS builder
RUN apk update && apk add --no-cache libc6-compat
WORKDIR /app
RUN npm install -g turbo
COPY . .
RUN turbo prune web --docker

FROM base AS installer
RUN apk update && apk add --no-cache libc6-compat
WORKDIR /app
RUN npm install -g pnpm

COPY --from=builder /app/out/json/ .
RUN pnpm install --frozen-lockfile

COPY --from=builder /app/out/full/ .
COPY --from=builder /app/tsconfig.base.json .

# Optional build metadata for the About page (pass via docker compose build args).
ARG APP_VERSION=
ARG GIT_SHA=
ARG GIT_COMMIT_DATE=
ARG GIT_REPO_URL=https://github.com/mohammadmaso/kherad
# Next.js inlines NEXT_PUBLIC_* vars into the client bundle at build time, so
# the API base URL must be supplied here rather than as a runtime `environment:`
# entry in docker-compose.yml (which has no effect on already-built pages/JS).
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_APP_VERSION=$APP_VERSION \
    NEXT_PUBLIC_GIT_SHA=$GIT_SHA \
    NEXT_PUBLIC_GIT_COMMIT_DATE=$GIT_COMMIT_DATE \
    NEXT_PUBLIC_GIT_REPO_URL=$GIT_REPO_URL \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN pnpm turbo build --filter=web...

FROM base AS runner
WORKDIR /app
RUN npm install -g pnpm
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs
USER nextjs

COPY --from=installer /app .

ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter=web", "start"]
