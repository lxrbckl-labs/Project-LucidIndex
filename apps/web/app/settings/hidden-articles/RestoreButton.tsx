/**
 * RestoreButton — admin restore affordance for Settings → Hidden articles (#78).
 *
 * Hairline magazine vibe consistent with `HideArticleButton`: text-only,
 * no fill, no rounded buttons. A `confirm()` is intentionally absent
 * here — restore is the inverse of hide and not destructive (the row
 * just reappears on the dashboard); the friction would feel out of
 * place. Hide already gates itself behind a confirm.
 *
 * Client component because it owns the pending state for the disabled
 * styling. The action call is the standard Next 15 server-action
 * invocation.
 */

'use client'

import { useState, useTransition } from 'react'
import { restoreArticle } from './actions'

type Props = {
  articleId: string
}

export function RestoreButton({ articleId }: Props) {
  const [isPending, startTransition] = useTransition()
  const [done, setDone] = useState(false)

  function handleClick() {
    startTransition(async () => {
      await restoreArticle(articleId)
      setDone(true)
    })
  }

  if (done) {
    return (
      <span className="text-[var(--text-meta)] uppercase tracking-[0.08em] text-[var(--color-muted-500)]">
        Restored
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="text-sm uppercase tracking-[0.08em] text-black hover:underline disabled:opacity-40"
    >
      {isPending ? 'Restoring…' : 'Restore'}
    </button>
  )
}
