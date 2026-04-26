'use client'

/**
 * Tiny client component for the Pause/Resume action on each target row.
 *
 * POSTs to `/api/settings/targets/[id]/active` then calls `router.refresh()`
 * so the RSC list re-renders with the new state. Disabled while in flight
 * to keep double-clicks from racing.
 */

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function PauseResumeButton({ id, active }: { id: string; active: boolean }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/settings/targets/${id}/active`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ active: !active }),
      })
      if (!res.ok) {
        setError('Failed')
        return
      }
      router.refresh()
    } catch {
      setError('Failed')
    } finally {
      setPending(false)
    }
  }

  return (
    <span className="inline-block">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className="text-sm font-semibold underline hover:opacity-70 disabled:opacity-40"
      >
        {pending ? '...' : active ? 'Pause' : 'Resume'}
      </button>
      {error ? <span className="ml-2 text-xs text-red-600">{error}</span> : null}
    </span>
  )
}
