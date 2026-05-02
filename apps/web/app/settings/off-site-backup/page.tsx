/**
 * Settings → Off-site backup (Phase 2, #37)
 * Rebuilt on shadcn primitives: Card + Alert for security note.
 */

import { requireAdmin } from '@lucidindex/auth'
import { redirect } from 'next/navigation'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { OffSiteBackupForm } from './_components/OffSiteBackupForm'
import { getLastShipmentStatus, getOffSiteBackupConfig } from './_lib/off-site-backup-repo'

export const dynamic = 'force-dynamic'

function formatTimestamp(d: Date): string {
  return `${d.toISOString().replace('T', ' ').slice(0, 16)} UTC`
}

export default async function OffSiteBackupPanelPage() {
  const session = await requireAdmin()
  if (!session) {
    redirect('/settings/login')
  }

  const [config, shipmentStatus] = await Promise.all([
    getOffSiteBackupConfig(),
    getLastShipmentStatus(),
  ])

  const lastRun = shipmentStatus.lastRun

  return (
    <div className="max-w-[640px] flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Off-site backup</h1>
        <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
          Configure the rclone remote that receives nightly DB dumps.
        </p>
      </div>

      {/* ── Section 1: Status panel ── */}
      <Card>
        <CardHeader>
          <CardTitle>Last shipment</CardTitle>
          <CardDescription>Most recent off-site backup run status.</CardDescription>
        </CardHeader>
        <CardContent data-testid="shipment-status-panel">
          {lastRun ? (
            <p className="text-sm">
              <span className="font-medium">{formatTimestamp(lastRun.startedAt)}</span>
              {' — '}
              <span
                className={lastRun.status === 'succeeded' ? 'text-emerald-700' : 'text-destructive'}
              >
                {lastRun.status}
              </span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No shipments yet — Phase 7 (#76) wires the nightly rclone cron job.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Section 2: Config form ── */}
      <Card>
        <CardHeader>
          <CardTitle>rclone remote configuration</CardTitle>
          <CardDescription>
            Enter the rclone remote name and credentials block. Supported remotes: Backblaze B2, AWS
            S3 (or compatible), Tailscale-attached NAS — anything rclone supports.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Alert>
            <AlertTitle>Credentials encrypted at rest</AlertTitle>
            <AlertDescription>
              The credentials blob is encrypted with AES-256-GCM, key derived from your session
              secret via HKDF. It is never logged or transmitted in plaintext.
            </AlertDescription>
          </Alert>

          <OffSiteBackupForm
            initialRemoteName={config.remoteName ?? ''}
            initialCredentialsBlob={config.credentialsBlob ?? ''}
          />
        </CardContent>
      </Card>
    </div>
  )
}
