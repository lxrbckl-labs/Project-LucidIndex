/**
 * Hero-image serve route — `/i/<hash>` (#74).
 *
 * Resolves a content-hash filename written by `mcp-store`'s `write_articles`
 * tool (#45) under `<MCP_IMAGE_DIR>/<hash>.{webp,jpg}` and streams it back
 * with a forever cache. Two assets are written per article:
 *
 *   - `<hash>.webp` — primary, ~30-40% smaller, served to modern browsers.
 *   - `<hash>.jpg`  — JPEG fallback for clients that don't accept WebP.
 *
 * Content negotiation:
 *   We honour the request's `Accept` header. If `image/webp` appears anywhere
 *   in the list (the de-facto signal modern browsers send) we serve the WebP
 *   variant; otherwise we serve the JPEG. We do NOT do a more sophisticated
 *   q-value parse — Accept-driven WebP-or-bust is what every CDN does and
 *   the cost of getting it slightly wrong is one extra byte of bandwidth.
 *
 * Caching:
 *   `Cache-Control: public, max-age=31536000, immutable`
 *
 *   Content-hash URLs are immutable by construction — `<hash>` IS the
 *   sha-256 of the bytes — so we tell every cache (browser, CDN, reverse
 *   proxy) it can hold this asset for a year and never revalidate. If the
 *   underlying article gets a new image, it gets a new hash; the old URL
 *   simply 404s (or is already unreferenced).
 *
 *   We also vary on `Accept` so a browser that initially sent
 *   `Accept: image/webp,image/*` doesn't poison the cache for a later
 *   request that arrives without the WebP signal.
 *
 * Path-traversal guard:
 *   The hash is matched against `^[a-f0-9]{64}$` (sha-256 hex) BEFORE
 *   touching the filesystem. Anything else — `..`, slashes, query-style
 *   suffixes — gets a 400 without ever building a path. This is the only
 *   user-controlled component of the eventual file path; with the regex
 *   gate in place there is no way to escape `MCP_IMAGE_DIR`.
 *
 * Why `runtime = 'nodejs'`:
 *   The Edge runtime doesn't expose `node:fs` and the v0.1 image volume is
 *   a host-mounted directory (`docker-compose.yml: mcp_images`). Node is
 *   the only sensible target.
 *
 * Why we don't stream:
 *   `mcp-store/src/lib/image-pipeline.ts` resizes hero images to 1600px
 *   wide before encoding — finished WebP files end up in the ~50-200 KB
 *   range. `readFile` into a single Response body is fine at that size and
 *   keeps the handler trivial. If image budgets ever get into the MB range
 *   a `createReadStream` -> `ReadableStream` swap is a one-function diff.
 */

import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { NextRequest } from 'next/server'

export const runtime = 'nodejs'
// Hashes are content-addressed and the Accept-driven branch is request-scoped;
// we don't want Next inferring a static render here.
export const dynamic = 'force-dynamic'

/**
 * Same default as `apps/mcp-store/src/env.ts` — keep the two in lock-step
 * so a deployment that overrides one and not the other is the only way to
 * see a mismatch (the Compose file mounts the same `mcp_images` volume on
 * both services). Resolved once at module load; the env var is never going
 * to change inside a process lifetime.
 */
const IMAGE_DIR = resolve(process.env.MCP_IMAGE_DIR ?? 'data/images')

/** sha-256 hex string — exactly 64 lowercase hex chars. */
const HASH_RE = /^[a-f0-9]{64}$/

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365 // 31,536,000

export async function GET(req: NextRequest, { params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params

  // Path-traversal guard MUST run before any fs access.
  if (!HASH_RE.test(hash)) {
    return new Response('Bad hash', { status: 400 })
  }

  // Accept-driven WebP vs JPEG fallback. Modern browsers send
  // `Accept: image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8` and
  // get the smaller WebP; Safari < 14 / IE / curl get the JPEG.
  const accept = req.headers.get('accept') ?? ''
  const wantsWebP = accept.includes('image/webp')
  const ext = wantsWebP ? 'webp' : 'jpg'
  const contentType = wantsWebP ? 'image/webp' : 'image/jpeg'

  const filePath = join(IMAGE_DIR, `${hash}.${ext}`)

  let buf: Buffer
  try {
    buf = await readFile(filePath)
  } catch (err) {
    // ENOENT (missing file) and ENOTDIR / EACCES on a misconfigured volume
    // all collapse to 404 — the article page tolerates a missing hero, so
    // a clean 404 is preferable to a 500. We deliberately do NOT log the
    // error path: a stream of bot scans for `/i/<random>` would be noise.
    if (isNodeError(err) && err.code === 'ENOENT') {
      return new Response('Not found', { status: 404 })
    }
    // Other fs errors (EACCES, EISDIR, etc) also become 404 from the
    // client's perspective. The runtime will still surface them in stderr.
    return new Response('Not found', { status: 404 })
  }

  // Response wants `BodyInit`, and lib.dom's `Uint8Array<ArrayBufferLike>`
  // produced by `Buffer` is structurally narrower than the `Uint8Array`
  // overload `BodyInit` accepts. Reconstruct as a fresh ArrayBuffer-backed
  // Uint8Array — `Uint8Array.from(buf)` copies the bytes once (negligible
  // for the 50-200 KB hero sizes capped by mcp-store's image pipeline).
  const body = Uint8Array.from(buf)

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': buf.length.toString(),
      'Cache-Control': `public, max-age=${ONE_YEAR_SECONDS}, immutable`,
      // A given hash maps to two different bodies depending on Accept;
      // tell shared caches to key on it.
      Vary: 'Accept',
    },
  })
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err
}
