/**
 * Tests for the forum agent-token revoke route:
 *   POST /api/agent-invites/forum/[id]  { action: "revoke" }
 *
 * STATUS: .skip placeholders (no executable assertions yet).
 *
 * Why placeholders: `apps/web` has no vitest harness configured today
 * (no vitest.config, no `test` script in package.json, no vitest dev
 * dependency — only `tsc` + `next dev`). Standing up a Next.js
 * route-handler test harness (a vitest config that resolves the
 * `@/` alias, mocks for `@lucidindex/auth/requireAdmin`, a
 * Drizzle/postgres seam for `revokeForumAgentToken`, and a request
 * factory for `NextRequest`/`Request`) is out of scope for this
 * audit-cleanup pass. Mirrors the .skip-with-TODO pattern already
 * used in `apps/mcp-forum/src/tools/*.test.ts` (the `describeIfDb`
 * skip-gate convention).
 *
 * Once a vitest harness lands in apps/web:
 *   - Add `import { describe, it, expect, vi, beforeEach } from 'vitest'`.
 *   - Add `import { POST } from './route'`.
 *   - Mock `@lucidindex/auth` so `requireAdmin()` is controllable per-test.
 *   - Mock `../../../../settings/agent-invites/_lib/agent-invites-repo`
 *     so `revokeForumAgentToken` is a `vi.fn()` you can program per-test.
 *   - Convert each TODO block below into an `it()` block.
 *
 * The route source is `./route.ts`. `requireAdmin` returns
 * `IronSession<SessionData> | null` from `@lucidindex/auth`. The repo
 * function `revokeForumAgentToken(id)` returns either
 * `{ ok: true, alreadyRevoked: boolean }` or
 * `{ ok: false, reason: 'not_found' }`.
 *
 * --- TODO assertions (one `it()` per audit case) -----------------
 *
 * TODO 1. Malformed UUID → 400
 *   - Call POST with id = "not-a-uuid" and body `{ action: "revoke" }`.
 *   - Expect HTTP 400, body `{ ok: false, error: "Invalid token id." }`.
 *   - `revokeForumAgentToken` mock must NOT be called (UUID gate runs
 *     before the repo call).
 *
 * TODO 2. Unknown id → 404
 *   - Mock `revokeForumAgentToken` to resolve `{ ok: false,
 *     reason: "not_found" }`.
 *   - Call POST with a valid-format UUID + `{ action: "revoke" }`.
 *   - Expect HTTP 404, body `{ ok: false, error: "Token not found." }`.
 *
 * TODO 3. Double-revoke (already revoked) → 200 with alreadyRevoked: true
 *   - Mock `revokeForumAgentToken` to resolve `{ ok: true,
 *     alreadyRevoked: true }`.
 *   - Call POST with a valid UUID + `{ action: "revoke" }`.
 *   - Expect HTTP 200, body `{ ok: true, alreadyRevoked: true }`.
 *   - Also assert the first-revoke happy path: mock returns
 *     `{ ok: true, alreadyRevoked: false }`, expect 200 + body
 *     `{ ok: true, alreadyRevoked: false }`.
 *
 * TODO 4. Missing session → 401 (admin gate)
 *   - Mock `requireAdmin` to resolve `null`.
 *   - Call POST with anything.
 *   - Expect HTTP 401, body `{ ok: false, error: "unauthorized" }`.
 *   - `revokeForumAgentToken` mock must NOT be called (session gate
 *     runs before everything).
 *
 * --- Optional extras (cheap given the same fixture) --------------
 *
 *   - Malformed JSON body → 400 "Request body must be valid JSON."
 *   - Body missing `action: "revoke"` → 400 "Expected { action:
 *     "revoke" } in request body."
 *   - Repo returns `{ ok: false }` with an unexpected reason → 500
 *     "Could not revoke."
 */

// Intentionally no imports — this file is a placeholder until a
// vitest harness lands in apps/web. Importing `vitest` here would
// break `pnpm --filter @lucidindex/web exec tsc --noEmit` because
// the package isn't a dependency of @lucidindex/web.

export {}
