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

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { foundingTokenIsConfigured } from '../../../lib/founding-token'
import { FoundingPanel } from './FoundingPanel'

export default async function FoundPage() {
  // Token not configured at all — enrollment is disabled.
  if (!foundingTokenIsConfigured()) {
    return (
      <div>
        <h1 className="font-display text-5xl font-black tracking-tight leading-none text-foreground uppercase">
          Founding admin
        </h1>
        <Separator className="mt-6 mb-10" />
        <Alert variant="default" className="max-w-prose">
          <AlertDescription>
            Founding-admin enrollment is disabled. Set{' '}
            <code className="text-sm font-mono bg-muted px-1 py-0.5 rounded">
              LUCIDINDEX_FOUNDING_TOKEN
            </code>{' '}
            in your environment and reload.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  // Token configured — render the enrollment panel.
  // The panel manages token verification in-page before showing the passkey form.
  return (
    <div>
      <h1
        className="font-display text-5xl font-black tracking-tight leading-none text-foreground uppercase"
        data-testid="founding-page-heading"
      >
        Claim founding admin
      </h1>
      <Separator className="mt-6 mb-10" />
      <p className="text-base text-muted-foreground leading-relaxed mb-2">
        No admin has been registered yet. Enroll a passkey on this device to take ownership of this
        LucidIndex.
      </p>
      <p className="text-sm text-muted-foreground leading-relaxed mb-8">
        You'll be shown a one-time recovery code on the next screen — save it before continuing.
      </p>
      <FoundingPanel />
    </div>
  )
}
