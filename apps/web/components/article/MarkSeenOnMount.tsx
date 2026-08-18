'use client'

/**
 * MarkSeenOnMount — mounts on the article detail page and records the
 * article as seen in localStorage on first render.
 *
 * Renders nothing visible. The effect fires once per `articleId` — if
 * the article was already seen the localStorage write is idempotent.
 */

import { useEffect } from 'react'
import { markArticleSeen } from '@/lib/seen-articles'

type Props = {
  articleId: string
}

export function MarkSeenOnMount({ articleId }: Props) {
  useEffect(() => {
    markArticleSeen(articleId)
  }, [articleId])

  return null
}
