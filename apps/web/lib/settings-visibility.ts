'use client'

/**
 * Settings-button visibility — a hidden-admin-entrance gate.
 *
 * The TopNav Settings (gear) button is HIDDEN by default for everyone. It only
 * appears once the visitor has "unlocked" it by loading any URL with
 * `?settings=true`. The unlock is sticky — persisted in localStorage — so it
 * survives normal navigation (links without the param) until it's explicitly
 * locked again with `?settings=false`.
 *
 *   /                  → no gear (default)
 *   /?settings=true    → gear appears, and is remembered
 *   /a/foo  (later)    → gear still there
 *   /?settings=false   → gear hidden again
 *
 * This is obscurity, not security: /settings itself stays passkey-gated. It
 * just keeps the admin entrance off the chrome for ordinary visitors.
 */

import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

const STORAGE_KEY = 'lucidindex:settings-unlocked'

export function useSettingsUnlocked(): boolean {
  const searchParams = useSearchParams()
  // Start false so SSR and the first client render agree (no hydration
  // mismatch); the effects below flip it on if the flag/param says so.
  const [unlocked, setUnlocked] = useState(false)

  // Read the persisted flag once on mount.
  useEffect(() => {
    try {
      setUnlocked(window.localStorage.getItem(STORAGE_KEY) === '1')
    } catch {
      // localStorage unavailable (private mode, etc.) — stay locked.
    }
  }, [])

  // React to the `?settings=` param: `true` unlocks + persists, `false` locks +
  // clears. Any other value (or absence) leaves the persisted state untouched.
  useEffect(() => {
    const param = searchParams.get('settings')
    if (param === 'true') {
      try {
        window.localStorage.setItem(STORAGE_KEY, '1')
      } catch {}
      setUnlocked(true)
    } else if (param === 'false') {
      try {
        window.localStorage.removeItem(STORAGE_KEY)
      } catch {}
      setUnlocked(false)
    }
  }, [searchParams])

  return unlocked
}
