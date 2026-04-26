/**
 * WebAuthn relying-party (RP) configuration.
 *
 * Ported from Project-Showalter (`src/features/auth/relying-party.ts`), with
 * one adaptation: Showalter derives RP ID + origin from a single `BASE_URL`
 * env var. LucidIndex reads them as two separate vars (`WEBAUTHN_RP_ID`,
 * `WEBAUTHN_ORIGIN`) so the RP can be configured independently of any
 * application base URL — useful when the app is fronted by a CDN or a
 * different host than the RP.
 *
 * `rpID` is the domain the credential is scoped to (no scheme, no port).
 * `origin` is the scheme + host + optional port the browser reports.
 *
 * Dev defaults: `localhost` + `http://localhost:3000`. Production values
 * are wired in by ticket #86.
 */

export type RelyingParty = {
  rpID: string
  rpName: string
  origin: string
}

const RP_NAME = 'LucidIndex'
const DEFAULT_RP_ID = 'localhost'
const DEFAULT_ORIGIN = 'http://localhost:3000'

export function getRelyingParty(): RelyingParty {
  const rpID = process.env.WEBAUTHN_RP_ID?.trim() || DEFAULT_RP_ID
  const origin = process.env.WEBAUTHN_ORIGIN?.trim() || DEFAULT_ORIGIN

  // Sanity-check the origin is a parseable URL — better to fail loud than
  // pass a junk value to @simplewebauthn/server.
  try {
    // eslint-disable-next-line no-new
    new URL(origin)
  } catch {
    throw new Error(`WEBAUTHN_ORIGIN is malformed: ${origin}`)
  }

  return { rpID, rpName: RP_NAME, origin }
}
