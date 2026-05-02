/**
 * Settings → Templates list view (RSC) — rebuilt on shadcn (Phase 2).
 */

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
        <Button asChild>
          <Link href="/settings/templates/new">New template</Link>
        </Button>
      </div>

      {templates.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader className="text-center">
            <CardTitle>No templates yet</CardTitle>
          </CardHeader>
          <CardContent className="pb-4 text-center">
            <p className="text-sm text-muted-foreground">
              Run <code className="font-mono">pnpm db:seed</code> to seed the 7 starter templates,
              or create your own.
            </p>
          </CardContent>
          <CardFooter className="justify-center pb-8">
            <Button asChild>
              <Link href="/settings/templates/new">Create your first template</Link>
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Prompt templates</CardTitle>
            <CardDescription>
              {templates.length} template{templates.length === 1 ? '' : 's'} configured.
            </CardDescription>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
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
