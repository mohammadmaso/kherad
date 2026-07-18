#!/bin/sh
set -eu

# Bind mounts and first-use named volumes are root-owned on Linux hosts.
# The API runs as uid 1001 (fastify); without a writable gitdir, isomorphic-git
# fails during init with ENOENT on mkdir '.../objects/info'.
GITDIR="${GIT_REPO_PATH:-/data/git-repo}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$GITDIR"
  chown -R fastify:nodejs "$GITDIR"
  exec su-exec fastify "$@"
fi

exec "$@"
