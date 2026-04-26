/**
 * /settings/found — claim the founding admin.
 *
 * The Settings layout already enforces this gate: the page only renders
 * when the `admins` table is empty. Once an admin is claimed, the layout
 * will redirect away from this URL on subsequent visits.
 *
 * The `LUCIDINDEX_FOUNDING_TOKEN` env-var guard is NOT wired in here —
 * that's ticket #27. For Phase 1, the only barrier is "admins table is
 * empty", which is fine for local-dev loopback access.
 */

import { FoundingPanel } from './FoundingPanel'

export default function FoundPage() {
  return (
    <div>
      <h1
        className="text-[clamp(2.5rem,7vw,4.5rem)] font-black tracking-tight leading-none text-black uppercase"
        style={{ fontStretch: 'condensed', letterSpacing: '-0.02em' }}
      >
        Claim founding admin
      </h1>
      <div className="mt-6 mb-10 h-px w-full bg-neutral-200" />
      <p className="text-base text-neutral-600 leading-relaxed mb-2">
        No admin has been registered yet. Enroll a passkey on this device to take ownership of this
        LucidIndex.
      </p>
      <p className="text-sm text-neutral-500 leading-relaxed mb-8">
        You'll be shown a one-time recovery code on the next screen — save it before continuing.
      </p>
      <FoundingPanel />
    </div>
  )
}
