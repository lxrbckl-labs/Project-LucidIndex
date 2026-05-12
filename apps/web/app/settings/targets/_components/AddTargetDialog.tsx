'use client'

/**
 * "Add Target" dialog — wraps TargetForm in a Dialog modal.
 * Mirrors the agent-tokens "New Token" pattern.
 */

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { CadencePreset } from '../_lib/targets-repo'
import { TargetForm } from './TargetForm'

type Props = {
  cadencePresets: ReadonlyArray<CadencePreset>
  promptTemplates: ReadonlyArray<{ id: string; slug: string }>
  promptTemplatesAvailable: boolean
}

export function AddTargetDialog({
  cadencePresets,
  promptTemplates,
  promptTemplatesAvailable,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  function handleSuccess() {
    setOpen(false)
    router.refresh()
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Add Target
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Target</DialogTitle>
          </DialogHeader>
          <TargetForm
            mode="create"
            initial={{
              label: '',
              urlOrHandle: '',
              cadence: '',
              promptTemplateId: '',
              active: true,
            }}
            cadencePresets={cadencePresets}
            promptTemplates={promptTemplates}
            promptTemplatesAvailable={promptTemplatesAvailable}
            onSuccess={handleSuccess}
            onCancel={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
