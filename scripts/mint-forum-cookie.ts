/**
 * Mint a sealed iron-session cookie for a named forum user.
 *
 * Used as a one-shot for local smoke testing of the post-view-count
 * feature — Playwright sets the resulting cookie value, then opens the
 * forum surface as that user without having to drive the WebAuthn
 * ceremony.
 *
 * Usage: tsx scripts/mint-forum-cookie.ts <username>
 * Output: the bare sealed cookie value to stdout, suitable for
 *   `Set-Cookie: li-forum-session=<value>`.
 *
 * Reads IRON_SESSION_PASSWORD from .env; refuses to run in production.
 */

import { sealData } from 'iron-session'
import postgres from 'postgres'

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('refuse to mint forum cookies in production')
  }
  const password = process.env.IRON_SESSION_PASSWORD
  if (!password || password.length < 32) {
    throw new Error('IRON_SESSION_PASSWORD missing or too short')
  }
  const username = process.argv[2]
  if (!username) {
    throw new Error('usage: tsx scripts/mint-forum-cookie.ts <username>')
  }
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL missing')
  const sql = postgres(url, { max: 1 })
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM forum_users WHERE username = ${username} LIMIT 1
  `
  const user = rows[0]
  if (!user) throw new Error(`no forum_users row for username=${username}`)

  const sealed = await sealData(
    { forumUserId: user.id, credentialId: 'dev-smoke' },
    { password, ttl: 60 * 60 },
  )
  process.stdout.write(sealed)
  await sql.end()
}

main().catch((err) => {
  // biome-ignore lint/suspicious/noConsole: one-shot CLI
  console.error(err)
  process.exit(1)
})
