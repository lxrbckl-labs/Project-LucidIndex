/**
 * POST /api/forum/upload-image
 *
 * Auth-gated single-image upload for the forum composer. Multipart body
 * with one `file` field. The bytes are sha256-hashed and written to the
 * content-addressed image store at `MCP_IMAGE_DIR` (the same volume the
 * dashboard hero-image pipeline targets). Forum uploads PRESERVE the
 * original bytes — no resize, no transcode, no EXIF strip — so the file
 * is written as `<hash>.<ext>` where `<ext>` is the canonical extension
 * for the declared MIME (png / jpg / webp / gif). The matching serve
 * route at `apps/web/app/i/[hash]/route.ts` knows to fall through that
 * extension set when the dashboard's webp/jpg pair is absent.
 *
 * The shared `image-pipeline` helper in `packages/shared` is too
 * opinionated for this use (sharp resize + dual encode), so the writeImage
 * step is inlined here.
 *
 * Caps:
 *   - 10 MB hard size cap (v1 — not yet a configurable setting).
 *   - MIME allowlist: png / jpeg / webp / gif.
 *
 * Responses:
 *   - 200 `{ ok: true, hash, mime }` on success.
 *   - 400 `invalid_request` — body parse / missing file.
 *   - 401 `unauthorized` — no forum session.
 *   - 413 `too_large` — payload over 10 MB.
 *   - 415 `invalid_type` — MIME outside allowlist.
 *   - 500 `write_failed` — fs error writing the bytes.
 */

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { requireForumUser } from '@lucidindex/auth'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** Hardcoded for v1 — see route header. 10 MiB. */
const MAX_BYTES = 10 * 1024 * 1024

/**
 * Resolved at module load. Same env var the dashboard image pipeline +
 * `/i/[hash]` route read; keep them in lock-step.
 */
const IMAGE_DIR = resolve(process.env.MCP_IMAGE_DIR ?? 'data/images')

export async function POST(req: Request) {
  const session = await requireForumUser()
  if (!session?.forumUserId) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid_request' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, reason: 'invalid_request' }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ ok: false, reason: 'invalid_request' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, reason: 'too_large' }, { status: 413 })
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { ok: false, reason: 'invalid_type', allowed: Array.from(ALLOWED_MIME) },
      { status: 415 },
    )
  }

  const bytes = Buffer.from(await file.arrayBuffer())
  // Re-check after read in case the browser lied about size.
  if (bytes.byteLength > MAX_BYTES) {
    return NextResponse.json({ ok: false, reason: 'too_large' }, { status: 413 })
  }

  const hash = createHash('sha256').update(bytes).digest('hex')
  const ext = MIME_TO_EXT[file.type]
  if (!ext) {
    // Belt-and-suspenders — ALLOWED_MIME check above already guarded this.
    return NextResponse.json({ ok: false, reason: 'invalid_type' }, { status: 415 })
  }

  try {
    await mkdir(IMAGE_DIR, { recursive: true })
    await writeFile(join(IMAGE_DIR, `${hash}.${ext}`), bytes)
  } catch {
    return NextResponse.json({ ok: false, reason: 'write_failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, hash, mime: file.type })
}
