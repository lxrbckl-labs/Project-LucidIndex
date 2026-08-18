'use client'

/**
 * "Edit Target" dialog — wraps TargetForm in a Dialog modal.
 * Replaces the standalone /settings/targets/[id] subpage.
 */

import { Pencil } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import type { CadencePreset, TargetRow } from '../_lib/targets-repo'
import { TargetForm } from './TargetForm'

type Props = {
  row: TargetRow
  cadencePresets: ReadonlyArray<CadencePreset>
  promptTemplates: ReadonlyArray<{ id: string; slug: string }>
  promptTemplatesAvailable: boolean
}

export function EditTargetDialog({
  row,
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
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label={`Edit ${row.label}`}
        className="border border-input"
      >
        <Pencil className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Target</DialogTitle>
          </DialogHeader>
          <TargetForm
            mode="edit"
            targetId={row.id}
            initial={{
              label: row.label,
              urlOrHandle: row.urlOrHandle,
              cadence: row.cadence,
              promptTemplateId: row.promptTemplateId,
              active: row.active,
            }}
            cadencePresets={cadencePresets}
            promptTemplates={promptTemplates}
            promptTemplatesAvailable={promptTemplatesAvailable}
            onSuccess={handleSuccess}
            onCancel={() => setOpen(false)}
          />

          <Separator />

          <div>
            <h3 className="text-sm uppercase tracking-wide text-muted-foreground font-semibold">
              Cron-managed (read-only)
            </h3>
            <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <ReadOnlyRow label="Next due">{formatDate(row.nextDueAt)}</ReadOnlyRow>
              <ReadOnlyRow label="Last run">
                {row.lastRunAt ? formatDate(row.lastRunAt) : '—'}
              </ReadOnlyRow>
              <ReadOnlyRow label="Last status">{row.lastRunStatus ?? '—'}</ReadOnlyRow>
              <ReadOnlyRow label="Last failure reason">
                {row.lastRunFailureReason ?? '—'}
              </ReadOnlyRow>
              <ReadOnlyRow label="Created">{formatDate(row.createdAt)}</ReadOnlyRow>
              <ReadOnlyRow label="Updated">{formatDate(row.updatedAt)}</ReadOnlyRow>
            </dl>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ReadOnlyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono text-xs break-all">{children}</dd>
    </>
  )
}

function formatDate(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 19)
}
