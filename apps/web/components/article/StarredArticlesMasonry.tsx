'use client'

/**
 * StarredArticlesMasonry — renders the viewer's starred articles.
 *
 * Stars live in localStorage (`article-prefs.ts`), so this reads the local id
 * set on mount, fetches the matching cards from `/api/articles/by-ids`, and
 * renders the standard masonry. Used by /starred, /favorites, and the
 * dashboard "Starred" filter — all now client-rendered and sign-in-free.
 */

import { type ReactNode, useEffect, useState } from 'react'
import type { MockArticle } from '@/app/_mock/articles'
import { getStarredArticles } from '@/lib/article-prefs'
import { ArticleMasonry } from './ArticleMasonry'

type Phase =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'ready'; articles: MockArticle[] }

type Props = {
  /** Custom empty-state node. Falls back to a one-line muted message. */
  empty?: ReactNode
}

export function StarredArticlesMasonry({ empty }: Props = {}) {
  const [phase, setPhase] = useState<Phase>({ status: 'loading' })

  useEffect(() => {
    const ids = Array.from(getStarredArticles())
    if (ids.length === 0) {
      setPhase({ status: 'empty' })
      return
    }
    let cancelled = false
    fetch('/api/articles/by-ids', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
      .then((r) => r.json())
      .then((data: { ok?: boolean; articles?: MockArticle[] }) => {
        if (cancelled) return
        const articles = data.ok && Array.isArray(data.articles) ? data.articles : []
        setPhase(articles.length === 0 ? { status: 'empty' } : { status: 'ready', articles })
      })
      .catch(() => {
        if (!cancelled) setPhase({ status: 'empty' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (phase.status === 'loading') {
    return <p className="text-sm text-muted-foreground">Loading your starred articles…</p>
  }
  if (phase.status === 'empty') {
    return empty ?? <p className="text-sm text-muted-foreground">No starred articles yet.</p>
  }
  return <ArticleMasonry articles={phase.articles} />
}
