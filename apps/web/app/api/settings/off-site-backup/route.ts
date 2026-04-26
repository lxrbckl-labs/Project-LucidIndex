/**
 * /api/settings/off-site-backup — singleton settings endpoint.
 *
 *   GET  → return current config: { ok, remoteName, credentialsBlob }
 *          `credentialsBlob` is the decrypted plaintext returned to the admin
 *          so the form can pre-populate it. It is NEVER stored in cleartext —
 *          only the encrypted bytea column is persisted.
 *
 *   POST → update config. Body: { remoteName, credentialsBlob }
 *          Both fields are optional (empty string = clear). Credentials are
 *          encrypted with AES-256-GCM before being stored.
 *
 * Auth: passkey-gated via `requireAdmin()`. 401 when session is absent.
 *
 * No execution — Phase 7 (#76) wires the actual rclone cron job.
 * This route only reads / writes the config fields.
 */

import { requireAdmin } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import {
  getOffSiteBackupConfig,
  saveOffSiteBackupConfig,
  validateOffSiteBackupInput,
} from '../../../settings/off-site-backup/_lib/off-site-backup-repo'

export async function GET() {
  const session = await requireAdmin()
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const config = await getOffSiteBackupConfig()
  return NextResponse.json({
    ok: true,
    remoteName: config.remoteName ?? '',
    credentialsBlob: config.credentialsBlob ?? '',
  })
}

export async function POST(req: Request) {
  const session = await requireAdmin()
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json(
      { ok: false, errors: { _form: 'Request body must be valid JSON.' } },
      { status: 400 },
    )
  }
  if (!raw || typeof raw !== 'object') {
    return NextResponse.json(
      { ok: false, errors: { _form: 'Request body must be a JSON object.' } },
      { status: 400 },
    )
  }

  const body = raw as Record<string, unknown>
  const input = {
    remoteName: typeof body.remoteName === 'string' ? body.remoteName : '',
    credentialsBlob: typeof body.credentialsBlob === 'string' ? body.credentialsBlob : '',
  }

  const errors = validateOffSiteBackupInput(input)
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ ok: false, errors }, { status: 400 })
  }

  await saveOffSiteBackupConfig(input)
  return NextResponse.json({ ok: true })
}
