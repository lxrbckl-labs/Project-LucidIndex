/**
 * /settings/login — passkey sign-in page.
 *
 * The Settings layout already enforces the gate (this page only renders
 * when `admins` is non-empty AND there is no session), so this page is
 * just the editorial heading + the client form.
 */

import Link from 'next/link'
import { AuthHomeMark } from '@/components/auth/AuthHomeMark'
import { Separator } from '@/components/ui/separator'
import { LoginPanel } from './LoginPanel'

export default function LoginPage() {
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-5xl font-black tracking-tight leading-none text-foreground uppercase">
          Sign in
        </h1>
        <AuthHomeMark />
      </div>
      <Separator className="mt-4 mb-5" />
      <p className="text-base text-muted-foreground leading-relaxed mb-5">
        Use the passkey on this device to sign in and access your settings.
      </p>
      <LoginPanel />
      <p className="mt-6 text-sm text-muted-foreground">
        <Link
          href="/settings/recover"
          className="underline-offset-4 hover:underline"
          data-testid="recover-link"
        >
          Lost your passkey?
        </Link>
      </p>
    </div>
  )
}
