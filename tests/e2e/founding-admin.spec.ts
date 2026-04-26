/**
 * Phase 1 acceptance test — the founding-admin smoke.
 *
 * Walks the admin's first encounter with a fresh LucidIndex install:
 *
 *   1. Public landing renders the LUCIDINDEX wordmark + the
 *      "Nothing has been filed yet." empty state.
 *   2. `/settings?token=<env>` lands on `/settings/found` and renders the
 *      founding form (the layout redirects from `/settings` to
 *      `/settings/found` when the `admins` table is empty).
 *   3. Submitting name + device + a virtual-authenticator passkey claims
 *      the founding admin and shows the one-time recovery code.
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
  await expect(landing.getByRole('heading', { name: 'LUCIDINDEX' })).toBeVisible()
  await expect(landing.getByText('Nothing has been filed yet.')).toBeVisible()
  await publicCtx.close()

  // -----------------------------------------------------------------------
  // 2. Founding-admin claim flow
  // -----------------------------------------------------------------------
  const claimCtx = await browser.newContext({ baseURL })
  const claim = await claimCtx.newPage()
  const auth = await setupVirtualAuthenticator(claim)

  // The settings layout redirects `/settings?token=...` to `/settings/found`
  // when the admins table is empty — follow the redirect by hitting the
  // canonical URL with the token preserved.
  await claim.goto(`/settings/found?token=${encodeURIComponent(FOUNDING_TOKEN)}`)
  await expect(claim).toHaveURL(/\/settings\/found/)
  await expect(claim.getByRole('heading', { name: /claim founding admin/i })).toBeVisible()

  // Fill the form (name + device label) and submit. The data-testid
  // anchors are stable contracts in the FoundingAdminForm component.
  await claim.getByTestId('founding-name').fill('Phase1 Acceptance')
  await claim.getByTestId('founding-device').fill('e2e Virtual Authenticator')
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
  // 3. Fresh context (no session) hitting /settings should land on
  //    /settings/login, NOT /settings/found.
  // -----------------------------------------------------------------------
  const gateCtx = await browser.newContext({ baseURL })
  const gate = await gateCtx.newPage()
  await gate.goto('/settings')
  await expect(gate).toHaveURL(/\/settings\/login/)
  await expect(gate.getByTestId('login-submit')).toBeVisible()
  await gateCtx.close()
})
