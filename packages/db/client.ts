import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema/index.js'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is not set')
}

const sql = postgres(connectionString, { max: 10 })
export const db = drizzle(sql, { schema })

/**
 * Build a fresh Drizzle client against an arbitrary connection string.
 * Useful for tests, scripts, and the local-backup / off-site-backup jobs.
 */
export function makeClient(url: string) {
  const s = postgres(url, { max: 5 })
  return drizzle(s, { schema })
}
