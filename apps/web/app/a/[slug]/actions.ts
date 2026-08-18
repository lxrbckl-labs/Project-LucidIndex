'use server'

/**
 * Server actions for the article page (#66).
 *
 * Two actions:
 *
 *   - `toggleStar(articleId)` — admin-only. Flips `articles.starred`
 *     and revalidates all pages that reflect the starred state so a
 *     fresh visit reflects the new state everywhere:
 *       - `/a/<slug>` ('page') — the article detail page star button
 *       - `/` — the dashboard (star button initialStarred prop)
 *       - `/starred` — appears/disappears from the starred list
 *       - `/favorites` — appears/disappears from the favorites list
 *     The button is hidden for unauthenticated visitors at the page
 *     level, so the auth guard here is defense-in-depth.
 *
 *   - `markRead(articleId)` — admin-only. Sets `articles.read = true`
 *     IF the article isn't already read. Called from the article page's
 *     server component on render; the `WHERE read = false` clause keeps
 *     repeat visits from issuing a no-op write on every page load.
 *
 * Mock-mode behavior: under `LUCIDINDEX_MOCK=1` the actions mutate the
 * in-process mock array. That lets the visual gate exercise the star
 * toggle without booting a real DB. Mock mutations don't survive a
 * server restart — that's fine for development, and matches how the
 * dashboard's mock data behaves elsewhere.
 *
 * `requireAdmin` returns null when no session is present; we return
 * early without throwing so a misbehaving client (e.g. an unauthed
 * visitor manually invoking the action) is silently rejected. The
 * server-action endpoint still returns 200 — the client doesn't care
 * either way because the optimistic UI is local.
 */

import { requireAdmin } from '@lucidindex/auth'
import { db } from '@lucidindex/db/client'
import { and, eq } from '@lucidindex/db/query'
import { articles } from '@lucidindex/db/schema'
import { revalidatePath } from 'next/cache'
import { mockArticles } from '@/app/_mock/articles'

const MOCK_MODE = process.env.LUCIDINDEX_MOCK === '1'

export async function toggleStar(articleId: string, slug: string): Promise<void> {
  const session = await requireAdmin()
  if (!session) return

  if (MOCK_MODE) {
    // In mock mode the article id is the mock's `id`, which is a stable
    // `m-NNN` string — find by id, flip in place.
    const article = mockArticles.find((a) => a.id === articleId)
    if (article) {
      article.starred = !(article.starred ?? false)
    }
    revalidatePath(`/a/${slug}`, 'page')
    revalidatePath('/')
    revalidatePath('/starred')
    revalidatePath('/favorites')
    return
  }

  // Real DB — read current value, flip, write back. Two trips is fine
  // because star-toggles are infrequent; a SQL-side `NOT starred`
  // expression would be cleaner but drizzle's update DSL doesn't
  // express that ergonomically without a raw SQL escape, and clarity
  // wins over a single round-trip for an admin-only action.
  const rows = await db
    .select({ starred: articles.starred })
    .from(articles)
    .where(eq(articles.id, articleId))
    .limit(1)
  const current = rows[0]?.starred ?? false
  await db.update(articles).set({ starred: !current }).where(eq(articles.id, articleId))
  // Revalidate all pages that reflect starred state:
  //   - article detail ('page' type required for dynamic routes in Next.js 15)
  //   - dashboard (star button initialStarred prop reflects DB truth on re-render)
  //   - /starred and /favorites (article appears/disappears from these lists)
  revalidatePath(`/a/${slug}`, 'page')
  revalidatePath('/')
  revalidatePath('/starred')
  revalidatePath('/favorites')
}

export async function markRead(articleId: string): Promise<void> {
  const session = await requireAdmin()
  if (!session) return

  if (MOCK_MODE) {
    const article = mockArticles.find((a) => a.id === articleId)
    if (article && !article.read) {
      article.read = true
    }
    return
  }

  // `read = true` becomes a no-op when the row is already read — the
  // narrow `WHERE id = $1 AND read = false` clause means we don't issue
  // a write for the common "revisit a known-read article" case. No
  // revalidate: the read flag is visually invisible on the article
  // page itself, and the dashboard read-state styling will pick up the
  // change on its own next render.
  await db
    .update(articles)
    .set({ read: true })
    .where(and(eq(articles.id, articleId), eq(articles.read, false)))
}
