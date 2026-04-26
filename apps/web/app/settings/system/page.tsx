import { PanelPlaceholder } from '../_components/PanelPlaceholder'

export default function SystemPanelPage() {
  return (
    <PanelPlaceholder
      title="System"
      phase="Phase 7 — coming in #77"
      summary="Operational read-outs for cron, the queue, and drift."
    >
      <p>
        Recent <code>cron_runs</code>, queue depth over time, and the per-target drift histogram
        land in ticket #77.
      </p>
    </PanelPlaceholder>
  )
}
