/**
 * Source-URL normalization for cross-corpus dedup.
 *
 * Background: `articles.source_url` is the single dedup key the dashboard
 * MCP uses to decide "have we covered this URL before?" (both `check_article_exists`
 * and the `(target_id, source_url)` UNIQUE constraint compare strings byte-
 * for-byte). That made the dedup story leaky: the same article reached through
 * `https://Example.com/a/`, `https://example.com/a`, and
 * `https://example.com/a?utm_source=newsletter` looked like three distinct
 * sources to the corpus.
 *
 * `normalizeSourceUrl` is the canonicalization pass we run BEFORE every read
 * or write against `articles.source_url`. Rules (RFC 3986 + tracking-param
 * pragmatism):
 *
 *   1. Lowercase the host (case-insensitive per RFC 3986).
 *   2. Drop default ports (`:80` for http, `:443` for https).
 *   3. Strip the URL fragment (`#...`) — fragments never reach the origin.
 *   4. Drop a leading `www.` from the host (`www.example.com` and
 *      `example.com` collide).
 *   5. Drop tracking query params: `utm_*`, `fbclid`, `gclid`, `ref`,
 *      `ref_src`, `mc_cid`, `mc_eid`, `_hsenc`, `_hsmi`. (Surgical list —
 *      keeps real query-driven URLs like `?id=123` intact.)
 *   6. Sort the remaining query params alphabetically so `?b=2&a=1` and
 *      `?a=1&b=2` collide.
 *   7. Strip the trailing slash from the path unless the path IS `/`.
 *
 * Parse failures throw `InvalidSourceUrlError` — callers catch this and
 * surface it as `invalid_source_url` to the MCP client (so a malformed URL
 * is reported back rather than silently swallowed).
 *
 * IMPORTANT: this normalization is one-way; we never un-normalize a stored
 * URL. The original raw URL is lost on the write path. That's intentional —
 * the canonical form is what we want to display + dedup against, and the
 * agent is expected to surface the canonical URL in citations and UI.
 */

/**
 * Thrown when the input does not parse via the WHATWG `URL` constructor.
 * Callers catch this and convert to their own error code
 * (`invalid_source_url`) for the wire.
 */
export class InvalidSourceUrlError extends Error {
  readonly code = 'invalid_source_url'
  constructor(raw: string, cause?: unknown) {
    super(`URL did not parse: ${raw}`)
    this.name = 'InvalidSourceUrlError'
    if (cause !== undefined) {
      // Attach the underlying TypeError for debugging without exposing
      // it to the wire (where we only show `code` + `message`).
      ;(this as { cause?: unknown }).cause = cause
    }
  }
}

/**
 * Query parameters dropped during normalization. All marketing /
 * attribution flotsam that doesn't affect what document the origin
 * serves. `utm_*` is a prefix match — every `utm_source`, `utm_medium`,
 * etc. is dropped.
 */
const TRACKING_PARAM_PREFIXES = ['utm_'] as const
const TRACKING_PARAM_NAMES = new Set([
  'fbclid',
  'gclid',
  'ref',
  'ref_src',
  'mc_cid',
  'mc_eid',
  '_hsenc',
  '_hsmi',
])

function isTrackingParam(name: string): boolean {
  if (TRACKING_PARAM_NAMES.has(name)) return true
  for (const prefix of TRACKING_PARAM_PREFIXES) {
    if (name.startsWith(prefix)) return true
  }
  return false
}

/**
 * Normalize a source URL into the canonical form used as the dedup key
 * across the corpus. Throws `InvalidSourceUrlError` if the input does
 * not parse as a URL.
 */
export function normalizeSourceUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch (err) {
    throw new InvalidSourceUrlError(raw, err)
  }

  // Rule 1 — lowercase host. The WHATWG URL parser already lowercases
  // host as part of percent-decoding, but we set it explicitly to be
  // defensive against engines that diverge.
  url.host = url.host.toLowerCase()

  // Rule 4 — drop the `www.` prefix from the host. We only strip the
  // leading label; `www.foo.www.bar.com` keeps the inner `www.`.
  if (url.hostname.startsWith('www.')) {
    // Re-set hostname (not host) so the port carries through.
    url.hostname = url.hostname.slice('www.'.length)
  }

  // Rule 2 — strip default ports. The URL object exposes the port as
  // a string; an empty string means "no port" (which is what we want
  // for the default).
  if (
    (url.protocol === 'http:' && url.port === '80') ||
    (url.protocol === 'https:' && url.port === '443')
  ) {
    url.port = ''
  }

  // Rule 3 — strip the fragment.
  url.hash = ''

  // Rule 5 + 6 — drop tracking params, then sort the remaining ones.
  // `URLSearchParams` preserves insertion order, so we re-build it from
  // a sorted list of survivors.
  const surviving: [string, string][] = []
  for (const [name, value] of url.searchParams) {
    if (!isTrackingParam(name)) {
      surviving.push([name, value])
    }
  }
  surviving.sort((a, b) => {
    // Sort by name first; if names match, by value so duplicates are
    // deterministically ordered.
    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1
    return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0
  })
  // Clear + re-populate the search params in sorted order.
  // (Direct assignment to `url.search` is the cleanest way; setting
  // the searchParams iterator is read-only on URLSearchParams.)
  const rebuilt = new URLSearchParams()
  for (const [name, value] of surviving) {
    rebuilt.append(name, value)
  }
  url.search = rebuilt.toString()

  // Rule 7 — strip trailing slash from path (unless the path IS `/`).
  // We rebuild the final string by hand so the path mutation doesn't
  // accidentally re-trigger URL serialization quirks.
  let pathname = url.pathname
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1)
  }

  // Recompose. We use the URL's own toString (after our mutations) and
  // then swap in the trimmed pathname; doing it this way preserves the
  // proper handling of the auth/credentials section if any, while still
  // letting us control the trailing-slash behavior.
  const portSeg = url.port ? `:${url.port}` : ''
  const search = url.search // already canonicalized
  return `${url.protocol}//${url.hostname}${portSeg}${pathname}${search}`
}
