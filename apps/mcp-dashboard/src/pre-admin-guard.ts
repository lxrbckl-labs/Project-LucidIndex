// Pre-admin guard.
//
// Until at least one row exists in the `admins` table, every MCP tool call
// must be refused with the application-level error `no_admin_enrolled`. The
// founding admin is provisioned via the apps/web Settings flow (#27); until
// they've claimed the system, agents are not yet authorized to operate.
//
// Applies to BOTH transports — stdio bypasses bearer-auth, but it does NOT
// bypass this guard. The guard's purpose is to prevent agent activity in an
// unprovisioned system, regardless of who's connected.
//
// The check is a `SELECT count(*) FROM admins`. We cache the "admins exist"
// state for ~5 seconds so a burst of tool calls doesn't hammer the DB. Once
// the cache flips to "exists", it stays true for the life of the process —
// admins are never deleted (NO DELETIONS).

import { db } from '@lucidindex/db/client'
import { admins } from '@lucidindex/db/schema'

const CACHE_TTL_MS = 5_000

let cachedAdminsExist = false
let cachedAt = 0

/**
 * Returns true if at least one admin is enrolled. Uses a 5-second cache;
 * once `true`, the cache is permanent (NO DELETIONS rule means admins
 * never go away).
 */
export async function adminsExist(): Promise<boolean> {
  if (cachedAdminsExist) return true
  const now = Date.now()
  if (now - cachedAt < CACHE_TTL_MS) return cachedAdminsExist

  const rows = await db.select({ id: admins.id }).from(admins).limit(1)
  cachedAdminsExist = rows.length > 0
  cachedAt = now
  return cachedAdminsExist
}

/**
 * Sentinel raised by tool handlers when the pre-admin guard fires. The MCP
 * tool wrapper in `tools/index.ts` catches this and returns a CallToolResult
 * with `isError: true` and a `no_admin_enrolled` error code.
 */
export class NoAdminEnrolledError extends Error {
  readonly code = 'no_admin_enrolled' as const
  constructor() {
    super(
      'LucidIndex is not yet provisioned. Claim founding admin via /settings to enable agent operations.',
    )
    this.name = 'NoAdminEnrolledError'
  }
}

/**
 * Throws `NoAdminEnrolledError` if no admins are enrolled. Tool handlers
 * call this as their first action.
 */
export async function requireAdmin(): Promise<void> {
  if (!(await adminsExist())) {
    throw new NoAdminEnrolledError()
  }
}

/** Test/dev-only: forget the cached state. Not used in production paths. */
export function _resetAdminsCache() {
  cachedAdminsExist = false
  cachedAt = 0
}
