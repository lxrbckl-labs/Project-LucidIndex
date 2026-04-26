import { PanelPlaceholder } from '../_components/PanelPlaceholder'

export default function OffSiteBackupPanelPage() {
  return (
    <PanelPlaceholder
      title="Off-site backup"
      phase="Phase 2 — coming in #37"
      summary="Configure the rclone remote that receives nightly DB dumps."
    >
      <p>
        rclone remote configuration form (provider, bucket, credentials), test-connection button,
        and last-run status land in ticket #37.
      </p>
    </PanelPlaceholder>
  )
}
