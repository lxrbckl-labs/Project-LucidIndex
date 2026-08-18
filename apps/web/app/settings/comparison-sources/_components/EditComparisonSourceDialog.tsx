'use client'

/**
 * "Edit Source" dialog — wraps ComparisonSourceForm in a Dialog modal.
 * Replaces the standalone /settings/comparison-sources/[id] subpage.
 */

import { Pencil } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import type { ComparisonSourceRow } from '../_lib/comparison-sources-repo'
import { ComparisonSourceForm } from './ComparisonSourceForm'

type Props = {
  row: ComparisonSourceRow
}

export function EditComparisonSourceDialog({ row }: Props) {
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
        aria-label={`Edit ${row.name}`}
        className="border border-input"
      >
        <Pencil className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Source</DialogTitle>
          </DialogHeader>
          <ComparisonSourceForm
            mode="edit"
            sourceId={row.id}
            initial={{
              name: row.name,
              baseUrl: row.baseUrl,
              isActive: row.isActive,
              notes: row.notes ?? '',
            }}
            onSuccess={handleSuccess}
            onCancel={() => setOpen(false)}
          />

          <Separator />

          <div>
            <h3 className="text-sm uppercase tracking-wide text-muted-foreground font-semibold">
              Metadata (read-only)
            </h3>
            <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
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
