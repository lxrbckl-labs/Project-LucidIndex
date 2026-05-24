// Postgres LISTEN/NOTIFY listener for `agent_token_revoked` (audit
// round 9).
//
// Why a dedicated connection: postgres-js's `.listen(channel, cb)`
// holds the underlying connection in LISTEN mode for the lifetime of
// the subscription — that connection cannot be returned to the pool
// for query traffic. So we DON'T use the shared `@lucidindex/db`
// client (whose pool is `max: 10` and shared with every tool handler);
// we open a separate single-connection postgres-js instance for the
// listener alone. The listener connection is also reconnected
// automatically by postgres-js on socket drop, so transient DB blips
// don't permanently leave the cache un-invalidated (the TTL is still
// the safety net).
//
// Why pg_notify (not raw NOTIFY): the apps/web revoke endpoint sends
// via `pg_notify(channel, payload)` so the payload (the revoked
// token id) can be bound as a parameter — raw `NOTIFY` requires the
// payload to be a SQL literal which is awkward to escape safely. The
// channel name is identical on both sides; keep them in sync if
// renamed (the constant is duplicated here and in
// apps/web/.../agent-tokens-repo.ts).
//
// What we evict: the NOTIFY payload carries the revoked agent_token
// row's UUID. We pass it straight to `evictTokenCacheById(id)` so we
// drop ONLY the matching entry (not the whole cache). A malformed
// payload (parser surprise) falls through to a full `clearTokenCache()`
// — wasteful but safe.

import postgres from 'postgres'
import { clearTokenCache, evictTokenCacheById } from './auth.js'
import env from './env.js'
import { logger } from './logger.js'

/** Channel name — must match `apps/web/.../agent-tokens-repo.ts`. */
const TOKEN_REVOKED_CHANNEL = 'agent_token_revoked'

/**
 * Start a long-lived LISTEN subscription on a dedicated postgres-js
 * connection. Returns a teardown function that closes the
 * subscription and the underlying socket (used in tests; production
 * holds it for the life of the process).
 *
 * Errors are logged but do not crash the sidecar — if the listener
 * fails to bootstrap (DB unreachable at boot), the cache TTL still
 * provides 60s revoke latency, which is acceptable for a degraded
 * mode.
 */
export async function startTokenRevocationListener(): Promise<{ shutdown: () => Promise<void> }> {
  if (!env.DATABASE_URL) {
    logger.warn('token_revocation_listener_skipped', { reason: 'no_database_url' })
    return { shutdown: async () => {} }
  }
  // Single-connection client. `max: 1` is the documented postgres-js
  // shape for LISTEN/NOTIFY — sharing a pool connection isn't safe
  // because LISTEN ties the connection to a channel for its full
  // lifetime. `idle_timeout: 0` + `max_lifetime: 0` keep the socket
  // open forever (postgres-js will auto-reconnect on drop).
  const sql = postgres(env.DATABASE_URL, { max: 1, idle_timeout: 0, max_lifetime: 0 })

  try {
    const subscription = await sql.listen(TOKEN_REVOKED_CHANNEL, (payload: string) => {
      // payload is the agent_token row's UUID. Defensive: if the
      // payload is empty or unparseable, fall back to a full cache
      // clear — that's safe (we just pay argon2 again for the next
      // request from every cached bearer) and avoids silently
      // missing a revoke signal.
      if (!payload || typeof payload !== 'string') {
        logger.warn('token_revocation_payload_missing', {})
        clearTokenCache()
        return
      }
      const removed = evictTokenCacheById(payload)
      logger.info('token_revocation_evicted', {
        agent_token_id: payload,
        evicted_entries: removed,
      })
    })
    logger.info('token_revocation_listener_started', { channel: TOKEN_REVOKED_CHANNEL })
    return {
      shutdown: async () => {
        try {
          await subscription.unlisten()
        } catch {
          /* ignore — we're tearing down */
        }
        try {
          await sql.end({ timeout: 1 })
        } catch {
          /* ignore */
        }
      },
    }
  } catch (err) {
    logger.error('token_revocation_listener_failed', {
      message: err instanceof Error ? err.message : String(err),
    })
    // Try to close the socket so we don't leak the connection.
    sql.end({ timeout: 1 }).catch(() => {})
    return { shutdown: async () => {} }
  }
}
