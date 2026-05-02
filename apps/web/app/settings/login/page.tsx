/**
 * /settings/login — passkey sign-in page.
 *
 * The Settings layout already enforces the gate (this page only renders
 * when `admins` is non-empty AND there is no session), so this page is
 * just the editorial heading + the client form.
 */

import { Separator } from '@/components/ui/separator'
import { LoginPanel } from './LoginPanel'

export default function LoginPage() {
  return (
    <div>
      <h1 className="font-display text-5xl font-black tracking-tight leading-none text-foreground uppercase">
        Sign in
      </h1>
      <Separator className="mt-6 mb-10" />
      <p className="text-base text-muted-foreground leading-relaxed mb-8">
        Use the passkey on this device to access Settings.
      </p>
      <LoginPanel />
    </div>
  )
}
