/**
 * /api/settings/posting/reset — admin-gated reset endpoint for the
 * posting settings singleton.
 *
 *   POST (no body) → writes DEFAULT_POSTING_SETTINGS back to all four
 *                    columns via the same UPSERT path as the main
 *                    update endpoint, then returns the resulting row.
 *
 * Lives in its own route file so the "Reset to defaults" button can hit
 * a distinct URL — keeps the no-body intent obvious and lets the
 * caller distinguish reset failures from save failures.
 */

import { requireAdmin } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import { resetPostingSettings } from '../../../../settings/posting/_lib/posting-repo'

export const dynamic = 'force-dynamic'

export async function POST() {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const result = await resetPostingSettings()
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 })
  }
  return NextResponse.json({ ok: true, row: result.row })
}
