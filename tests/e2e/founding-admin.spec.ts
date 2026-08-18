/**
 * Founding-admin smoke — the passcode-first "Generate token" flow.
 *
 * Walks the admin's first encounter with a fresh LucidIndex install:
 *
 *   1. Public landing renders the LUCIDINDEX wordmark + the
 *      "Nothing has been filed yet." empty state.
 *   2. `/settings` (admins empty) renders "Claim Admin" with a Generate-token
 *      button — no env-var token gate. Clicking it mints a reusable `lipc_`
 *      passcode (shown once) and signs in; enrolling a virtual-authenticator
 *      passkey then lands on `/settings`.
 *   3. A fresh browser context (no session) hitting `/settings` now gets the
 *      LOGIN gate inline (admins is non-empty), NOT the founding gate.
 *
 * Pre-req: Docker daemon is running (throw-away Postgres) and Playwright's
 * chromium is installed.
 */

import { expect, test } from '@playwright/test'
import { type StackHandle, startStack } from './support/dev-server'
import { setupVirtualAuthenticator } from './support/webauthn'

let stack: StackHandle

test.beforeAll(async () => {
  stack = await startStack()
})

test.afterAll(async () => {
  if (stack) {
    await stack.teardown()
  }
})

test('founding-admin smoke: empty state -> generate token -> passkey -> /settings gated', async ({
  browser,
}) => {
  const baseURL = stack.baseURL

  // -----------------------------------------------------------------------
  // 1. Public landing — wordmark + empty-state copy
  // -----------------------------------------------------------------------
  const publicCtx = await browser.newContext({ baseURL })
  const landing = await publicCtx.newPage()
  await landing.goto('/')
  await expect(landing.getByRole('link', { name: 'LUCIDINDEX' })).toBeVisible()
  await expect(landing.getByRole('heading', { name: 'Nothing has been filed yet.' })).toBeVisible()
  await publicCtx.close()

  // -----------------------------------------------------------------------
  // 2. Founding-admin claim flow — Generate token, then enroll a passkey
  // -----------------------------------------------------------------------
  const claimCtx = await browser.newContext({ baseURL })
  const claim = await claimCtx.newPage()
  const auth = await setupVirtualAuthenticator(claim)

  // The settings layout renders the founding gate inline at any signed-out
  // /settings/* path while the admins table is empty (no redirect).
  await claim.goto('/settings')
  await expect(claim.getByTestId('founding-generate')).toBeVisible()

  // Generate the admin token — claims the admin, mints the passcode, signs in.
  await claim.getByTestId('founding-generate').click()

  // The passcode is shown once, on the next pane. It's the reusable lipc_
  // backup-login secret.
  const passcode = claim.getByTestId('founding-passcode')
  await expect(passcode).toBeVisible()
  const code = (await passcode.textContent())?.trim() ?? ''
  expect(code).toMatch(/^lipc_/)

  // Enroll a passkey via the virtual authenticator — on success the gate
  // redirects to the authenticated /settings.
  await claim.getByTestId('founding-enroll-passkey').click()
  await claim.waitForURL(/\/settings(\/|$)/, { timeout: 30_000 })

  await auth.cleanup()
  await claimCtx.close()

  // -----------------------------------------------------------------------
  // 3. Fresh context (no session) hitting /settings renders the LOGIN gate
  //    inline (admins is now non-empty), NOT the founding gate.
  // -----------------------------------------------------------------------
  const gateCtx = await browser.newContext({ baseURL })
  const gate = await gateCtx.newPage()
  await gate.goto('/settings')
  await expect(gate.getByTestId('login-submit')).toBeVisible()
  await expect(gate.getByTestId('founding-generate')).toHaveCount(0)
  await gateCtx.close()
})
