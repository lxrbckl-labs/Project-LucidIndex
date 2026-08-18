/**
 * ComparisonSourcesPanel — table of all configured comparison sources.
 *
 * Server component (RSC). Fetches rows and renders the shadcn Table.
 * "Delete" routes through the PATCH API to soft-delete (is_active=false).
 */
'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { ComparisonSourceRow } from '../_lib/comparison-sources-repo'
import { EditComparisonSourceDialog } from './EditComparisonSourceDialog'

type Props = {
  rows: ComparisonSourceRow[]
}

export function ComparisonSourcesPanel({ rows }: Props) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <span className="sr-only">Edit</span>
          </TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Base URL</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Notes</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <SourceRow key={row.id} row={row} />
        ))}
      </TableBody>
    </Table>
  )
}

function SourceRow({ row }: { row: ComparisonSourceRow }) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)

  async function onDelete() {
    if (!confirm(`Deactivate "${row.name}"? The source will be hidden from new citations.`)) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/settings/comparison-sources/${row.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        toast.error('Failed to deactivate source.')
        return
      }
      toast.success(`"${row.name}" deactivated.`)
      router.refresh()
    } catch {
      toast.error('Network error.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <TableRow>
      <TableCell className="w-10">
        <EditComparisonSourceDialog row={row} />
      </TableCell>
      <TableCell className="font-semibold">{row.name}</TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground max-w-[260px]">
        <span className="block truncate" title={row.baseUrl}>
          {row.baseUrl}
        </span>
      </TableCell>
      <TableCell>
        {row.isActive ? (
          <Badge variant="secondary" className="text-emerald-600">
            Active
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            Inactive
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground max-w-[200px]">
        {row.notes ? (
          <span className="block truncate" title={row.notes}>
            {row.notes}
          </span>
        ) : (
          '—'
        )}
      </TableCell>
      <TableCell className="text-right whitespace-nowrap">
        {row.isActive ? (
          <Button variant="ghost" size="sm" onClick={onDelete} disabled={deleting}>
            {deleting ? 'Deactivating…' : 'Deactivate'}
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  )
}
