/**
 * One-shot smoke: call the mcp-forum `readPost` tool directly (no HTTP
 * transport, no real auth context) to confirm:
 *   - calling it once inserts a `forum_post_views` row for the supplied
 *     viewer,
 *   - calling it twice with the same (post_id, viewer_user_id) is an
 *     idempotent no-op (ON CONFLICT DO NOTHING),
 *   - the returned `post.view_count` reflects the running tally,
 *   - the description published by the tool registration now mentions
 *     that reads record a view (visual confirmation in the running
 *     server happens elsewhere — here we just exercise the body).
 *
 * Run via tsx from inside packages/db (tsx is installed there).
 */

import postgres from 'postgres'
import { readPost } from '../apps/mcp-forum/src/tools/read-post.ts'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL missing')
  const postId = process.argv[2]
  const viewerUserId = process.argv[3]
  const viewerUsername = process.argv[4] ?? 'smoke-agent'
  if (!postId || !viewerUserId) {
    throw new Error(
      'usage: tsx scripts/mcp-smoke-read-post.ts <post_id> <viewer_user_id> [username]',
    )
  }

  const sql = postgres(url, { max: 2 })

  // Clean baseline for this (post, viewer) pair so the test is
  // deterministic. NOT a production behavior — agents never DELETE
  // rows from forum_post_views; this is sentinel cleanup only.
  await sql`
    DELETE FROM forum_post_views
    WHERE post_id = ${postId}::uuid AND viewer_user_id = ${viewerUserId}::uuid
  `
  const before = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM forum_post_views WHERE post_id = ${postId}::uuid
  `

  // First call — should insert the view + return count including it.
  const r1 = await readPost({
    post_id: postId,
    forumUserId: viewerUserId,
    username: viewerUsername,
  })

  const afterOne = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM forum_post_views WHERE post_id = ${postId}::uuid
  `

  // Second call — should be idempotent: same row in DB, same view_count
  // returned.
  const r2 = await readPost({
    post_id: postId,
    forumUserId: viewerUserId,
    username: viewerUsername,
  })

  const afterTwo = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM forum_post_views WHERE post_id = ${postId}::uuid
  `

  process.stdout.write(
    JSON.stringify(
      {
        before: before[0]?.count,
        afterFirstCall: afterOne[0]?.count,
        afterSecondCall: afterTwo[0]?.count,
        firstCallViewCount: r1.post.view_count,
        secondCallViewCount: r2.post.view_count,
        post_id_returned: r1.post.id,
        title_returned: r1.post.title,
      },
      null,
      2,
    ),
  )
  process.stdout.write('\n')

  await sql.end()
}

main().catch((err) => {
  // biome-ignore lint/suspicious/noConsole: one-shot CLI
  console.error(err)
  process.exit(1)
})
