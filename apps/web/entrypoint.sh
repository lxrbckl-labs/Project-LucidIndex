#!/bin/sh
# LucidIndex web entrypoint.
#
# Runs Drizzle migrations to completion before exec'ing the Next.js server,
# so the HTTP listener never binds against an out-of-date schema. `set -e`
# aborts startup on migration failure — required so we never serve stale
# code against a partially-migrated DB.
#
# drizzle-kit is shipped in the runner image at /app/packages/db/node_modules
# (see apps/web/Dockerfile runner stage). Migrations are idempotent: the
# drizzle journal table tracks applied versions, so a second container start
# is a no-op.
#
# Seeding runs after migrations: seed.ts is `ON CONFLICT DO NOTHING`, so
# repeated boots don't duplicate the starter prompt templates.
set -e

echo "[entrypoint] running migrations..."
cd /app/packages/db
# `pnpm deploy --legacy` materialises a flat tree under node_modules/<pkg>
# without populating node_modules/.bin/, so call drizzle-kit's CJS entry
# directly. The path is stable across minor versions of drizzle-kit.
node node_modules/drizzle-kit/bin.cjs migrate
echo "[entrypoint] migrations complete."

echo "[entrypoint] running seed (idempotent)..."
node /app/packages/db/dist/seed.js || {
  # Seed failure is non-fatal — the schema is migrated, the app can boot.
  # Operators can re-run via `docker compose exec web node /app/packages/db/dist/seed.js`.
  echo "[entrypoint] WARNING: seed exited non-zero; continuing boot anyway."
}

echo "[entrypoint] starting web..."
cd /app
exec node apps/web/server.js
