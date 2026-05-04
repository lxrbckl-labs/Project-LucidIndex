/**
 * Settings → Account
 *
 * Three sections:
 *   1. Registered passkeys — list of credentials for the authenticated admin.
 *   2. Register another passkey — WebAuthn registration ceremony for a new device.
 *   3. Recovery code — one-time-display regeneration with burned-old-code semantics.
 */

import { getAdminCredentials, requireAdmin } from '@lucidindex/auth'
import { redirect } from 'next/navigation'
import { Separator } from '@/components/ui/separator'
import { RegenerateRecoveryCode } from './_components/RegenerateRecoveryCode'
import { RegisterPasskeyForm } from './_components/RegisterPasskeyForm'

// Session-gated + DB-backed — never statically renderable.
export const dynamic = 'force-dynamic'

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
    <div className="max-w-[640px] flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your passkeys and recovery code.
        </p>
      </div>

      <Separator />

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold">Registered passkeys</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Passkeys enrolled on this LucidIndex instance.
          </p>
        </div>
        {creds.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No passkeys registered yet.
          </div>
        ) : (
          <ul className="divide-y border-y" data-testid="passkey-list">
            {creds.map((cred) => (
              <li
                key={cred.id}
                className="flex items-center justify-between py-3 gap-4"
                data-testid="passkey-item"
              >
                <span className="text-sm font-medium text-foreground truncate">
                  {cred.deviceLabel}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {formatDate(cred.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Separator />

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold">Register a passkey</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Add a passkey from another device so you can sign in from multiple places.
          </p>
        </div>
        <RegisterPasskeyForm />
      </section>

      <Separator />

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold">Recovery code</h2>
        </div>
        <RegenerateRecoveryCode />
      </section>
    </div>
  )
}
