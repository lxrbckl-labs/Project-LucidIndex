/**
 * Public surface of `@lucidindex/templates`.
 *
 * Two consumers today:
 *   - `apps/web` calls `validateLiquidSyntax` from the Settings → Templates
 *     panel and the matching API routes.
 *   - `packages/db/seed.ts` (and the Phase 4 cron sidecar's first-boot hook)
 *     reads `STARTER_TEMPLATES` to idempotently insert the starter set.
 *
 * Phase 3's mcp-store will pull `validateLiquidSyntax` (or its own
 * `Liquid` engine) for render-time work; either way, this package owns the
 * single LiquidJS dependency for the workspace.
 */

export { STARTER_TEMPLATES, type Starter } from './starters.js'
export { validateLiquidSyntax } from './validate.js'
