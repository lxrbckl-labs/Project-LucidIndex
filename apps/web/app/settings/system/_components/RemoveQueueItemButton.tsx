'use client'

/**
 * Icon-only button that soft-archives a queue row via the `removeQueueItem`
 * server action. "Remove" = set `acked_at = now()` — no physical deletion
 * (NO DELETIONS rule). Uses `useTransition` so the button disables while the
 * round-trip is in flight, and confirms with a sonner toast on success.
 */

import { X } from 'lucide-react'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { removeQueueItem } from '../actions'

type Props = {
  itemId: string
}

export function RemoveQueueItemButton({ itemId }: Props) {
  const [isPending, startTransition] = useTransition()

  function handleRemove() {
    startTransition(async () => {
      const result = await removeQueueItem(itemId)
      if (result.ok) {
        toast.success('Removed from queue')
      }
    })
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={handleRemove}
      aria-label="Remove queue item"
      data-testid={`remove-queue-item-${itemId}`}
    >
      <X className="h-4 w-4" />
      <span className="sr-only">Remove</span>
    </Button>
  )
}
