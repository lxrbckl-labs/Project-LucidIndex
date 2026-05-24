import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema/index.js'

/**
 * Lazy DB client.
 *
 * The previous implementation read `DATABASE_URL` and instantiated the
 * Postgres client at module-load time. That worked at runtime but broke the
 * Next.js production build: `next build` evaluates each API route module
 * (and every server component module they transitively import) during the
 * "Collecting page data" phase even when `export const dynamic =
 * 'force-dynamic'` is set — that phase only DEFERS execution of the
 * handler, not the top-level module imports. With the eager client, simply
 * importing `@lucidindex/db/client` from a route would throw
 * `DATABASE_URL is not set` and abort the build.
 *
 * Solution: defer `postgres()` + `drizzle()` until the first property
 * access on `db`. The exported `db` is a Proxy that constructs the real
 * client on first use and forwards every property/call to it. From the
 * caller's perspective the API is identical to the prior eager export
 * (same `PostgresJsDatabase<typeof schema>` shape).
 */

type DB = PostgresJsDatabase<typeof schema>

// Next.js dev mode hot-reloads modules, creating a fresh module scope each
// time. Without persisting the client across reloads, every edit spawns a
// new `postgres()` pool (each with up to `max` connections) and the old
// pool leaks — connections never close until idle_timeout fires, so after
// a few HMR cycles we hit Postgres's `max_connections` (default 100) and
// every query fails with `too many clients already`.
//
// Cache on `globalThis` in non-production so hot reloads reuse the same
// pool. Also wire idle_timeout + max_lifetime so even legitimate idle
// connections get recycled instead of accumulating.
type GlobalCache = { _pgSql?: ReturnType<typeof postgres>; _db?: DB }
const globalForDb = globalThis as unknown as GlobalCache

function getClient(): DB {
  if (globalForDb._db) return globalForDb._db
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }
  const sql =
    globalForDb._pgSql ??
    postgres(connectionString, {
      max: 10,
      idle_timeout: 30, // seconds — close idle connections after 30s
      max_lifetime: 60 * 30, // seconds — recycle any connection after 30 min
    })
  const db = drizzle(sql, { schema })
  if (process.env.NODE_ENV !== 'production') {
    globalForDb._pgSql = sql
    globalForDb._db = db
  }
  return db
}

export const db = new Proxy({} as DB, {
  get(_target, prop, _receiver) {
    const client = getClient() as unknown as Record<PropertyKey, unknown>
    const value = client[prop]
    if (typeof value === 'function') {
      return (value as (...args: unknown[]) => unknown).bind(client)
    }
    return value
  },
  has(_target, prop) {
    return prop in (getClient() as unknown as object)
  },
}) as DB

/**
 * Build a fresh Drizzle client against an arbitrary connection string.
 * Useful for tests, scripts, and the local-backup / off-site-backup jobs.
 */
export function makeClient(url: string) {
  const s = postgres(url, { max: 5 })
  return drizzle(s, { schema })
}
