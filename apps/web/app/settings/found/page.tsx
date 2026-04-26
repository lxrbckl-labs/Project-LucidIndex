/**
 * /settings/found — claim the founding admin.
 *
 * The Settings layout already enforces this gate: the page only renders
 * when the `admins` table is empty. Once an admin is claimed, the layout
 * will redirect away from this URL on subsequent visits.
 *
 * Founding-token guard (ticket #27):
 *   - If LUCIDINDEX_FOUNDING_TOKEN is not configured: show a "disabled" notice.
 *   - If configured but the `?token=` query param is missing or wrong: show a
 *     friendly "token required" message. Never echo the env-var value.
 *   - If configured AND the token matches: render the founding form.
 */

import { foundingTokenIsConfigured, foundingTokenMatches } from '../../../lib/founding-token'
import { FoundingPanel } from './FoundingPanel'

export default async function FoundPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const searchParams = await props.searchParams
  const rawToken = searchParams.token
  const tokenCandidate = Array.isArray(rawToken) ? rawToken[0] : rawToken

  // 1. Token not configured at all — enrollment is disabled.
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

  // 2. Token configured but not provided / doesn't match.
  if (!foundingTokenMatches(tokenCandidate)) {
    return (
      <div>
        <h1
          className="text-[clamp(2.5rem,7vw,4.5rem)] font-black tracking-tight leading-none text-black uppercase"
          style={{ fontStretch: 'condensed', letterSpacing: '-0.02em' }}
        >
          Founding token required
        </h1>
        <div className="mt-6 mb-10 h-px w-full bg-neutral-200" />
        <p className="text-base text-neutral-600 leading-relaxed mb-2">
          A founding token is required to claim admin access.
        </p>
        <p className="text-sm text-neutral-500 leading-relaxed">
          Visit{' '}
          <code className="text-xs font-mono bg-neutral-100 px-1 py-0.5 rounded">
            /settings?token=&lt;your-token&gt;
          </code>{' '}
          to claim founding admin.
        </p>
      </div>
    )
  }

  // 3. Token configured AND matches — render the enrollment form.
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
      <FoundingPanel foundingToken={tokenCandidate} />
    </div>
  )
}
