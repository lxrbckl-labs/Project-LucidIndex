/**
 * HideArticleButton — admin-only affordance to hide an article (#69).
 *
 * Hairline magazine vibe: text-only, no fill, no rounded buttons. A
 * browser `confirm()` is used for v0.1 (the spec calls it acceptable
 * for the first pass). On confirmation the button calls `hideArticle`
 * and immediately redirects the user to `/` — the article page would
 * 404 on the next visit anyway (the loader filters `hidden = true`
 * rows), so staying on the page would leave the user on a dead URL.
 *
 * Restoration UI lives in Phase 7 #78 (Settings → Hidden articles).
 * This button is the write side only — there is no undo from the
 * article page itself in this PR.
 */

'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { hideArticle } from '@/app/a/[slug]/actions'

type Props = {
  articleId: string
  slug: string
}

export function HideArticleButton({ articleId, slug }: Props) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function handleHide() {
    const confirmed = window.confirm(
      'Hide this article? It will disappear from the dashboard and share-link. ' +
        'You can restore it later in Settings → Hidden articles (Phase 7 #78).',
    )
    if (!confirmed) return

    setPending(true)
    await hideArticle(articleId, slug)
    router.push('/')
  }

  return (
    <button
      type="button"
      onClick={handleHide}
      disabled={pending}
      className="text-[var(--text-meta)] uppercase tracking-[0.08em] text-[var(--color-muted-500)] transition-colors hover:text-ink disabled:opacity-40"
    >
      {pending ? 'Hiding…' : 'Hide article'}
    </button>
  )
}
