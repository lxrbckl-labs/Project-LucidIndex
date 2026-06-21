/**
 * Phase 2 acceptance test — Settings → Off-site backup config form (#37).
 *
 * Exercises:
 *   1. Unauthenticated GET + POST to /api/settings/off-site-backup → 401.
 *   2. Boot fresh stack, claim founding admin.
 *   3. /settings/off-site-backup renders the page with the status panel
 *      ("No shipments yet") and the empty config form.
 *   4. Fill in remote name + credentials blob → Save → "Configuration saved"
 *      banner appears.
 *   5. Reload the page → form pre-populates with the saved values (confirms
 *      round-trip: encrypt on write, decrypt on read).
 *   6. Clear both fields → Save → form now shows empty fields on reload.
 *
 * Config-only — no rclone execution is tested here (Phase 7 #76).
 */

import { type APIRequestContext, expect, request, test } from '@playwright/test'
import { type StackHandle, startStack } from './support/dev-server'
import { foundAdmin } from './support/found-admin'

let stack: StackHandle

test.beforeAll(async () => {
  stack = await startStack()
})

test.afterAll(async () => {
  if (stack) {
    await stack.teardown()
  }
})

test('settings/off-site-backup: 401s, save + read-back, clear', async ({ browser }) => {
  const baseURL = stack.baseURL

  // -----------------------------------------------------------------------
  // 0. Unauthenticated API calls must return 401.
  // -----------------------------------------------------------------------
  const anonReq: APIRequestContext = await request.newContext({ baseURL })
  for (const method of ['GET', 'POST'] as const) {
    const res = await anonReq.fetch('/api/settings/off-site-backup', { method })
    expect(res.status(), `${method} /api/settings/off-site-backup should require auth`).toBe(401)
  }
  await anonReq.dispose()

  // -----------------------------------------------------------------------
  // 1. Claim founding admin.
  // -----------------------------------------------------------------------
  const ctx = await browser.newContext({ baseURL })
  const page = await ctx.newPage()
  const auth = await foundAdmin(page)

  // Wait until the session is confirmed.
  await expect
    .poll(
      async () => {
        const r = await page.request.get('/api/auth/session')
        return r.status()
      },
      { timeout: 15_000 },
    )
    .toBe(200)

  // -----------------------------------------------------------------------
  // 2. Navigate to the off-site-backup panel — verify the page renders.
  // -----------------------------------------------------------------------
  await page.goto('/settings/off-site-backup')
  await expect(page.getByRole('heading', { name: /off-site backup/i })).toBeVisible()

  // Status panel: no cron runs yet → shows the Phase 7 placeholder copy.
  await expect(page.getByTestId('shipment-status-panel')).toContainText('No shipments yet')

  // Form fields are visible and empty on a fresh install.
  const remoteInput = page.getByTestId('remote-name-input')
  const credsBlobInput = page.getByTestId('credentials-blob-input')
  await expect(remoteInput).toBeVisible()
  await expect(credsBlobInput).toBeVisible()
  await expect(remoteInput).toHaveValue('')
  await expect(credsBlobInput).toHaveValue('')

  // -----------------------------------------------------------------------
  // 3. Fill the form and save.
  // -----------------------------------------------------------------------
  const testRemoteName = 'b2-backup-test'
  const testCreds = '[b2-backup-test]\ntype = b2\naccount = TEST_ACCOUNT\nkey = TEST_KEY'

  await remoteInput.fill(testRemoteName)
  await credsBlobInput.fill(testCreds)
  await page.getByTestId('save-button').click()

  // The saved confirmation banner should appear.
  await expect(page.getByTestId('saved-banner')).toBeVisible({ timeout: 10_000 })

  // -----------------------------------------------------------------------
  // 4. Reload to confirm the values round-trip (encrypt → decrypt → form).
  // -----------------------------------------------------------------------
  await page.reload()
  await expect(page.getByTestId('remote-name-input')).toHaveValue(testRemoteName)
  await expect(page.getByTestId('credentials-blob-input')).toHaveValue(testCreds)

  // -----------------------------------------------------------------------
  // 5. Clear both fields and save — confirm they come back empty on reload.
  // -----------------------------------------------------------------------
  await page.getByTestId('remote-name-input').fill('')
  await page.getByTestId('credentials-blob-input').fill('')
  await page.getByTestId('save-button').click()
  await expect(page.getByTestId('saved-banner')).toBeVisible({ timeout: 10_000 })

  await page.reload()
  await expect(page.getByTestId('remote-name-input')).toHaveValue('')
  await expect(page.getByTestId('credentials-blob-input')).toHaveValue('')

  await auth.cleanup()
  await ctx.close()
})
