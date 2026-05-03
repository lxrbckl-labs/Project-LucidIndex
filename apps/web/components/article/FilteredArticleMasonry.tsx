'use client'

/**
 * FilteredArticleMasonry — client wrapper around ArticleMasonry.
 *
 * Reads `notInterested` topics from localStorage via `useTopicPrefs()` and
 * culls articles whose `topicBadges` array overlaps with the not-interested
 * set before passing the filtered list to `<ArticleMasonry>`.
 *
 * "Not interested" semantics (v1): hide an article if ANY of its topic badges
 * is in the not-interested set — conservative "I don't want to see this".
 *
 * When `skipNotInterestedFilter` is true (topic-focus view), the filter is
 * bypassed entirely so the user can still read articles for a topic they
 * previously marked as not-interested.
 */

import type { MockArticle } from '@/app/_mock/articles'
import { useTopicPrefs } from '@/lib/topic-prefs'
import { ArticleMasonry } from './ArticleMasonry'

type Props = {
  articles: MockArticle[]
  /** When true, skip the not-interested filter (topic-focus view). */
  skipNotInterestedFilter?: boolean
}

export function FilteredArticleMasonry({ articles, skipNotInterestedFilter = false }: Props) {
  const { notInterested } = useTopicPrefs()

  const filtered =
    skipNotInterestedFilter || notInterested.size === 0
      ? articles
      : articles.filter((article) => !article.topicBadges.some((badge) => notInterested.has(badge)))

  return <ArticleMasonry articles={filtered} />
}
