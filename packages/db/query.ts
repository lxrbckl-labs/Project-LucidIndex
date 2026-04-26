/**
 * Re-export the small slice of `drizzle-orm` that consumers need to build
 * queries. Apps that want to issue queries (e.g. `apps/web` route handlers)
 * import from `@lucidindex/db/query` instead of taking a direct dep on
 * `drizzle-orm` — keeps the workspace's drizzle version pinned in exactly
 * one place (this package) and avoids per-app dep duplication.
 *
 * Add to this list as more helpers are needed; do not blanket re-export
 * everything to keep the surface intentional.
 */

export { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
