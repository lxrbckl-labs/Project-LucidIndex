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

let _db: DB | null = null

function getClient(): DB {
  if (_db) return _db
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }
  const sql = postgres(connectionString, { max: 10 })
  _db = drizzle(sql, { schema })
  return _db
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
