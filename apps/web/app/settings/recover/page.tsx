/**
 * /settings/recover — passkey recovery page.
 *
 * Reached from the "Lost your passkey?" link on /settings/login. The Settings
 * layout gates this exactly like /settings/login: it only renders when the
 * admins table is non-empty AND there is no session, so this page is just the
 * editorial heading + the client recovery form.
 */

import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { AuthHomeMark } from '@/components/auth/AuthHomeMark'
import { Separator } from '@/components/ui/separator'
import { RecoveryPanel } from './RecoveryPanel'

export default function RecoverPage() {
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/settings/login"
            aria-label="Back to sign in"
            data-testid="recover-back"
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-7" />
          </Link>
          <h1 className="font-display text-5xl font-black tracking-tight leading-none text-foreground uppercase">
            Recover
          </h1>
        </div>
        <AuthHomeMark />
      </div>
      <Separator className="mt-4 mb-5" />
      <p className="text-base text-muted-foreground leading-relaxed mb-5">
        Lost your passkey? Enter your recovery code to enroll a new one on this device.
      </p>
      <RecoveryPanel />
    </div>
  )
}
