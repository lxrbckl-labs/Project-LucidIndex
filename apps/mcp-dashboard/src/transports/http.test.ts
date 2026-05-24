/**
 * Tests for the HTTP transport — specifically the /healthz endpoint.
 *
 * Audit round 6 made /healthz a real DB ping (with a 1s timeout) so the
 * docker-compose healthcheck actually reflects DB reachability. Previous
 * behavior was an unconditional 200 — useless for catching a broken DB
 * connection.
 *
 * Coverage targets (when the DB harness or a clean mock seam lands):
 *
 *   1. DB up — /healthz returns 200 with `{ status: 'ok' }`.
 *   2. DB down — /healthz returns 503 with `{ status: 'unhealthy',
 *      reason: 'db_unreachable' }`. The 1s timeout fires when the DB
 *      hangs (e.g. SIGSTOP'd container, packet-drop firewall rule).
 *   3. DB throws synchronously (driver error path) — same 503 shape.
 *
 * STATUS: SKIPPED — the `checkDbHealth` helper is closed over the
 * module-level `db` proxy and not exported, so a clean unit test wants
 * one of:
 *   (a) Refactor `checkDbHealth` to accept the db handle as a param so
 *       the test can pass a stub. Low-risk change but lives one round
 *       beyond this audit's scope.
 *   (b) DATABASE_URL_TEST harness — boot the transport on a free port,
 *       hit /healthz with a live DB, then point at an unreachable DB
 *       and assert 503. Heavier setup; tracks with the broader
 *       write-articles harness work.
 *
 * UPDATE (audit round 9): the harness landed —
 * `@lucidindex/db/test-helpers` exports `makeTestDb()` etc. See
 * `tools/check-article-exists.test.ts` for the working pattern.
 * Option (a) above (refactor `checkDbHealth` to accept the db handle
 * as a parameter) is still the cleanest path for THIS file — it
 * lets the test simulate a hung DB without holding a real socket
 * — but round 9 left it skipped to keep scope tight.
 *
 * Also round 9: `checkDbHealth` now uses a transaction-scoped
 * `SET LOCAL statement_timeout = '1000ms'` so the inner query is
 * actually cancelled on timeout (the previous Promise.race left
 * connections pinned). When this test is wired up, add a fourth
 * case: assert that the timeout path does NOT pin a pool connection
 * across subsequent healthchecks (e.g. by issuing N healthchecks
 * against a hung DB and asserting the pool still has `max - N`
 * connections available, not zero).
 */

import { describe, it } from 'vitest'

describe.skip('GET /healthz', () => {
  // ------------------------------------------------------------------------
  // 1. DB up
  // ------------------------------------------------------------------------
  it('returns 200 { status: "ok" } when SELECT 1 succeeds', async () => {
    // TODO(next round, option a): inject a stub handle whose
    // .execute(sql`SELECT 1`) resolves immediately. Call /healthz via a
    // mounted transport listener. Assert response.status === 200, body
    // === { status: 'ok' }.
  })

  // ------------------------------------------------------------------------
  // 2. DB down — timeout
  // ------------------------------------------------------------------------
  it('returns 503 { status: "unhealthy", reason: "db_unreachable" } when the DB hangs past the 1s timeout', async () => {
    // TODO(next round, option a): inject a stub whose .execute returns
    // a Promise that never resolves. Use vitest fake timers to advance
    // past DB_HEALTH_TIMEOUT_MS (1000). Assert response.status === 503,
    // body === { status: 'unhealthy', reason: 'db_unreachable' }.
  })

  // ------------------------------------------------------------------------
  // 3. DB down — driver error
  // ------------------------------------------------------------------------
  it('returns 503 { status: "unhealthy", reason: "db_unreachable" } when the driver throws', async () => {
    // TODO(next round, option a): inject a stub whose .execute rejects
    // with new Error('ECONNREFUSED'). Assert same 503 shape as the
    // timeout path — both fold into one externally-visible state.
  })
})
