'use client'

/**
 * RestoreButton — admin restore affordance for Settings → Hidden articles (#78).
 * Rebuilt on shadcn Button + Sonner toast (Phase 2).
 */

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
      toast.success('Article restored.')
    })
  }

  if (done) {
    return <span className="text-xs text-muted-foreground">Restored</span>
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={handleClick} disabled={isPending}>
      {isPending ? 'Restoring…' : 'Restore'}
    </Button>
  )
}
