# LucidIndex cron sidecar — multi-stage Docker build.
#
# Stages:
#   base    : node:22-alpine + pnpm via corepack
#   deps    : install workspace dependencies from frozen lockfile
#   builder : copy source + compile TypeScript to dist/
#   runner  : lean runtime image — node + dist/ + production node_modules
#
# No port is exposed: the cron sidecar has no HTTP surface. It writes to
# Postgres (via @lucidindex/db) and reads scheduled-job state from there.

# ---- base ----
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# ---- deps ----
FROM base AS deps
WORKDIR /app

# Copy manifest files needed for pnpm to resolve the workspace dependency
# graph. Explicit per-package copies keep cache invalidation tight — a dep
# change in one package doesn't bust the layer for unrelated packages.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json tsconfig.json ./

COPY apps/cron/package.json ./apps/cron/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/templates/package.json ./packages/templates/package.json

# --ignore-scripts skips the `prepare` hook (lefthook install) which requires
# git — not present in the Alpine image and not needed inside the container.
RUN pnpm install --frozen-lockfile --ignore-scripts

# ---- builder ----
FROM base AS builder
WORKDIR /app

# Bring in installed node_modules from the deps stage.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/cron/node_modules ./apps/cron/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/templates/node_modules ./packages/templates/node_modules

# Copy full source.
COPY . .

# Compile packages/db first so its dist/ is ready for the cron consumer.
# Without this, the compiled cron bundle resolves @lucidindex/db imports
# via Node's package exports which point at dist/ — but dist/ won't exist,
# causing ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING at runtime.
RUN pnpm --filter @lucidindex/db build

# Compile the TypeScript sources to apps/cron/dist/.
RUN pnpm --filter @lucidindex/cron build

# Drop devDeps from the resolved workspace tree before we ship it. CI=true
# silences pnpm's interactive "remove modules dir?" prompt, which otherwise
# aborts in non-TTY builds.
ENV CI=true
RUN pnpm --filter @lucidindex/cron --prod --legacy --ignore-scripts deploy /app/deploy

# ---- runner ----
FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

# Phase 7 (#75 + #76) system tool dependencies:
#   - postgresql-client : provides `pg_dump` for the local-backup job (#75).
#                         Alpine's node:22 image does not bundle it. Adds
#                         ~12 MB to the final runner; acceptable trade-off
#                         vs. shelling into the Postgres container which
#                         would require a Docker socket mount.
#   - rclone            : drives the off-site-backup shipment (#76). The
#                         admin's encrypted rclone config (stored in
#                         settings.off_site_backup_credentials_encrypted) is
#                         decrypted at job-time and written to a tmp file
#                         that this binary reads via --config.
#   - tar               : already provided by alpine's BusyBox; included
#                         here as a comment for completeness — local-backup
#                         tars the hero image dir into a single archive.
RUN apk add --no-cache postgresql-client rclone

# `pnpm deploy` already produced a self-contained, production-only tree at
# /app/deploy in the builder stage — node_modules with workspace deps
# materialised as real files (no symlinks back into the monorepo), plus the
# package manifest. Copy in the compiled output alongside it.
#
# packages/db/dist/ must be copied explicitly: `pnpm deploy` materialises the
# workspace dep as source files (per the package.json `source` exports
# condition), but production `node` resolves the `default` condition which
# points at dist/. Without this COPY the runtime would throw
# ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING on the raw .ts files.
COPY --from=builder /app/deploy ./
COPY --from=builder /app/apps/cron/dist ./dist
COPY --from=builder /app/packages/db/dist ./node_modules/@lucidindex/db/dist

CMD ["node", "dist/server.js"]
