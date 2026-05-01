/**
 * /settings/found — claim the founding admin.
 *
 * The Settings layout already enforces this gate: the page only renders
 * when the `admins` table is empty. Once an admin is claimed, the layout
 * will redirect away from this URL on subsequent visits.
 *
 * When `LUCIDINDEX_FOUNDING_TOKEN` is configured, this page renders
 * `<FoundingPanel />` directly. The panel handles token verification
 * in-page (Stage A: token input → Stage B: passkey enrollment form).
 * No URL query params are read or required.
 */

import { foundingTokenIsConfigured } from '../../../lib/founding-token'
import { FoundingPanel } from './FoundingPanel'

export default async function FoundPage() {
  // Token not configured at all — enrollment is disabled.
  if (!foundingTokenIsConfigured()) {
    return (
      <div>
        <h1
          className="text-[clamp(2.5rem,7vw,4.5rem)] font-black tracking-tight leading-none text-black uppercase"
          style={{ fontStretch: 'condensed', letterSpacing: '-0.02em' }}
        >
          Founding admin
        </h1>
        <div className="mt-6 mb-10 h-px w-full bg-neutral-200" />
        <p className="text-base text-neutral-600 leading-relaxed">
          Founding-admin enrollment is disabled. Set{' '}
          <code className="text-sm font-mono bg-neutral-100 px-1 py-0.5 rounded">
            LUCIDINDEX_FOUNDING_TOKEN
          </code>{' '}
          in your environment and reload.
        </p>
      </div>
    )
  }

  // Token configured — render the enrollment panel.
  // The panel manages token verification in-page before showing the passkey form.
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
