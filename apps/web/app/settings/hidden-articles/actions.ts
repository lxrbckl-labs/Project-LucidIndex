'use server'

/**
 * Server actions for Settings → Hidden articles (#78).
 *
 * One action: `restoreArticle(articleId)`. Sets `articles.hidden = false`
 * and `articles.hidden_at = null`, then revalidates the settings panel
 * (so the row drops out of the list) and the dashboard (so the article
 * reappears on `/`, subject to the dashboard-visible filter).
 *
 * Auth: passkey-gated via `requireAdmin`. The Settings layout already
 * forces sign-in for every `/settings/*` route, but defense-in-depth
 * here ensures a misbehaving client (e.g. an unauthed visitor manually
 * invoking the action) is silently rejected.
 *
 * Mock-mode behavior: under `LUCIDINDEX_MOCK=1` the action mutates the
 * in-process mock array. Mutations don't survive a server restart —
 * fine for development, matches how `hideArticle` and `toggleStar`
 * already behave.
 *
 * No undo: this PR does not add a "re-hide" path from the dashboard;
 * the article goes back to being visible and the admin can re-hide it
 * via the article page if needed.
 */

import { requireAdmin } from '@lucidindex/auth'
import { db } from '@lucidindex/db/client'
import { eq } from '@lucidindex/db/query'
import { articles } from '@lucidindex/db/schema'
import { revalidatePath } from 'next/cache'
import { mockArticles } from '@/app/_mock/articles'

const MOCK_MODE = process.env.LUCIDINDEX_MOCK === '1'

export async function restoreArticle(articleId: string): Promise<void> {
  const session = await requireAdmin()
  if (!session) return

  if (MOCK_MODE) {
    const article = mockArticles.find((a) => a.id === articleId)
    if (article) {
      article.hidden = false
    }
    revalidatePath('/settings/hidden-articles')
    revalidatePath('/')
    return
  }

  await db.update(articles).set({ hidden: false, hiddenAt: null }).where(eq(articles.id, articleId))

  revalidatePath('/settings/hidden-articles')
  revalidatePath('/')
}
