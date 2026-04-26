import { PanelPlaceholder } from '../_components/PanelPlaceholder'

export default function AccountPanelPage() {
  return (
    <PanelPlaceholder
      title="Account"
      phase="Phase 2 — coming in #36"
      summary="Manage the passkeys on your account."
    >
      <p>
        Passkey list, register-another-device flow, and recovery-code regeneration land in ticket
        #36.
      </p>
    </PanelPlaceholder>
  )
}
