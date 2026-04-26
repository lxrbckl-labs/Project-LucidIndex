# LucidIndex web — multi-stage Docker build.
#
# Stages:
#   base    : node:22-alpine + pnpm via corepack
#   deps    : install workspace dependencies from frozen lockfile
#   builder : copy source + build Next.js 15 standalone output + db dist
#   db-deps : focused production install of @lucidindex/db so drizzle-kit
#             ships in the runner without polluting the standalone bundle
#   runner  : lean runtime image — standalone tree + db package + entrypoint
#
# Next.js 15 standalone output (`output: 'standalone'` in next.config.ts)
# produces a self-contained `.next/standalone/` tree with `server.js` plus a
# trimmed `node_modules/`. Workspace packages aren't useful for migrations
# (drizzle-kit reads SQL files at CLI time), so we layer a focused install
# of @lucidindex/db on top — it brings drizzle-kit + migrations + seed.

# ---- base ----
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# ---- deps ----
FROM base AS deps
WORKDIR /app

# Copy manifest files needed for pnpm to resolve the workspace dependency graph.
# Explicit per-package copies keep cache invalidation tight — a dep change in
# one package doesn't bust the layer for unrelated packages.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json tsconfig.json ./

COPY apps/web/package.json ./apps/web/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/auth/package.json ./packages/auth/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/templates/package.json ./packages/templates/package.json

# --ignore-scripts skips the `prepare` hook (lefthook install) which requires
# git — not present in the Alpine image and not needed inside the container.
RUN pnpm install --frozen-lockfile --ignore-scripts

# ---- builder ----
FROM base AS builder
WORKDIR /app

# Bring in installed node_modules from deps stage.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/auth/node_modules ./packages/auth/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/templates/node_modules ./packages/templates/node_modules

# Copy full source.
COPY . .

# Compile workspace packages first so their dist/ is ready when Next bundles
# the web app. Without this, the Next build resolves @lucidindex/templates
# (and friends) via the package's `default` exports condition — which points
# at dist/ — and fails with "Module not found: Can't resolve 'liquidjs'"
# (the unbuilt source uses `import { Liquid } from 'liquidjs'` which Next
# can't follow through a workspace package whose dist/ doesn't exist yet).
RUN pnpm --filter @lucidindex/templates build \
    && pnpm --filter @lucidindex/db build \
    && pnpm --filter @lucidindex/shared build

# Build the Next.js app. `output: 'standalone'` is set in next.config.ts, so
# the build produces `.next/standalone/` with server.js + trimmed node_modules.
RUN pnpm --filter @lucidindex/web build

# ---- db-deps ----
# Focused production install of @lucidindex/db using `pnpm deploy` so the
# runner image gets a self-contained, real-files (no symlinks) tree
# containing drizzle-kit + drizzle-orm + postgres. We need this because the
# Next.js standalone bundle is intentionally minimal and does NOT include
# the db package's tooling — but the runner has to run migrations on boot.
#
# CI=true silences pnpm's interactive "remove modules dir?" prompt, which
# otherwise aborts in non-TTY builds.
FROM builder AS db-deps
ENV CI=true
RUN pnpm --filter @lucidindex/db --prod --legacy --ignore-scripts deploy /app/db-deploy

# ---- runner ----
FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

# Standalone Next bundle — includes server.js and a minimal node_modules tree.
COPY --from=builder /app/apps/web/.next/standalone ./

# Static assets are served by the embedded Next.js server from these paths.
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

# @lucidindex/db package + its production node_modules (drizzle-kit, drizzle-orm,
# postgres). Layout mirrors the monorepo so drizzle.config.ts's relative
# `./schema/index.ts` and `./migrations` paths resolve unchanged at boot.
COPY --from=db-deps /app/db-deploy/package.json ./packages/db/package.json
COPY --from=db-deps /app/db-deploy/node_modules ./packages/db/node_modules
COPY --from=builder /app/packages/db/drizzle.config.ts ./packages/db/drizzle.config.ts
COPY --from=builder /app/packages/db/migrations ./packages/db/migrations
COPY --from=builder /app/packages/db/schema ./packages/db/schema
COPY --from=builder /app/packages/db/dist ./packages/db/dist

# Entrypoint runs migrations + seed before starting the Next server.
COPY --from=builder /app/apps/web/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 3000

# server.js is generated by Next.js standalone build. It reads HOST and PORT
# from the environment, matching what docker-compose.yml sets.
ENTRYPOINT ["/app/entrypoint.sh"]
