/**
 * Settings → Hidden articles (Phase 7 — closes #78).
 * Rebuilt on shadcn primitives: Table + Button + Sonner toast.
 */

import { db } from '@lucidindex/db/client'
import { desc, eq } from '@lucidindex/db/query'
import { articles } from '@lucidindex/db/schema'
import { mockArticles } from '@/app/_mock/articles'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { RestoreButton } from './RestoreButton'

export const dynamic = 'force-dynamic'

const MOCK_MODE = process.env.LUCIDINDEX_MOCK === '1'

type HiddenRow = {
  id: string
  title: string
  slug: string
  hiddenAt: string | null
}

async function loadHiddenArticles(): Promise<HiddenRow[]> {
  if (MOCK_MODE) {
    const synthesizedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    return mockArticles
      .filter((a) => a.hidden === true)
      .map((a) => ({
        id: a.id,
        title: a.title,
        slug: a.slug,
        hiddenAt: synthesizedAt,
      }))
  }

  const rows = await db
    .select({
      id: articles.id,
      title: articles.title,
      slug: articles.slug,
      hiddenAt: articles.hiddenAt,
    })
    .from(articles)
    .where(eq(articles.hidden, true))
    .orderBy(desc(articles.hiddenAt))

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    slug: r.slug,
    hiddenAt: r.hiddenAt ? r.hiddenAt.toISOString() : null,
  }))
}

function formatHiddenAt(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const day = d.getUTCDate()
  const month = new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    timeZone: 'UTC',
  }).format(d)
  const year = d.getUTCFullYear()
  return `${day}. ${month} ${year}`
}

export default async function HiddenArticlesPanelPage() {
  const rows = await loadHiddenArticles()

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Hidden articles</h1>
        <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
          Articles you hid from the dashboard via the article page&apos;s &ldquo;Hide&rdquo; action
          (Phase 6 #69). Restoring an article puts it back on the dashboard immediately. Hidden URLs
          themselves 404 for everyone — the only path back is restore.
        </p>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardHeader className="text-center">
            <CardTitle>No hidden articles</CardTitle>
          </CardHeader>
          <CardContent className="pb-8 text-center" data-testid="hidden-articles-empty">
            <p className="text-sm text-muted-foreground">
              Hide articles from the article page itself; they&apos;ll show up here for restoration.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Hidden articles</CardTitle>
            <CardDescription>
              {rows.length} article{rows.length === 1 ? '' : 's'} currently hidden.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table data-testid="hidden-articles-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Hidden at</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} data-testid="hidden-article-row" data-article-id={row.id}>
                    <TableCell>
                      <span className="font-medium">{row.title}</span>
                      <span className="block text-xs text-muted-foreground font-mono">
                        {row.slug}
                      </span>
                    </TableCell>
                    <TableCell className="tabular-nums">{formatHiddenAt(row.hiddenAt)}</TableCell>
                    <TableCell className="text-right">
                      <RestoreButton articleId={row.id} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
