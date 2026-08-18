'use client'

/**
 * "Add Source" dialog — wraps ComparisonSourceForm in a Dialog modal.
 * Mirrors the agent-tokens "New Token" pattern.
 */

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ComparisonSourceForm } from './ComparisonSourceForm'

export function AddComparisonSourceDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  function handleSuccess() {
    setOpen(false)
    router.refresh()
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Add Source
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Source</DialogTitle>
          </DialogHeader>
          <ComparisonSourceForm
            mode="create"
            initial={{ name: '', baseUrl: '', isActive: true, notes: '' }}
            onSuccess={handleSuccess}
            onCancel={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
