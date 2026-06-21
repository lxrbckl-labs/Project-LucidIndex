/**
 * /settings/found — claim the founding admin.
 *
 * The Settings layout enforces the gate: this page only renders when the
 * `admins` table is empty. It renders <FoundingGate /> — the swipe-card dialog
 * (token → name + passkey → one-time passcode), matching the login gate.
 */

import { FoundingGate } from '@/components/auth/FoundingGate'
import { foundingTokenIsConfigured } from '../../../lib/founding-token'

export default async function FoundPage() {
  // Token not configured at all — enrollment is disabled.
  if (!foundingTokenIsConfigured()) {
    return (
      <div className="mx-auto flex flex-col items-center gap-3 rounded-xl border bg-background p-6 shadow-sm max-w-sm w-full text-center">
        <h2 className="text-xl font-semibold tracking-tight">Founding disabled</h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Founding-admin enrollment is disabled. Set{' '}
          <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">
            LUCIDINDEX_FOUNDING_TOKEN
          </code>{' '}
          in your environment and reload.
        </p>
      </div>
    )
  }

  return <FoundingGate />
}
