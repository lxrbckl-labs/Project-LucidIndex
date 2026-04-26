'use server'

/**
 * Server actions for the article page (#66, #69).
 *
 * Three actions:
 *
 *   - `toggleStar(articleId)` — admin-only. Flips `articles.starred`
 *     and revalidates the article page so a fresh visit reflects the
 *     new state. The button is hidden for unauthenticated visitors at
 *     the page level, so the auth guard here is defense-in-depth.
 *
 *   - `markRead(articleId)` — admin-only. Sets `articles.read = true`
 *     IF the article isn't already read. Called from the article page's
 *     server component on render; the `WHERE read = false` clause keeps
 *     repeat visits from issuing a no-op write on every page load.
 *
 *   - `hideArticle(articleId, slug)` — admin-only (#69). Sets
 *     `articles.hidden = true` and `articles.hidden_at = now()`.
 *     Revalidates the root path so the dashboard no longer shows the
 *     article. The article page itself will 404 on next visit (the
 *     loader filters `hidden = true` rows). Returns the caller to `/`
 *     via redirect after hiding (caller responsibility — the page uses
 *     `router.push('/')` after the action resolves).
 *
 *     Restoration UI is Phase 7 #78 (Settings → Hidden articles). For
 *     now, hidden articles are gone from all public surfaces but remain
 *     in the DB and are inspectable via the Drizzle studio or psql.
 *
 *     Note for Phase 7 #73 (search FTS): the `write_articles` FTS query
 *     will need to add `AND hidden = false` to exclude hidden articles
 *     from search results. This is a no-op today because search isn't
 *     built yet.
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
    revalidatePath(`/a/${slug}`)
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
  revalidatePath(`/a/${slug}`)
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

/**
 * hideArticle — admin-only (#69).
 *
 * Sets `hidden = true` and `hidden_at = now()` on the article row.
 * After calling this action the caller should redirect the user to `/`
 * because the article page will 404 on its next render (the loader
 * filters hidden rows). The redirect is caller-side (page.tsx uses
 * `useRouter().push('/')`) to preserve the server-action-as-mutation
 * pattern without baking navigation into this file.
 *
 * Revalidates `/` so the dashboard immediately drops the hidden article
 * from its masonry — the dashboard loader already filters
 * `dashboard_visible = true`, but hidden articles may not yet have
 * their `dashboard_visible` toggled (that's the retention purge job).
 * Revalidating the article's own slug path is redundant (the loader
 * returns null on `hidden = true`) but harmless.
 *
 * Restoration UI: Phase 7 #78 (Settings → Hidden articles list).
 * For now, hidden articles remain in the DB and are accessible via
 * Drizzle studio, psql, or direct DB query.
 *
 * FTS note: Phase 7 #73 (search) will need `AND hidden = false` in
 * the search query. Hidden articles must not appear in search results.
 */
export async function hideArticle(articleId: string, slug: string): Promise<void> {
  const session = await requireAdmin()
  if (!session) return

  if (MOCK_MODE) {
    const article = mockArticles.find((a) => a.id === articleId)
    if (article) {
      article.hidden = true
    }
    revalidatePath('/')
    revalidatePath(`/a/${slug}`)
    return
  }

  await db
    .update(articles)
    .set({ hidden: true, hiddenAt: new Date() })
    .where(eq(articles.id, articleId))
  revalidatePath('/')
  revalidatePath(`/a/${slug}`)
}
