/**
 * Settings → Off-site backup (Phase 2, #37)
 *
 * Config-only form for the rclone remote that receives nightly DB dumps.
 * No rclone execution — that lands in Phase 7 (#76).
 *
 * Page structure:
 *   1. Status panel (read-only) — last shipment timestamp + status from
 *      `cron_runs` WHERE job = 'off_site_backup'. Will always show "No
 *      shipments yet" until Phase 7 ships.
 *   2. Config form — remote name + credentials blob (AES-256-GCM at rest).
 */

import { requireAdmin } from '@lucidindex/auth'
import { redirect } from 'next/navigation'
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

  // Load current config + last cron run in parallel.
  const [config, shipmentStatus] = await Promise.all([
    getOffSiteBackupConfig(),
    getLastShipmentStatus(),
  ])

  const lastRun = shipmentStatus.lastRun

  return (
    <div className="max-w-[640px]">
      {/* Page header */}
      <p className="text-xs uppercase tracking-wide text-neutral-400 mb-2">Phase 2</p>
      <h1
        className="text-[clamp(2rem,5vw,3.5rem)] font-black tracking-tight leading-none text-black uppercase"
        style={{ fontStretch: 'condensed', letterSpacing: '-0.02em' }}
      >
        Off-site backup
      </h1>
      <div className="mt-6 mb-10 h-px w-full bg-neutral-200" />

      {/* ── Section 1: Status panel ── */}
      <section aria-labelledby="shipment-status-heading" className="mb-10">
        <h2 id="shipment-status-heading" className="text-base font-semibold text-black mb-3">
          Last shipment
        </h2>
        <div
          className="border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm"
          data-testid="shipment-status-panel"
        >
          {lastRun ? (
            <p>
              <span className="font-medium">{formatTimestamp(lastRun.startedAt)}</span>
              {' — '}
              <span
                className={lastRun.status === 'succeeded' ? 'text-emerald-700' : 'text-red-600'}
              >
                {lastRun.status}
              </span>
            </p>
          ) : (
            <p className="text-neutral-500">
              No shipments yet — Phase 7 (#76) wires the nightly rclone cron job.
            </p>
          )}
        </div>
      </section>

      <div className="mb-10 h-px w-full bg-neutral-100" />

      {/* ── Section 2: Config form ── */}
      <section aria-labelledby="config-heading" className="mb-10">
        <h2 id="config-heading" className="text-base font-semibold text-black mb-1">
          rclone remote configuration
        </h2>
        <p className="text-sm text-neutral-500 mb-6">
          Enter the rclone remote name and credentials block. The credentials are encrypted at rest
          (AES-256-GCM). Supported remotes: Backblaze B2, AWS S3 (or compatible), Tailscale-attached
          NAS — anything rclone supports.
        </p>

        <OffSiteBackupForm
          initialRemoteName={config.remoteName ?? ''}
          initialCredentialsBlob={config.credentialsBlob ?? ''}
        />
      </section>
    </div>
  )
}
