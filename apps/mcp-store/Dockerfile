# LucidIndex mcp-store — multi-stage Docker build.
#
# Stages:
#   base    : node:22-alpine + pnpm via corepack
#   deps    : install workspace dependencies from frozen lockfile
#   builder : copy source + compile TypeScript to dist/
#   runner  : lean runtime image — node + dist/ + production node_modules

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

COPY apps/mcp-store/package.json ./apps/mcp-store/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/templates/package.json ./packages/templates/package.json

# --ignore-scripts skips the `prepare` hook (lefthook install) which requires
# git — not present in the Alpine image and not needed inside the container.
#
# sharp@0.34 (used by the hero-image pipeline) ships pre-compiled native
# binaries via optionalDependencies — `@img/sharp-linuxmusl-x64`,
# `@img/sharp-linuxmusl-arm64`, etc. pnpm picks the right platform binary
# automatically; no install script needed (sharp 0.33+ dropped that). If
# the runner reports "Could not load the sharp module" at boot, double-
# check that optionalDependencies weren't pruned somewhere in the flow.
RUN pnpm install --frozen-lockfile --ignore-scripts

# ---- builder ----
FROM base AS builder
WORKDIR /app

# Bring in installed node_modules from the deps stage.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/mcp-store/node_modules ./apps/mcp-store/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/templates/node_modules ./packages/templates/node_modules

# Copy full source.
COPY . .

# Compile workspace packages first so their dist/ is ready for the mcp-store
# consumer. Without this, compiled mcp-store resolves workspace imports via
# Node's package exports (which point at dist/) but dist/ won't exist, causing
# ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING at runtime.
RUN pnpm --filter @lucidindex/db build && pnpm --filter @lucidindex/shared build

# Compile the TypeScript sources to apps/mcp-store/dist/.
RUN pnpm --filter @lucidindex/mcp-store build

# Drop devDeps from the resolved workspace tree before we ship it. CI=true
# silences pnpm's interactive "remove modules dir?" prompt, which otherwise
# aborts in non-TTY builds.
ENV CI=true
RUN pnpm --filter @lucidindex/mcp-store --prod --legacy --ignore-scripts deploy /app/deploy

# ---- runner ----
FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

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
COPY --from=builder /app/apps/mcp-store/dist ./dist
COPY --from=builder /app/packages/db/dist ./node_modules/@lucidindex/db/dist
COPY --from=builder /app/packages/shared/dist ./node_modules/@lucidindex/shared/dist

EXPOSE 4000

# The hero-image pipeline writes WebP+JPEG outputs under MCP_IMAGE_DIR
# (default `data/images` relative to the workdir). Production deployments
# should mount a host volume here so files survive container restarts;
# the dashboard's image-serve route handler (Phase 7 #74) reads from
# this same directory. docker-compose.yml owns the volume mapping.

CMD ["node", "dist/server.js"]
