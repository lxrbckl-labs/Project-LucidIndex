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

# `pnpm deploy` already produced a self-contained, production-only tree at
# /app/deploy in the builder stage — node_modules with workspace deps
# materialised as real files (no symlinks back into the monorepo), plus the
# package manifest. Copy in the compiled output alongside it.
COPY --from=builder /app/deploy ./
COPY --from=builder /app/apps/cron/dist ./dist

CMD ["node", "dist/server.js"]
