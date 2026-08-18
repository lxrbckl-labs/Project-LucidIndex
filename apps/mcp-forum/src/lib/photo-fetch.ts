// Profile-photo URL fetcher.
//
// Takes a URL the agent picked for its avatar, fetches it under a
// strict timeout + content-type budget, and returns raw bytes + MIME.
// Mirrors the validation posture of the human web upload at
// `apps/web/app/api/forum/account/avatar/route.ts`: same allowed MIME
// set — so agents and humans produce avatars of comparable shape.
//
// We intentionally do NOT resize. The human path doesn't either, and
// avatars on render are sized down by the browser. Adding a sharp
// pipeline would also pull a large native dep into a sidecar whose
// only job is one column write.
//
// SSRF posture: the agent presents a bearer token already (trusted
// principal). We don't actively block private-IP ranges — same
// posture as the existing hero-image pipeline used by mcp-dashboard.
// Operators who need stricter egress should enforce it at the network
// layer (firewall, egress proxy).

import env from '../env.js'

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp'])

export type FetchResult =
  | { ok: true; bytes: Uint8Array; mime: string }
  | { ok: false; code: PhotoFetchErrorCode; message: string }

export type PhotoFetchErrorCode =
  | 'invalid_url'
  | 'fetch_failed'
  | 'fetch_timeout'
  | 'status_error'
  | 'invalid_type'
  | 'empty_body'

/**
 * Fetch the URL and return validated bytes + MIME, or a structured
 * error. Never throws — all failure modes are encoded in the return
 * shape so the tool handler can branch cleanly on `code`.
 */
export async function fetchProfilePhoto(urlString: string): Promise<FetchResult> {
  // Parse + scheme check up front — refusing non-http(s) URLs blocks
  // file:, data:, javascript:, etc. before any network work.
  let url: URL
  try {
    url = new URL(urlString)
  } catch {
    return { ok: false, code: 'invalid_url', message: 'URL is not parseable.' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      ok: false,
      code: 'invalid_url',
      message: `URL must be http(s); got ${url.protocol}`,
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), env.MCP_FORUM_PHOTO_FETCH_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(url, {
      signal: controller.signal,
      // Identify ourselves so operators can see what triggered the
      // upstream fetch in their logs. Not load-bearing for behavior.
      headers: { 'User-Agent': 'lucidindex-mcp-forum/0.1' },
    })
  } catch (err) {
    clearTimeout(timer)
    if ((err as { name?: string })?.name === 'AbortError') {
      return {
        ok: false,
        code: 'fetch_timeout',
        message: `Fetch exceeded ${env.MCP_FORUM_PHOTO_FETCH_TIMEOUT_MS}ms.`,
      }
    }
    return {
      ok: false,
      code: 'fetch_failed',
      message: err instanceof Error ? err.message : String(err),
    }
  }
  clearTimeout(timer)

  if (!res.ok) {
    return {
      ok: false,
      code: 'status_error',
      message: `Upstream returned HTTP ${res.status}.`,
    }
  }

  // Pre-check the declared Content-Type. We re-check the canonical
  // value after reading the body (in case the server sent something
  // surprising or a redirect changed it), but failing fast here saves
  // a download when the type is wrong.
  const declared = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase()
  if (!declared || !ALLOWED_MIME.has(declared)) {
    return {
      ok: false,
      code: 'invalid_type',
      message: `Content-Type must be one of ${Array.from(ALLOWED_MIME).join(', ')}; got "${declared ?? 'none'}".`,
    }
  }

  if (!res.body) {
    return { ok: false, code: 'empty_body', message: 'Response body is empty.' }
  }

  // Stream and accumulate the response body into a single Uint8Array.
  // Using a Uint8Array list + final concat keeps allocation amortized.
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      chunks.push(value)
    }
  } catch (err) {
    return {
      ok: false,
      code: 'fetch_failed',
      message: err instanceof Error ? err.message : String(err),
    }
  }

  if (total === 0) {
    return { ok: false, code: 'empty_body', message: 'Downloaded zero bytes.' }
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    bytes.set(c, offset)
    offset += c.byteLength
  }

  return { ok: true, bytes, mime: declared }
}
