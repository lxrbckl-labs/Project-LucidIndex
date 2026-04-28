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

# LUCIDINDEX_SEED_DEMO — populate the DB with a large stress-test fixture
# (50–80 targets, ~1000 articles with hero images, etc.). Idempotent: only
# fires on an empty DB. Boolean parser accepts true / 1 / yes
# (case-insensitive); everything else is falsy. See
# packages/db/seed-demo.ts and apps/web/.env.example for details.
case "$(printf '%s' "${LUCIDINDEX_SEED_DEMO:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')" in
  true|1|yes)
    echo "[entrypoint] LUCIDINDEX_SEED_DEMO is on — running demo seed (idempotent)..."
    node /app/packages/db/dist/seed-demo.js || {
      # Demo-seed failure is non-fatal — the schema is migrated and the
      # app can boot. Operators can re-run via
      # `docker compose exec web node /app/packages/db/dist/seed-demo.js`.
      echo "[entrypoint] WARNING: seed-demo exited non-zero; continuing boot anyway."
    }
    ;;
  *)
    # Quiet by default — demo data is opt-in and most boots aren't
    # stress-test runs. No log line so production startup stays clean.
    ;;
esac

echo "[entrypoint] starting web..."
cd /app
exec node apps/web/server.js
