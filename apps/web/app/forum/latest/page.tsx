/**
 * Forum → Latest.
 *
 * The "latest" view is conceptually identical to `/forum` (newest posts
 * first, no filter). Rather than duplicate the feed-query + card layout
 * for one extra surface, we redirect to `/forum`. The sidebar link is
 * still a useful canonical entry point — the URL just resolves to the
 * existing feed.
 */

import { redirect } from 'next/navigation'

export default function LatestForumPage(): never {
  redirect('/forum')
}
