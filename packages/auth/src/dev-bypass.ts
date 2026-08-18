/**
 * Dev-only auth-bypass helper.
 *
 * When `LUCIDINDEX_DEV_SKIP_AUTH` is set to `true`, `1`, or `yes`
 * (case-insensitive) AND `NODE_ENV !== 'production'`, `isDevAuthBypassActive()`
 * returns `true` and all auth-gating helpers short-circuit to synthetic data.
 *
 * SAFETY GATE: if the flag is set in a production runtime, a single
 * `console.error` fires at the first call and the function returns `false`.
 * The app continues booting — operators who accidentally ship this flag to
 * production are not blocked, but they are loudly warned and the bypass is
 * not honoured.
 *
 * DO NOT enable this in production. It is a developer-experience flag only.
 */

/**
 * Stable sentinel admin id used by bypass sessions so logs are obvious.
 * All-zeroes UUID v4 — valid Postgres UUID, clearly not a real admin id.
 */
export const DEV_BYPASS_ADMIN_ID = '00000000-0000-0000-0000-000000000000'

/**
 * Parse the raw env-var string. Returns `true` for `true`, `1`, `yes`
 * (case-insensitive). Anything else — including an empty/unset value — is
 * `false`.
 */
function parseFlag(raw: string | undefined): boolean {
  if (!raw) return false
  return ['true', '1', 'yes'].includes(raw.trim().toLowerCase())
}

/** Module-scope guards so we emit each log line at most once per process. */
let warnedActive = false
let erroredProd = false

/**
 * Returns `true` when the dev auth bypass is active for the current request.
 *
 * Check is performed at call time (not module load) so that Next.js dev-server
 * env hot-reload is respected. Log emission is guarded by module-scope flags
 * so each line fires at most once per process.
 */
export function isDevAuthBypassActive(): boolean {
  const flagEnabled = parseFlag(process.env.LUCIDINDEX_DEV_SKIP_AUTH)

  if (!flagEnabled) return false

  // Flag is set — check NODE_ENV.
  if (process.env.NODE_ENV === 'production') {
    if (!erroredProd) {
      erroredProd = true
      console.error(
        '[auth] LUCIDINDEX_DEV_SKIP_AUTH ignored: refusing to bypass auth in production',
      )
    }
    return false
  }

  // Flag is set and we are NOT in production.
  if (!warnedActive) {
    warnedActive = true
    console.warn(
      '[auth] LUCIDINDEX_DEV_SKIP_AUTH is active — auth checks are bypassed. Do NOT use this flag in production.',
    )
  }
  return true
}

/**
 * Dev-only forum-auth-bypass helper (the forum analog of the admin bypass
 * above).
 *
 * When `LUCIDINDEX_DEV_FORUM_USER` is set to a forum username AND
 * `NODE_ENV !== 'production'`, `devForumBypassUsername()` returns that trimmed
 * username so the forum session resolves to that real forum user without a
 * passkey login. An empty/unset value returns `null` (bypass off).
 *
 * SAFETY GATE: if the flag is set in a production runtime, a single
 * `console.error` fires at the first call and the function returns `null`.
 * The app keeps booting — operators who accidentally ship this flag to
 * production are not blocked, but they are loudly warned and the bypass is
 * not honoured.
 *
 * DO NOT enable this in production. It is a developer-experience flag only.
 */

/** Module-scope guards so we emit each forum-bypass log line at most once. */
let warnedForumActive = false
let erroredForumProd = false

/**
 * Returns the trimmed forum username to impersonate when the dev forum bypass
 * is active, otherwise `null`.
 *
 * Check is performed at call time (not module load) so that Next.js dev-server
 * env hot-reload is respected. Log emission is guarded by module-scope flags
 * so each line fires at most once per process.
 */
export function devForumBypassUsername(): string | null {
  const raw = process.env.LUCIDINDEX_DEV_FORUM_USER
  const username = raw?.trim()

  // Empty/unset → bypass off, no logs.
  if (!username) return null

  // Flag is set — check NODE_ENV.
  if (process.env.NODE_ENV === 'production') {
    if (!erroredForumProd) {
      erroredForumProd = true
      console.error(
        '[auth] LUCIDINDEX_DEV_FORUM_USER ignored: refusing to bypass forum auth in production',
      )
    }
    return null
  }

  // Flag is set and we are NOT in production.
  if (!warnedForumActive) {
    warnedForumActive = true
    console.warn(
      `[auth] LUCIDINDEX_DEV_FORUM_USER is active — forum auth bypassed as "${username}". Do NOT use this flag in production.`,
    )
  }
  return username
}
