/**
 * Virtual WebAuthn authenticator helpers.
 *
 * Chromium exposes a `WebAuthn` CDP domain that lets us register a virtual
 * authenticator at runtime — `navigator.credentials.create()` and
 * `.get()` then resolve against it without any user interaction. This is
 * the standard pattern for testing passkey flows in headless Chromium and
 * is the only browser-supported way to do it; Firefox and WebKit don't
 * expose an equivalent surface (which is why our Playwright config pins
 * the chromium project).
 *
 * Options:
 *   - `protocol: 'ctap2'` — modern WebAuthn ceremony.
 *   - `transport: 'internal'` — looks like a platform authenticator
 *     (Touch ID / Face ID), so the server's `authenticatorAttachment`
 *     preferences don't filter us out.
 *   - `hasResidentKey: true` — discoverable credential, required because
 *     LucidIndex's login form doesn't ask for a username (the browser
 *     picks the credential).
 *   - `hasUserVerification: true` + `isUserVerified: true` — UV passes
 *     automatically; the WebAuthn server enforces UV in production.
 *   - `automaticPresenceSimulation: true` — no test-side
 *     `setUserVerified` call needed; Chromium signals presence on every
 *     ceremony.
 */

import type { Page } from '@playwright/test'

export type VirtualAuthenticator = {
  authenticatorId: string
  cleanup: () => Promise<void>
}

export async function setupVirtualAuthenticator(page: Page): Promise<VirtualAuthenticator> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })

  return {
    authenticatorId,
    cleanup: async () => {
      try {
        await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId })
      } catch {
        // Page may already be closed; harmless.
      }
      try {
        await cdp.detach()
      } catch {
        // Ditto.
      }
    },
  }
}
