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
    && pnpm --filter @lucidindex/shared build \
    && pnpm --filter @lucidindex/db build

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

# @lucidindex/shared dist/ — needed by the demo seeder (LUCIDINDEX_SEED_DEMO)
# at runtime. `pnpm deploy --prod` materialises @lucidindex/shared as a
# workspace dep under packages/db/node_modules/@lucidindex/shared/ but only
# copies the source files (per the package.json `source` exports condition);
# Node's production resolver picks the `default` condition which points at
# dist/, so without this COPY the runtime would fail with
# ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING on the raw .ts files.
# Mirrors the same pattern in apps/mcp-store/Dockerfile.
COPY --from=builder /app/packages/shared/dist \
    ./packages/db/node_modules/@lucidindex/shared/dist

# Server-external runtime deps — `@node-rs/argon2` (native binding for
# password hashing), `iron-session` (encrypted session cookie), `postgres`
# (the postgres-js driver wrapped by Drizzle).
#
# next.config.ts lists these in `serverExternalPackages` so they're never
# bundled — at runtime the standalone server does `require('@node-rs/argon2')`
# (and friends) and expects them to resolve through `node_modules/`.
#
# The Next file tracer COPIES files into `.next/standalone/node_modules/.pnpm/`
# but does NOT reconstruct the top-level pnpm symlinks (`node_modules/<pkg>
# → .pnpm/...`) that Node's resolver needs to honour the bare specifier —
# so the standalone tree alone fails with `Cannot find module '@node-rs/argon2'`.
# (The native `.node` is also dlopen'd at runtime, which the static tracer
# can't follow regardless.) We materialise real top-level `node_modules/<pkg>`
# trees with a focused install, pinned to the workspace versions so the
# runtime always matches what was built. `--no-save` skips writing back to
# any package.json; `--omit=dev` keeps it lean.
RUN mkdir -p /tmp/runtime-deps \
    && cd /tmp/runtime-deps \
    && npm init -y >/dev/null \
    && npm install --omit=dev --no-audit --no-fund --no-package-lock \
       @node-rs/argon2@2.0.2 \
       iron-session@8.0.4 \
       postgres@3.4.9 \
    && mkdir -p /app/node_modules/@node-rs \
    && cp -R /tmp/runtime-deps/node_modules/@node-rs/argon2 /app/node_modules/@node-rs/argon2 \
    && for sub in /tmp/runtime-deps/node_modules/@node-rs/argon2-*; do \
         [ -d "$sub" ] && cp -R "$sub" "/app/node_modules/@node-rs/$(basename "$sub")" || true; \
       done \
    && cp -R /tmp/runtime-deps/node_modules/iron-session /app/node_modules/iron-session \
    && cp -R /tmp/runtime-deps/node_modules/postgres /app/node_modules/postgres \
    && rm -rf /tmp/runtime-deps

# Entrypoint runs migrations + seed before starting the Next server.
COPY --from=builder /app/apps/web/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 3000

# server.js is generated by Next.js standalone build. It reads HOST and PORT
# from the environment, matching what docker-compose.yml sets.
ENTRYPOINT ["/app/entrypoint.sh"]
