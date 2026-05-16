// Article dedup helper. Owned by #43.
//
// `articles` has UNIQUE(target_id, source_url). Pre-#43 we let the constraint
// raise 23505 and translated it to a `duplicate_source_url` ToolError —
// callers had to handle the failure themselves.
//
// Per #43 spec: dedup is now silent. If `(target_id, source_url)` already
// exists, return the existing id with `deduped: true` and skip the insert.
// The caller's response shape becomes `{ id, deduped }` per article.

import { db } from '@lucidindex/db/client'
import { articles } from '@lucidindex/db/schema'
import { and, eq } from 'drizzle-orm'

export async function findExistingArticleId(
  targetId: string,
  sourceUrl: string,
): Promise<string | null> {
  const rows = await db
    .select({ id: articles.id })
    .from(articles)
    .where(and(eq(articles.targetId, targetId), eq(articles.sourceUrl, sourceUrl)))
    .limit(1)
  // biome-ignore lint/style/noNonNullAssertion: length-checked via ternary
  return rows.length > 0 ? rows[0]!.id : null
}
