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
    <div className="max-w-[640px] flex flex-col gap-6">
      {/* Page header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your passkeys and recovery code.
        </p>
      </div>

      {/* ── Section 1: Registered passkeys ── */}
      <Card>
        <CardHeader>
          <CardTitle>Registered passkeys</CardTitle>
          <CardDescription>Passkeys enrolled on this LucidIndex instance.</CardDescription>
        </CardHeader>
        <CardContent>
          {creds.length === 0 ? (
            <p className="text-sm text-muted-foreground">No passkeys registered yet.</p>
          ) : (
            <ul
              className="divide-y divide-border border-t border-border"
              data-testid="passkey-list"
            >
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

      {/* ── Section 2: Register another passkey ── */}
      <RegisterPasskeyForm />

      {/* ── Section 3: Recovery code ── */}
      <Card>
        <CardHeader>
          <CardTitle>Recovery code</CardTitle>
        </CardHeader>
        <CardContent>
          <RegenerateRecoveryCode />
        </CardContent>
      </Card>
    </div>
  )
}
