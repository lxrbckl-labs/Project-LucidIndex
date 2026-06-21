/**
 * Phase 1 acceptance test — the founding-admin smoke.
 *
 * Walks the admin's first encounter with a fresh LucidIndex install:
 *
 *   1. Public landing renders the LUCIDINDEX wordmark + the
 *      "Nothing has been filed yet." empty state.
 *   2. `/settings/found` renders the token-input gate. User pastes the
 *      founding token and clicks "Continue" to reach the passkey form.
 *      (The settings layout redirects from `/settings` to `/settings/found`
 *      when the `admins` table is empty.)
 *   3. Submitting name + a virtual-authenticator passkey claims
 *      the founding admin and shows the one-time recovery code.
 *      (Device label is auto-defaulted to "Founding device" — no UI input.)
 *   4. Subsequent visits to `/settings` from a fresh browser context
 *      (no session cookie) get gated to `/settings/login`, NOT
 *      `/settings/found` — confirms the `admins` table is non-empty and
 *      the layout's branch swap took effect.
 *
 * Pre-req: Docker daemon is running (we boot a throw-away Postgres
 * container) and Playwright's chromium is installed (handled by the
 * package's postinstall).
 */

import { expect, test } from '@playwright/test'
import { type StackHandle, startStack } from './support/dev-server'
import { setupVirtualAuthenticator } from './support/webauthn'

const FOUNDING_TOKEN = 'phase1-acceptance-test-token-do-not-use-in-prod'

let stack: StackHandle

test.beforeAll(async () => {
  stack = await startStack({ foundingToken: FOUNDING_TOKEN })
})

test.afterAll(async () => {
  if (stack) {
    await stack.teardown()
  }
})

test('founding-admin smoke: empty state -> claim -> recovery code -> /settings is gated', async ({
  browser,
}) => {
  const baseURL = stack.baseURL

  // -----------------------------------------------------------------------
  // 1. Public landing — wordmark + empty-state copy
  // -----------------------------------------------------------------------
  const publicCtx = await browser.newContext({ baseURL })
  const landing = await publicCtx.newPage()
  await landing.goto('/')
  // TopNav brand (a link) + the dialog-style empty-state heading.
  await expect(landing.getByRole('link', { name: 'LUCIDINDEX' })).toBeVisible()
  await expect(landing.getByRole('heading', { name: 'Nothing has been filed yet.' })).toBeVisible()
  await publicCtx.close()

  // -----------------------------------------------------------------------
  // 2. Founding-admin claim flow
  // -----------------------------------------------------------------------
  const claimCtx = await browser.newContext({ baseURL })
  const claim = await claimCtx.newPage()
  const auth = await setupVirtualAuthenticator(claim)

  // Navigate to the founding page — no token in the URL.
  // The settings layout redirects `/settings` to `/settings/found` when
  // the admins table is empty; we go directly to the canonical URL.
  await claim.goto('/settings/found')
  await expect(claim).toHaveURL(/\/settings\/found/)
  // FoundingGate swipe-card — token pane is the entry point.
  await expect(claim.getByTestId('founding-token-input')).toBeVisible()

  // Token pane — enter the founding token to unlock the create pane.
  await claim.getByTestId('founding-token-input').fill(FOUNDING_TOKEN)
  await claim.getByTestId('founding-token-submit').click()

  // Wait for the create pane to slide in and autofocus its name field — this
  // guarantees the pane is active (not the inert off-screen pane) before we
  // type, so the controlled input doesn't revert the fill.
  await expect(claim.getByTestId('founding-name')).toBeFocused()

  // Fill the form (name only — device label is auto-defaulted) and submit.
  await claim.getByTestId('founding-name').fill('Phase1 Acceptance')
  await claim.getByTestId('founding-submit').click()

  // The recovery-code modal is shown once, BEFORE the session is minted.
  // We assert both the modal and the code element render.
  const recoveryCode = claim.getByTestId('recovery-code')
  await expect(claim.getByTestId('recovery-modal')).toBeVisible()
  await expect(recoveryCode).toBeVisible()
  const code = (await recoveryCode.textContent())?.trim() ?? ''
  // Recovery codes are non-trivial strings — sanity-check it's not the
  // empty placeholder, without pinning a specific format.
  expect(code.length).toBeGreaterThan(8)

  // Dismiss the modal — this triggers `finalizeSession` and mints the
  // session cookie, then the form's `onSuccess` redirects to `/settings`.
  await claim.getByTestId('recovery-dismiss').click()
  await claim.waitForURL(/\/settings(\/|$)/, { timeout: 30_000 })

  await auth.cleanup()
  await claimCtx.close()

  // -----------------------------------------------------------------------
  // 3. Fresh context (no session) hitting /settings renders the LOGIN gate
  //    inline (admins is now non-empty), NOT the founding gate. The layout
  //    renders the gate inline rather than redirecting (avoids the soft-nav
  //    replaceState loop), so the URL stays at /settings.
  // -----------------------------------------------------------------------
  const gateCtx = await browser.newContext({ baseURL })
  const gate = await gateCtx.newPage()
  await gate.goto('/settings')
  await expect(gate.getByTestId('login-submit')).toBeVisible()
  await expect(gate.getByTestId('founding-token-input')).toHaveCount(0)
  await gateCtx.close()
})
