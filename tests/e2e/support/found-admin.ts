/**
 * Shared e2e helper: found the first admin via the "Generate token" flow.
 *
 * On a fresh stack (admins empty) this navigates to /settings, clicks
 * "Generate token" (which mints the reusable `lipc_` passcode and signs in),
 * captures the passcode, then enrolls a passkey via the virtual authenticator
 * and waits to land on the authenticated /settings.
 *
 * Returns the plaintext `passcode` (the reusable backup-login secret — also a
 * burnable recovery code) and `cleanup` for the virtual authenticator. Callers
 * that don't need the passcode can ignore it; call `cleanup()` at test end.
 */

import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { setupVirtualAuthenticator } from './webauthn'

export type FoundedAdmin = {
  passcode: string
  cleanup: () => Promise<void>
}

export async function foundAdmin(page: Page): Promise<FoundedAdmin> {
  const auth = await setupVirtualAuthenticator(page)

  await page.goto('/settings')
  await page.getByTestId('founding-generate').click()

  const passcodeEl = page.getByTestId('founding-passcode')
  await expect(passcodeEl).toBeVisible()
  const passcode = (await passcodeEl.textContent())?.trim() ?? ''

  await page.getByTestId('founding-enroll-passkey').click()
  await page.waitForURL(/\/settings(\/|$)/, { timeout: 30_000 })

  return { passcode, cleanup: auth.cleanup }
}
