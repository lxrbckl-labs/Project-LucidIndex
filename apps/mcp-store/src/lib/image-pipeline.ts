// Hero image fetch + sharp resize + WebP/JPEG fallback. Owned by #45.
//
// Pipeline:
//   1. fetch(url) with abort-on-timeout and abort-on-byte-cap.
//   2. sharp() to resize to max width MCP_IMAGE_MAX_WIDTH, strip EXIF,
//      orient via metadata.
//   3. Encode TWICE — once as WebP (modern, smaller), once as JPEG
//      (fallback for HTTP clients that don't accept WebP).
//   4. content-hash filename = sha-256 hex of the WebP bytes. Documented:
//      we hash the WebP rather than the source so two equivalent JPEG
//      uploads at slightly different qualities don't collide on disk —
//      our processed output is the unit of dedup.
//   5. Write to <MCP_IMAGE_DIR>/<hash>.webp + <hash>.jpg. Same dir for
//      both extensions; the Phase 7 image-serve route handler picks the
//      one matching the request's Accept header off the same hash.
//
// FAILURE PATH (per spec): ANY error — fetch error, timeout, oversize,
// decode error, write error — logs a structured warning and returns a
// `null` hash. The caller sets articles.hero_image_hash = null and
// proceeds with the article insert. The dashboard tile renders with a
// placeholder. "fetch failure does NOT block the article write."

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import env from '../env.js'
import { logger } from '../logger.js'

export type FetchHeroImageResult = { ok: true; hash: string } | { ok: false; reason: string }

/**
 * Fetch + resize + write a hero image. Returns the content-hash on
 * success, or { ok: false } on any failure. Never throws — failures are
 * logged and reported to the caller via the result.
 */
export async function fetchAndStoreHeroImage(url: string): Promise<FetchHeroImageResult> {
  try {
    const sourceBytes = await fetchWithBudget(url)
    if (!sourceBytes.ok) return sourceBytes

    const processed = await transcode(sourceBytes.bytes)
    if (!processed.ok) return processed

    const hash = sha256Hex(processed.webp)
    const dir = resolve(env.MCP_IMAGE_DIR)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, `${hash}.webp`), processed.webp)
    await writeFile(join(dir, `${hash}.jpg`), processed.jpeg)

    logger.info('hero_image_stored', { hash, source_url: url })
    return { ok: true, hash }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    logger.warn('hero_image_pipeline_failed', { source_url: url, reason })
    return { ok: false, reason }
  }
}

async function fetchWithBudget(
  url: string,
): Promise<{ ok: true; bytes: Buffer } | { ok: false; reason: string }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), env.MCP_IMAGE_FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!response.ok) {
      logger.warn('hero_image_fetch_non_2xx', { source_url: url, status: response.status })
      return { ok: false, reason: `fetch_status_${response.status}` }
    }
    if (!response.body) {
      return { ok: false, reason: 'empty_response_body' }
    }

    // Stream the body, aborting if the byte budget is blown. Content-Length
    // is unreliable (chunked, gzip, sometimes lying servers) so we enforce
    // the cap on observed bytes.
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > env.MCP_IMAGE_MAX_BYTES) {
        controller.abort()
        try {
          await reader.cancel()
        } catch {
          // best effort
        }
        logger.warn('hero_image_oversize', {
          source_url: url,
          observed_bytes: total,
          max_bytes: env.MCP_IMAGE_MAX_BYTES,
        })
        return { ok: false, reason: 'oversize' }
      }
      chunks.push(value)
    }
    return { ok: true, bytes: Buffer.concat(chunks.map((c) => Buffer.from(c))) }
  } catch (err) {
    const reason =
      err instanceof Error
        ? err.name === 'AbortError'
          ? 'fetch_timeout'
          : err.message
        : String(err)
    logger.warn('hero_image_fetch_failed', { source_url: url, reason })
    return { ok: false, reason }
  } finally {
    clearTimeout(timeout)
  }
}

async function transcode(
  source: Buffer,
): Promise<{ ok: true; webp: Buffer; jpeg: Buffer } | { ok: false; reason: string }> {
  try {
    // Reuse one sharp instance per format; both formats start from the same
    // resize/orient/strip pipeline but encode differently.
    const base = sharp(source, { failOn: 'error' }).rotate().resize({
      width: env.MCP_IMAGE_MAX_WIDTH,
      withoutEnlargement: true,
      fit: 'inside',
    })

    // .clone() so the second encode doesn't fight the first over the
    // sharp pipeline's single-consume rule.
    const webp = await base.clone().webp({ quality: 82 }).toBuffer()
    const jpeg = await base.clone().jpeg({ quality: 82, mozjpeg: true }).toBuffer()
    return { ok: true, webp, jpeg }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: `transcode_failed: ${reason}` }
  }
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}
