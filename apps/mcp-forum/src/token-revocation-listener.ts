// Postgres LISTEN/NOTIFY listener for `forum_agent_token_revoked`.
//
// Mirror of apps/mcp-dashboard/src/token-revocation-listener.ts; the
// only difference is the channel name. Read that file's header for
// the full rationale (dedicated connection, why NOT the shared pool,
// pg_notify vs raw NOTIFY, malformed-payload safety net).
//
// Why a dedicated connection: postgres-js's `.listen(channel, cb)`
// holds the underlying connection in LISTEN mode for the lifetime of
// the subscription — that connection cannot be returned to the pool
// for query traffic. So we DON'T use the shared `@lucidindex/db`
// client; we open a separate single-connection postgres-js instance
// for the listener alone. The listener connection is also reconnected
// automatically by postgres-js on socket drop, so transient DB blips
// don't permanently leave the cache un-invalidated (the TTL is still
// the safety net).
//
// What we evict: the NOTIFY payload carries the revoked
// forum_agent_token row's UUID. We pass it straight to
// `evictTokenCacheById(id)` so we drop ONLY the matching entry (not
// the whole cache). A malformed payload (parser surprise) falls
// through to a full `clearTokenCache()` — wasteful but safe.

import postgres from 'postgres'
import { clearTokenCache, evictTokenCacheById } from './auth.js'
import env from './env.js'
import { logger } from './logger.js'

/**
 * Channel name — must match the apps/web revoke handler. Keep these
 * two strings in sync; the constant lives twice (here + on the web
 * side) by design so one side doesn't quietly break the other.
 */
const TOKEN_REVOKED_CHANNEL = 'forum_agent_token_revoked'

/**
 * Initial-listen retry schedule. postgres-js auto-reconnects on socket
 * drop AFTER a successful `.listen(...)`, but a `.listen(...)` that
 * never succeeds (e.g. Postgres not ready at boot) leaves the listener
 * dead for the life of the process — revocation would silently fall
 * back to the 60s TTL forever.
 *
 * Schedule: 1s → 2s → 4s → 8s → 16s capped at 30s total. After the
 * fifth failed attempt we log a structured giving-up event and let the
 * listener stay dead — the server keeps running, the cache TTL is the
 * documented fallback.
 */
const INITIAL_LISTEN_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Start a long-lived LISTEN subscription on a dedicated postgres-js
 * connection. Returns a teardown function that closes the
 * subscription and the underlying socket (used in tests; production
 * holds it for the life of the process).
 *
 * Errors during the initial subscribe are bounded-retried (5 attempts
 * with exponential backoff). If every attempt fails, we log a
 * structured `forum_token_revocation_listener_giving_up` event with
 * the documented fallback (60s TTL) and return a no-op handle — the
 * caller's `await` resolves, the server boots normally, and revoke
 * latency degrades from <10ms to up to 60s. This is intentionally
 * non-fatal: we'd rather degrade revoke latency than crash the
 * sidecar at boot because Postgres is briefly unreachable.
 */
export async function startTokenRevocationListener(): Promise<{ shutdown: () => Promise<void> }> {
  if (!env.DATABASE_URL) {
    logger.warn('forum_token_revocation_listener_skipped', { reason: 'no_database_url' })
    return { shutdown: async () => {} }
  }
  // Single-connection client. `max: 1` is the documented postgres-js
  // shape for LISTEN/NOTIFY — sharing a pool connection isn't safe
  // because LISTEN ties the connection to a channel for its full
  // lifetime. `idle_timeout: 0` + `max_lifetime: 0` keep the socket
  // open forever (postgres-js will auto-reconnect on drop).
  const sql = postgres(env.DATABASE_URL, { max: 1, idle_timeout: 0, max_lifetime: 0 })

  const handlePayload = (payload: string) => {
    // payload is the forum_agent_token row's UUID. Defensive: if
    // the payload is empty or unparseable, fall back to a full
    // cache clear — that's safe (we just pay argon2 again for the
    // next request from every cached bearer) and avoids silently
    // missing a revoke signal.
    if (!payload || typeof payload !== 'string') {
      logger.warn('forum_token_revocation_payload_missing', {})
      clearTokenCache()
      return
    }
    const removed = evictTokenCacheById(payload)
    logger.info('forum_token_revocation_evicted', {
      forum_agent_token_id: payload,
      evicted_entries: removed,
    })
  }

  // Bounded retry loop around the initial `listen()`. Each failure
  // logs the attempt + delay; we sleep, then try again. Once any
  // attempt succeeds, the listener is live for the life of the
  // process (postgres-js handles transient socket drops via its
  // built-in reconnect).
  for (let attempt = 1; attempt <= INITIAL_LISTEN_RETRY_DELAYS_MS.length + 1; attempt++) {
    try {
      const subscription = await sql.listen(TOKEN_REVOKED_CHANNEL, handlePayload)
      logger.info('forum_token_revocation_listener_started', {
        channel: TOKEN_REVOKED_CHANNEL,
        attempt,
      })
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
      const message = err instanceof Error ? err.message : String(err)
      // The last iteration of the loop has no remaining delay — that's
      // the giving-up case. Otherwise sleep for the next backoff
      // window and try again.
      const nextDelay = INITIAL_LISTEN_RETRY_DELAYS_MS[attempt - 1]
      if (nextDelay === undefined) {
        logger.error('forum_token_revocation_listener_giving_up', {
          message,
          attempt,
          fallback: 'cache_ttl_60s',
        })
        // Close the unused socket so we don't leak the connection.
        sql.end({ timeout: 1 }).catch(() => {})
        return { shutdown: async () => {} }
      }
      logger.warn('forum_token_revocation_listener_attempt_failed', {
        message,
        attempt,
        retry_in_ms: nextDelay,
      })
      await sleep(nextDelay)
    }
  }
  // Unreachable — the loop either returns on success or returns on
  // the final failure iteration. Belt-and-suspenders no-op.
  return { shutdown: async () => {} }
}
