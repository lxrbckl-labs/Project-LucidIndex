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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
    <div className="flex flex-col gap-8">
      <div className="-mx-6 -mt-6 px-6 pt-6 pb-6 border-b">
        <h1 className="text-3xl font-bold tracking-tight">Account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your passkeys and recovery code.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 items-start">
        <Card>
          <CardHeader>
            <CardTitle>Registered passkeys</CardTitle>
            <CardDescription>Passkeys enrolled on this LucidIndex instance.</CardDescription>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Register a passkey</CardTitle>
              <CardDescription>
                Add a passkey from another device so you can sign in from multiple places.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RegisterPasskeyForm />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recovery code</CardTitle>
            </CardHeader>
            <CardContent>
              <RegenerateRecoveryCode />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
