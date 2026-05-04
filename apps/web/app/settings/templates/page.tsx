/**
 * Settings → Templates list view (RSC) — rebuilt on shadcn (Phase 2).
 */

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AddTemplateDialog } from './_components/AddTemplateDialog'
import { listTemplates, type TemplateRow } from './_lib/templates-repo'

export const dynamic = 'force-dynamic'

const EXCERPT_LEN = 120

export default async function TemplatesPanelPage() {
  const templates = await listTemplates()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Templates</h1>
          <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
            Liquid prompts the agent renders at queue-pull time. The starter set is seeded on first
            boot via <code className="font-mono">pnpm db:seed</code>; admins can fork or edit any of
            them.
          </p>
        </div>
        <AddTemplateDialog />
      </div>

      <Separator />

      {templates.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed py-12 text-center">
          <div>
            <p className="font-semibold">No templates yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Run <code className="font-mono">pnpm db:seed</code> to seed the 7 starter templates,
              or create your own.
            </p>
          </div>
          <AddTemplateDialog />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Slug</TableHead>
                <TableHead className="text-right">Cross-source N</TableHead>
                <TableHead>Body excerpt</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((row) => (
                <TemplateTableRow key={row.id} row={row} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function TemplateTableRow({ row }: { row: TemplateRow }) {
  return (
    <TableRow>
      <TableCell className="font-mono text-xs font-semibold">{row.slug}</TableCell>
      <TableCell className="text-right tabular-nums">{row.crossSourceN}</TableCell>
      <TableCell className="text-xs text-muted-foreground max-w-[420px]">
        <span className="block truncate" title={row.body}>
          {excerpt(row.body, EXCERPT_LEN)}
        </span>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
        {row.updatedAt.toISOString().replace('T', ' ').slice(0, 16)}
      </TableCell>
      <TableCell className="text-right whitespace-nowrap">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/settings/templates/${row.id}`}>Edit</Link>
        </Button>
      </TableCell>
    </TableRow>
  )
}

function excerpt(body: string, max: number): string {
  const flat = body.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  return `${flat.slice(0, max - 1)}…`
}
