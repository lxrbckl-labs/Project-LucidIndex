/**
 * Settings → Account
 *
 * Three sections:
 *   1. Registered passkeys — list of credentials for the authenticated admin.
 *   2. Register another passkey — WebAuthn registration ceremony for a new device.
 *   3. Recovery code — one-time-display regeneration with burned-old-code semantics.
 *
 * This page is a server component that fetches the credential list. The two
 * interactive sections are client components that drive their own API calls.
 */

import { getAdminCredentials, requireAdmin } from '@lucidindex/auth'
import { redirect } from 'next/navigation'
import { RegenerateRecoveryCode } from './_components/RegenerateRecoveryCode'
import { RegisterPasskeyForm } from './_components/RegisterPasskeyForm'

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default async function AccountPanelPage() {
  const session = await requireAdmin()
  if (!session) {
    redirect('/settings/login')
  }

  const creds = await getAdminCredentials(session.adminId as string)

  return (
    <div className="max-w-[640px]">
      {/* Page header */}
      <p className="text-xs uppercase tracking-wide text-neutral-400 mb-2">Phase 2</p>
      <h1
        className="text-[clamp(2rem,5vw,3.5rem)] font-black tracking-tight leading-none text-black uppercase"
        style={{ fontStretch: 'condensed', letterSpacing: '-0.02em' }}
      >
        Account
      </h1>
      <div className="mt-6 mb-10 h-px w-full bg-neutral-200" />

      {/* ── Section 1: Registered passkeys ── */}
      <section aria-labelledby="passkeys-heading" className="mb-10">
        <h2 id="passkeys-heading" className="text-base font-semibold text-black mb-4">
          Registered passkeys
        </h2>

        {creds.length === 0 ? (
          <p className="text-sm text-neutral-500">No passkeys registered yet.</p>
        ) : (
          <ul
            className="divide-y divide-neutral-100 border-t border-neutral-100"
            data-testid="passkey-list"
          >
            {creds.map((cred) => (
              <li
                key={cred.id}
                className="flex items-center justify-between py-3 gap-4"
                data-testid="passkey-item"
              >
                <span className="text-sm font-medium text-black truncate">{cred.deviceLabel}</span>
                <span className="text-xs text-neutral-400 shrink-0">
                  {formatDate(cred.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mb-10 h-px w-full bg-neutral-100" />

      {/* ── Section 2: Register another passkey ── */}
      <section aria-labelledby="register-passkey-heading" className="mb-10">
        <h2 id="register-passkey-heading" className="text-base font-semibold text-black mb-1">
          Register another passkey
        </h2>
        <p className="text-sm text-neutral-500 mb-4">
          Add a passkey from another device so you can sign in from multiple places.
        </p>
        <RegisterPasskeyForm />
      </section>

      <div className="mb-10 h-px w-full bg-neutral-100" />

      {/* ── Section 3: Recovery code ── */}
      <section aria-labelledby="recovery-heading" className="mb-10">
        <h2 id="recovery-heading" className="text-base font-semibold text-black mb-1">
          Recovery code
        </h2>
        <RegenerateRecoveryCode />
      </section>
    </div>
  )
}
