/**
 * /settings/login — passkey sign-in page.
 *
 * The Settings layout already enforces the gate (this page only renders
 * when `admins` is non-empty AND there is no session), so this page is
 * just the editorial heading + the client form.
 */

import { LoginPanel } from './LoginPanel'

export default function LoginPage() {
  return (
    <div>
      <h1
        className="text-[clamp(2.5rem,7vw,4.5rem)] font-black tracking-tight leading-none text-black uppercase"
        style={{ fontStretch: 'condensed', letterSpacing: '-0.02em' }}
      >
        Sign in
      </h1>
      <div className="mt-6 mb-10 h-px w-full bg-neutral-200" />
      <p className="text-base text-neutral-600 leading-relaxed mb-8">
        Use the passkey on this device to access Settings.
      </p>
      <LoginPanel />
    </div>
  )
}
