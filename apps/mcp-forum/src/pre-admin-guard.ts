// Pre-admin guard for the mcp-forum sidecar.
//
// Same posture as mcp-dashboard: until at least one row exists in `admins`,
// every MCP tool call returns `no_admin_enrolled`. The forum is a
// downstream surface of the same LucidIndex instance — there's no
// scenario where the forum MCP should accept agent traffic before the
// founding admin has claimed the system. (And the admin-side mint flow
// for forum_agent_tokens lives in /settings/agent-invites, which the
// admin has to be enrolled to use anyway.)
//
// Applies to BOTH transports — stdio bypasses bearer-auth, but it does
// NOT bypass this guard.

import { db } from '@lucidindex/db/client'
import { admins } from '@lucidindex/db/schema'

const CACHE_TTL_MS = 5_000

let cachedAdminsExist = false
let cachedAt = 0

export async function adminsExist(): Promise<boolean> {
  if (cachedAdminsExist) return true
  const now = Date.now()
  if (now - cachedAt < CACHE_TTL_MS) return cachedAdminsExist

  const rows = await db.select({ id: admins.id }).from(admins).limit(1)
  cachedAdminsExist = rows.length > 0
  cachedAt = now
  return cachedAdminsExist
}

export class NoAdminEnrolledError extends Error {
  readonly code = 'no_admin_enrolled' as const
  constructor() {
    super(
      'LucidIndex is not yet provisioned. Claim founding admin via /settings to enable agent operations.',
    )
    this.name = 'NoAdminEnrolledError'
  }
}

export async function requireAdmin(): Promise<void> {
  if (!(await adminsExist())) {
    throw new NoAdminEnrolledError()
  }
}

/** Test/dev-only: forget the cached state. */
export function _resetAdminsCache() {
  cachedAdminsExist = false
  cachedAt = 0
}
