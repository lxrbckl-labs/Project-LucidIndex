'use client'

/**
 * Pause/Resume action for each target row — rebuilt on shadcn Button (Phase 2).
 */

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

export function PauseResumeButton({ id, active }: { id: string; active: boolean }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function toggle() {
    setPending(true)
    try {
      const res = await fetch(`/api/settings/targets/${id}/active`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ active: !active }),
      })
      if (!res.ok) {
        toast.error('Failed to update target.')
        return
      }
      toast.success(active ? 'Target paused.' : 'Target resumed.')
      router.refresh()
    } catch {
      toast.error('Network error.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={toggle} disabled={pending}>
      {pending ? '…' : active ? 'Pause' : 'Resume'}
    </Button>
  )
}
