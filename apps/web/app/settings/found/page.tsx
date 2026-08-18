/**
 * /settings/found — claim the founding admin.
 *
 * The Settings layout renders the founding gate inline for every signed-out
 * /settings/* path while the `admins` table is empty (no redirect — that
 * looped on history.replaceState). So this route's body is effectively never
 * reached; it renders <FoundingGate /> as a safe fallback for a direct hit.
 *
 * Founding is the on-page "Generate token" flow — no env-var gate.
 */

import { FoundingGate } from '@/components/auth/FoundingGate'

export default function FoundPage() {
  return <FoundingGate />
}
