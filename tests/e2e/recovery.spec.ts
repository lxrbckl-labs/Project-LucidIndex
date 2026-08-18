/**
 * Passkey-recovery acceptance test.
 *
 * Walks the "I lost my passkey" path end-to-end against a throw-away stack:
 *
 *   1. Found an admin (reusing the founding flow) and capture the one-time
 *      recovery code shown at enrollment.
 *   2. From a FRESH browser context (no session, no passkey — i.e. a new /
 *      wiped device), follow the "Lost your passkey?" link from the login page
 *      to /settings/recover.
 *   3. Enter the captured recovery code. A virtual authenticator enrolls a NEW
 *      passkey, a fresh recovery code is shown once, and dismissing the modal
 *      mints the session and lands on /settings — genuinely recovered.
 *   4. The original code is now burned: re-attempting recovery with it fails
 *      and stays on the recover page.
 *
 * Pre-req: Docker daemon running (throw-away Postgres) + Playwright chromium
 * (handled by the package postinstall). Mirrors `founding-admin.spec.ts`.
 */

import { expect, test } from '@playwright/test'
import { type StackHandle, startStack } from './support/dev-server'
import { foundAdmin } from './support/found-admin'
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

test('recovery: found -> lose device -> recover with code -> signed in, old code burned', async ({
  browser,
}) => {
  const baseURL = stack.baseURL

  // -----------------------------------------------------------------------
  // 1. Found the admin and capture the one-time recovery code.
  // -----------------------------------------------------------------------
  const claimCtx = await browser.newContext({ baseURL })
  const claim = await claimCtx.newPage()

  // Found via the Generate-token flow; the passcode is also a burnable
  // recovery code, which the recovery flow below consumes + rotates.
  const { passcode: originalCode, cleanup: claimCleanup } = await foundAdmin(claim)
  expect(originalCode).toMatch(/^lipc_/)

  await claimCleanup()
  await claimCtx.close()

  // -----------------------------------------------------------------------
  // 2 + 3. Fresh device (no session, no passkey) — recover with the code.
  // -----------------------------------------------------------------------
  const recoverCtx = await browser.newContext({ baseURL })
  const recover = await recoverCtx.newPage()
  const recoverAuth = await setupVirtualAuthenticator(recover)

  // Follow the entry point a real user would: login page -> "Lost your passkey?"
  await recover.goto('/settings/login')
  await recover.getByTestId('recover-link').click()
  await expect(recover).toHaveURL(/\/settings\/recover/)

  await recover.getByTestId('recovery-code-input').fill(originalCode)
  await recover.getByTestId('recovery-submit').click()

  // A fresh recovery code is shown once, before the session is minted.
  await expect(recover.getByTestId('recovery-modal')).toBeVisible()
  const newCode = (await recover.getByTestId('recovery-code').textContent())?.trim() ?? ''
  expect(newCode.length).toBeGreaterThan(8)
  expect(newCode).not.toBe(originalCode)

  // Dismiss -> finalize session -> land on /settings, signed in.
  await recover.getByTestId('recovery-dismiss').click()
  await recover.waitForURL(/\/settings(\/|$)/, { timeout: 30_000 })
  await recoverAuth.cleanup()
  await recoverCtx.close()

  // -----------------------------------------------------------------------
  // 4. The original code is burned — a fresh attempt with it must fail.
  // -----------------------------------------------------------------------
  const replayCtx = await browser.newContext({ baseURL })
  const replay = await replayCtx.newPage()
  await setupVirtualAuthenticator(replay)

  await replay.goto('/settings/recover')
  await replay.getByTestId('recovery-code-input').fill(originalCode)
  await replay.getByTestId('recovery-submit').click()

  // Stays on the recover page (no modal, no redirect) — the burned code is rejected.
  await expect(replay.getByText(/didn't match/i)).toBeVisible()
  await expect(replay).toHaveURL(/\/settings\/recover/)
  await expect(replay.getByTestId('recovery-modal')).toBeHidden()
  await replayCtx.close()
})
